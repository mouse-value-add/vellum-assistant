import {
  leaseGuardianToken,
  loadGuardianToken,
  refreshGuardianTokenResult,
} from "./guardian-token.js";

export interface ResolveGuardianAccessTokenOptions {
  /**
   * Single-use gateway bootstrap secret from the lockfile. Only consulted
   * when no guardian token is stored for the assistant: `guardian/init`
   * consumes the secret and revokes every other device-bound token, so it
   * is never used to replace a token that merely expired.
   */
  bootstrapSecret?: string;
  /**
   * Skip the cached access token and rotate it through `guardian/refresh`.
   * Use after the runtime rejects a token whose local expiry still looks
   * valid (revoked, or the gateway signing key changed on restart).
   */
  forceRefresh?: boolean;
}

export class GuardianAccessTokenError extends Error {
  constructor(
    message: string,
    /** Mirrors the HTTP-ish status of `refreshGuardianTokenResult`. */
    readonly status: number,
  ) {
    super(message);
    this.name = "GuardianAccessTokenError";
  }

  get gatewayUnreachable(): boolean {
    return this.status === 503 || this.status === 504;
  }
}

/**
 * Resolve a bearer token for authenticated gateway requests.
 *
 * Resolution order:
 *  1. Stored token whose access token has not expired (unless `forceRefresh`).
 *  2. Stored token with a refresh token: rotate via `POST /v1/guardian/refresh`.
 *  3. No stored token and a `bootstrapSecret`: lease via `POST /v1/guardian/init`.
 *
 * A stored token that cannot be refreshed is a spent pairing; the only way
 * back is the explicit `vellum wake <id> --repair-guardian` reset, which the
 * thrown error names.
 */
export async function resolveGuardianAccessToken(
  gatewayUrl: string,
  assistantId: string,
  options: ResolveGuardianAccessTokenOptions = {},
): Promise<string> {
  const stored = loadGuardianToken(assistantId);

  if (!stored) {
    if (!options.bootstrapSecret) {
      throw new GuardianAccessTokenError(
        `No guardian token is stored for '${assistantId}'. Re-pair with: vellum wake ${assistantId} --repair-guardian`,
        401,
      );
    }
    const leased = await leaseGuardianToken(
      gatewayUrl,
      assistantId,
      options.bootstrapSecret,
    );
    return leased.accessToken;
  }

  if (
    !options.forceRefresh &&
    new Date(stored.accessTokenExpiresAt).getTime() > Date.now()
  ) {
    return stored.accessToken;
  }

  const refreshed = await refreshGuardianTokenResult(gatewayUrl, assistantId);
  if (refreshed.ok) {
    return refreshed.token.accessToken;
  }
  if (refreshed.status === 503 || refreshed.status === 504) {
    throw new GuardianAccessTokenError(refreshed.error, refreshed.status);
  }
  throw new GuardianAccessTokenError(
    `${refreshed.error} (assistant '${assistantId}'). Re-pair with: vellum wake ${assistantId} --repair-guardian`,
    refreshed.status,
  );
}

/**
 * CLI-command wrapper around {@link resolveGuardianAccessToken}: prints the
 * standard "is it running?" hint for an unreachable gateway and exits 1 on
 * any failure instead of throwing.
 */
export async function resolveGuardianAccessTokenOrExit(
  gatewayUrl: string,
  assistantId: string,
  displayName: string,
  options: ResolveGuardianAccessTokenOptions = {},
): Promise<string> {
  try {
    return await resolveGuardianAccessToken(gatewayUrl, assistantId, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const unreachable =
      (err instanceof GuardianAccessTokenError && err.gatewayUnreachable) ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed");
    if (unreachable) {
      console.error(
        `Error: Could not connect to assistant '${displayName}'. Is it running?`,
      );
      console.error(`Try: vellum wake ${displayName}`);
      process.exit(1);
    }
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
