/**
 * Tests for m0019-guardian-requests-source-turn-id.
 *
 * Verifies that up() adds `source_turn_id` to a `guardian_requests` table
 * that lacks it, that a re-run on a table that already has the column is a
 * no-op that still reports done (idempotent), that existing rows read back
 * with a null turn id, that the migration is registered after m0018, and that
 * down() is a no-op. Uses the real in-memory gateway DB.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Database } from "bun:sqlite";

import "./test-preload.js";

import {
  getGatewayDb,
  initGatewayDb,
  resetGatewayDb,
} from "../db/connection.js";
import { guardianRequests } from "../db/schema.js";

const { MIGRATIONS } = await import("../db/data-migrations/index.js");
const { up: m0019Up, down: m0019Down } =
  await import("../db/data-migrations/m0019-guardian-requests-source-turn-id.js");

function rawDb(): Database {
  return (getGatewayDb() as unknown as { $client: Database }).$client;
}

function hasSourceTurnIdColumn(): boolean {
  const columns = rawDb()
    .prepare(/*sql*/ `PRAGMA table_info(guardian_requests)`)
    .all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "source_turn_id");
}

beforeAll(async () => {
  await initGatewayDb();
});

beforeEach(() => {
  getGatewayDb().delete(guardianRequests).run();
});

afterAll(() => {
  resetGatewayDb();
});

describe("m0019-guardian-requests-source-turn-id", () => {
  test("is a no-op that reports done when the schema push already added the column", () => {
    expect(hasSourceTurnIdColumn()).toBe(true);
    expect(m0019Up()).toBe("done");
    expect(hasSourceTurnIdColumn()).toBe(true);
  });

  test("adds the column to a table that lacks it and leaves existing rows null", () => {
    const now = Date.now();
    rawDb()
      .prepare(
        /*sql*/ `ALTER TABLE guardian_requests DROP COLUMN source_turn_id`,
      )
      .run();
    expect(hasSourceTurnIdColumn()).toBe(false);
    rawDb()
      .prepare(
        /*sql*/ `INSERT INTO guardian_requests (id, kind, status, created_at, updated_at)
                 VALUES ('req-before', 'access_request', 'pending', ?, ?)`,
      )
      .run(now, now);

    expect(m0019Up()).toBe("done");

    expect(hasSourceTurnIdColumn()).toBe(true);
    const row = rawDb()
      .prepare(
        /*sql*/ `SELECT source_turn_id AS sourceTurnId FROM guardian_requests WHERE id = 'req-before'`,
      )
      .get() as { sourceTurnId: string | null };
    expect(row.sourceTurnId).toBeNull();
  });

  test("is registered directly after m0018", () => {
    const keys = MIGRATIONS.map((m) => m.key);
    const m0018Index = keys.indexOf("m0018-trust-rules-scope-column");
    const m0019Index = keys.indexOf("m0019-guardian-requests-source-turn-id");
    expect(m0018Index).toBeGreaterThanOrEqual(0);
    expect(m0019Index).toBe(m0018Index + 1);
  });

  test("down() is a no-op", () => {
    expect(m0019Down()).toBe("done");
    expect(hasSourceTurnIdColumn()).toBe(true);
  });
});
