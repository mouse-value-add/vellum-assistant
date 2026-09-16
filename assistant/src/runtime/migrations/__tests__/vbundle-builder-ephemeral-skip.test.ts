/**
 * Both export emit paths must leave per-process runtime state out of the
 * archive: pid files, daemon logs, resource-monitor samples, and SQLite
 * auxiliary files. Restoring any of them into a live assistant swaps files
 * out from under open handles or points the CLI at pids from another host.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { buildExportVBundle, streamExportVBundle } from "../vbundle-builder.js";
import { defaultV1Options } from "./v1-test-helpers.js";

const KEPT = [
  "config.json",
  "IDENTITY.md",
  "memory/threads.md",
  "data/db/assistant.db",
  "data/monitoring-notes.md",
];

const DROPPED = [
  "vellum.pid",
  "embed-worker.pid",
  "data/db/assistant.db-wal",
  "data/db/assistant.db-shm",
  "data/logs/assistant-2026-09-16.log",
  "data/monitoring/samples.jsonl",
  "data/monitoring/monitoring.pid",
  "data/monitoring/snapshots/baseline-1.json",
];

function createWorkspace(): { dir: string; cleanup: () => void } {
  const dir = join(
    tmpdir(),
    `vbundle-ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  for (const rel of [...KEPT, ...DROPPED]) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, `content of ${rel}`);
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function expectOnlyDurableFiles(paths: string[]): void {
  for (const rel of KEPT) {
    expect(paths).toContain(`workspace/${rel}`);
  }
  for (const rel of DROPPED) {
    expect(paths).not.toContain(`workspace/${rel}`);
  }
}

describe("workspace export skips per-process runtime state", () => {
  test("buildExportVBundle", () => {
    const workspace = createWorkspace();
    try {
      const { manifest } = buildExportVBundle({
        workspaceDir: workspace.dir,
        ...defaultV1Options(),
      });
      expectOnlyDurableFiles(manifest.contents.map((f) => f.path));
    } finally {
      workspace.cleanup();
    }
  });

  test("streamExportVBundle", async () => {
    const workspace = createWorkspace();
    let result: Awaited<ReturnType<typeof streamExportVBundle>> | undefined;
    try {
      result = await streamExportVBundle({
        workspaceDir: workspace.dir,
        ...defaultV1Options(),
      });
      expectOnlyDurableFiles(result.manifest.contents.map((f) => f.path));
    } finally {
      await result?.cleanup();
      workspace.cleanup();
    }
  });
});
