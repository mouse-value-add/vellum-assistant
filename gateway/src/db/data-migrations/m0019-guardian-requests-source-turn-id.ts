/**
 * One-time migration: add nullable `source_turn_id` to `guardian_requests`.
 *
 * The column records the daemon turn (its per-turn request id) whose tool
 * call raised the request. NULL for every existing row and for kinds no turn
 * raises; the daemon writes it on the two creation paths that run inside a
 * turn (the escalation helper and the confirmation promotion).
 *
 * Idempotent: `ADD COLUMN` on an existing column raises SQLITE_ERROR in
 * SQLite; we catch that and treat it as a skip so re-running is safe.
 */

import type { Database } from "bun:sqlite";

import { getLogger } from "../../logger.js";
import { getGatewayDb } from "../connection.js";

import type { MigrationResult } from "./index.js";

const log = getLogger("m0019-guardian-requests-source-turn-id");

function getRawGatewayDb(): Database {
  return (getGatewayDb() as unknown as { $client: Database }).$client;
}

export function up(): MigrationResult {
  try {
    getRawGatewayDb()
      .prepare(
        /*sql*/ `ALTER TABLE guardian_requests ADD COLUMN source_turn_id TEXT`,
      )
      .run();

    log.info("Added source_turn_id column to guardian_requests");
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("duplicate column name")) {
      log.info(
        "source_turn_id column already exists in guardian_requests, skipping",
      );
      return "done";
    }
    log.error(
      { err },
      "Failed to add source_turn_id column to guardian_requests",
    );
    return "skip";
  }
}

export function down(): MigrationResult {
  return "done";
}
