import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import {
  importStagedBundle,
  stageBundleForRestore,
  type RestoreStagingTarget,
} from "./bundle-staging.js";
import { loadGuardianToken } from "./guardian-token.js";
import { resolveGuardianAccessToken } from "./guardian-access-token.js";
import { loopbackSafeFetch } from "./loopback-fetch.js";

/** Default backup directory following XDG convention */
export function getBackupsDir(): string {
  const dataHome =
    process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "vellum", "backups");
}

/** Human-readable file size */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Obtain a valid guardian access token, or null when none can be had.
 * Never leases a fresh token via `guardian/init`: these helpers run inside
 * upgrade/teleport flows on already-paired instances, where the single-use
 * bootstrap secret is spent and a lease would 403 (or revoke other devices).
 */
async function getGuardianAccessToken(
  runtimeUrl: string,
  assistantId: string,
  options?: { forceRefresh?: boolean },
): Promise<string | null> {
  if (!loadGuardianToken(assistantId)) {
    return null;
  }
  try {
    return await resolveGuardianAccessToken(runtimeUrl, assistantId, options);
  } catch {
    return null;
  }
}

/**
 * Create a .vbundle backup of a running assistant.
 * Returns the path to the saved backup, or null if backup failed.
 * Never throws — failures are logged as warnings.
 */
export async function createBackup(
  runtimeUrl: string,
  assistantId: string,
  options?: { prefix?: string; description?: string; timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  try {
    const accessToken = await getGuardianAccessToken(runtimeUrl, assistantId);
    if (!accessToken) {
      console.warn(
        "Warning: backup skipped — no valid guardian token available",
      );
      return null;
    }

    const { response } = await fetchWithTokenRotation(
      accessToken,
      (token) =>
        loopbackSafeFetch(`${runtimeUrl}/v1/migrations/export`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description: options?.description ?? "CLI backup",
          }),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      () =>
        getGuardianAccessToken(runtimeUrl, assistantId, { forceRefresh: true }),
    );

    if (!response.ok) {
      const body = await response.text();
      console.warn(
        `Warning: backup export failed (${response.status}): ${body}`,
      );
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const isoTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = options?.prefix ?? assistantId;
    const outputPath = join(
      getBackupsDir(),
      `${prefix}-${isoTimestamp}.vbundle`,
    );

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, data);

    return outputPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: backup failed: ${msg}`);
    return null;
  }
}

/** How long a request waits for a freshly started gateway to open its traffic gate. */
const STARTING_GATE_WAIT_MS = 15_000;

/**
 * A freshly (re)started gateway answers 503 `{status:"starting"}` for a few
 * seconds until its own assistant poll observes the migration state and
 * opens the traffic gate. The daemon's running-migrations 503 carries a
 * `reason` field and is excluded: an import must not race an in-flight
 * migration.
 */
async function isGatewayStartingGate(response: Response): Promise<boolean> {
  if (response.status !== 503) {
    return false;
  }
  try {
    const parsed = (await response.clone().json()) as {
      status?: string;
      reason?: string;
    };
    return parsed.status === "starting" && parsed.reason === undefined;
  } catch {
    return false;
  }
}

/**
 * Send a gateway request, retrying through the post-start traffic gate for
 * up to {@link STARTING_GATE_WAIT_MS}. `vellum wake` returns as soon as the
 * daemon is ready, so a backup or restore issued right after it lands on
 * the gate. Returns the last response, ok or not, with its body unread.
 */
async function fetchThroughStartingGate(
  send: () => Promise<Response>,
): Promise<Response> {
  const deadline = Date.now() + STARTING_GATE_WAIT_MS;
  let response = await send();
  while (Date.now() < deadline && (await isGatewayStartingGate(response))) {
    await new Promise((r) => setTimeout(r, 1_000));
    response = await send();
  }
  return response;
}

/**
 * Send an authenticated gateway request through the starting gate, then
 * once more with a rotated token when the gateway answers 401: a locally
 * unexpired token is still stale after a gateway restart regenerated the
 * signing key. When `rotate` yields no token the 401 response is returned
 * as-is. Returns the last response with its body unread, plus the token it
 * was sent with.
 */
export async function fetchWithTokenRotation(
  token: string,
  send: (token: string) => Promise<Response>,
  rotate: () => Promise<string | null>,
): Promise<{ response: Response; token: string }> {
  const response = await fetchThroughStartingGate(() => send(token));
  if (response.status !== 401) {
    return { response, token };
  }
  const rotated = await rotate();
  if (!rotated) {
    return { response, token };
  }
  return {
    response: await fetchThroughStartingGate(() => send(rotated)),
    token: rotated,
  };
}

async function postRestoreWithRetries(
  postImport: (token: string) => Promise<Response>,
  runtimeUrl: string,
  assistantId: string,
  token: string,
): Promise<Response | null> {
  const { response } = await fetchWithTokenRotation(token, postImport, () =>
    getGuardianAccessToken(runtimeUrl, assistantId, { forceRefresh: true }),
  );

  if (!response.ok) {
    const body = await response.text();
    console.warn(`Warning: restore failed (${response.status}): ${body}`);
    return null;
  }

  return response;
}

async function finishRestoreResponse(response: Response): Promise<boolean> {
  const result = (await response.json()) as {
    success: boolean;
    message?: string;
    reason?: string;
  };
  if (!result.success) {
    console.warn(
      `Warning: restore failed — ${result.message ?? result.reason ?? "unknown reason"}`,
    );
    return false;
  }
  return true;
}

/**
 * Restore a .vbundle backup into a running assistant.
 * Returns true if restore succeeded, false otherwise.
 * Never throws — failures are logged as warnings.
 */
export async function restoreBackup(
  runtimeUrl: string,
  assistantId: string,
  backupPath: string,
  staging?: RestoreStagingTarget | null,
): Promise<boolean> {
  try {
    if (!existsSync(backupPath)) {
      console.warn(`Warning: backup file not found: ${backupPath}`);
      return false;
    }

    const token = await getGuardianAccessToken(runtimeUrl, assistantId);
    if (!token) {
      console.warn(
        "Warning: restore skipped — no valid guardian token available",
      );
      return false;
    }

    if (staging) {
      const staged = await stageBundleForRestore(staging, backupPath);
      try {
        const response = await postRestoreWithRetries(
          (sendToken) =>
            importStagedBundle(runtimeUrl, sendToken, staged.relativePath),
          runtimeUrl,
          assistantId,
          token,
        );
        if (!response) {
          return false;
        }
        return await finishRestoreResponse(response);
      } finally {
        await staged.cleanup();
      }
    }

    const bundleData = new Uint8Array(readFileSync(backupPath));
    const response = await postRestoreWithRetries(
      (sendToken) =>
        loopbackSafeFetch(`${runtimeUrl}/v1/migrations/import`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sendToken}`,
            "Content-Type": "application/octet-stream",
          },
          body: bundleData,
          signal: AbortSignal.timeout(120_000),
        }),
      runtimeUrl,
      assistantId,
      token,
    );
    if (!response) {
      return false;
    }
    return await finishRestoreResponse(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: restore failed: ${msg}`);
    return false;
  }
}

/** Filename kinds this CLI writes: `<assistantId>-<kind>-<timestamp>.vbundle`. */
export const CLI_BACKUP_KINDS = ["pre-upgrade", "pre-teleport"] as const;
export type CliBackupKind = (typeof CLI_BACKUP_KINDS)[number];

/** `new Date().toISOString().replace(/[:.]/g, "-")`, as used in every CLI backup filename. */
const BACKUP_TIMESTAMP_PATTERN =
  "\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the backup filenames this CLI wrote for exactly `assistantId` and
 * one of `kinds`. The kind and timestamp segments are matched in full, so an
 * assistant whose id is a prefix of another's (`alpha` vs `alpha-prod`, or
 * `alpha` vs `alpha-pre-teleport-prod`) never matches the other's files.
 */
export function assistantBackupFilenamePattern(
  assistantId: string,
  kinds: readonly CliBackupKind[] = CLI_BACKUP_KINDS,
): RegExp {
  return new RegExp(
    `^${escapeRegExp(assistantId)}-(?:${kinds.join("|")})-${BACKUP_TIMESTAMP_PATTERN}\\.vbundle$`,
  );
}

/**
 * Modification times of the `.vbundle` backups this CLI has written for
 * `assistantId` (every kind in `CLI_BACKUP_KINDS`), as ISO timestamps.
 * Missing directory yields `[]`.
 */
export function listAssistantBackupTimes(assistantId: string): string[] {
  const backupsDir = getBackupsDir();
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const pattern = assistantBackupFilenamePattern(assistantId);
  const times: string[] = [];
  for (const name of names) {
    if (!pattern.test(name)) {
      continue;
    }
    try {
      times.push(statSync(join(backupsDir, name)).mtime.toISOString());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
  return times;
}

/**
 * Keep only the N most recent backups of one `kind` for an assistant,
 * deleting older ones. Filenames are matched exactly (id, kind and
 * timestamp), never by prefix. Default: keep 3 pre-upgrade backups.
 * Never throws — failures are silently ignored.
 */
export function pruneOldBackups(
  assistantId: string,
  keep: number = 3,
  kind: CliBackupKind = "pre-upgrade",
): void {
  try {
    const backupsDir = getBackupsDir();
    if (!existsSync(backupsDir)) return;

    const pattern = assistantBackupFilenamePattern(assistantId, [kind]);
    const entries = readdirSync(backupsDir)
      .filter((f) => pattern.test(f))
      .sort();

    if (entries.length <= keep) return;

    const toDelete = entries.slice(0, entries.length - keep);
    for (const file of toDelete) {
      try {
        unlinkSync(join(backupsDir, file));
      } catch {
        // Best-effort cleanup — ignore individual file errors
      }
    }
  } catch {
    // Best-effort cleanup — never block the upgrade
  }
}
