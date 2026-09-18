/**
 * A Done conversation comes back to the list when a user-visible message
 * lands in it.
 *
 * The rule is enforced at `insertMessageCore`, the one seam every message
 * append funnels through, so these tests drive it the way each ingest path
 * does: `addMessage` with that path's row shape. The paths themselves differ
 * only in the metadata they stamp, which is exactly what the seam reads.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { eq } from "drizzle-orm";

mock.module("../persistence/embeddings/qdrant-client.js", () => ({
  getQdrantClient: () => ({
    searchWithFilter: async () => [],
    hybridSearch: async () => [],
    upsertPoints: async () => {},
    deletePoints: async () => {},
  }),
  initQdrantClient: () => {},
  resolveQdrantUrl: () => "http://127.0.0.1:6333",
}));

let sidebarDoneEnabled = true;
mock.module("../config/sidebar-done-gate.js", () => ({
  SIDEBAR_DONE_FLAG: "sidebar-done",
  isSidebarDoneEnabled: () => sidebarDoneEnabled,
}));

const listInvalidations: Array<{ reason: string; conversationIds: unknown }> =
  [];
const actualSyncEvents =
  await import("../runtime/sync/resource-sync-events.js");
mock.module("../runtime/sync/resource-sync-events.js", () => ({
  ...actualSyncEvents,
  publishConversationListAndMetadataChanged: (
    reason: string,
    conversationIds: unknown,
  ) => {
    listInvalidations.push({ reason, conversationIds });
  },
}));

import {
  addMessage,
  archiveConversation,
  getConversation,
} from "../persistence/conversation-crud.js";
import { getDb } from "../persistence/db-connection.js";
import { initializeDb } from "../persistence/db-init.js";
import { conversations, messages } from "../persistence/schema/index.js";
import { MEMORY_RETROSPECTIVE_INSTRUCTION_KIND } from "../plugins/defaults/memory/memory-retrospective-constants.js";
import { setConfig } from "./helpers/set-config.js";

setConfig("memory", { extraction: { useLLM: false } });

await initializeDb();

const DONE_CONVERSATION_ID = "conv-done";
const RETRO_FORK_ID = "conv-done-retro-fork";

function insertConversation(id: string): void {
  const now = Date.now();
  getDb()
    .insert(conversations)
    .values({
      id,
      title: null,
      createdAt: now,
      updatedAt: now,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedCost: 0,
      contextSummary: null,
      contextCompactedMessageCount: 0,
      contextCompactedAt: null,
    })
    .run();
}

function resetTables(): void {
  const db = getDb();
  db.run("DELETE FROM messages");
  db.run("DELETE FROM conversations");
  insertConversation(DONE_CONVERSATION_ID);
  insertConversation(RETRO_FORK_ID);
  archiveConversation(DONE_CONVERSATION_ID);
  listInvalidations.length = 0;
}

function archivedAtOf(id: string): number | null | undefined {
  return getConversation(id)?.archivedAt;
}

function blocks(text: string): string {
  return JSON.stringify([{ type: "text", text }]);
}

describe("Done conversations and new activity", () => {
  beforeEach(() => {
    sidebarDoneEnabled = true;
    resetTables();
  });

  test("assistant output from a scheduled run brings the conversation back", async () => {
    // The wake persists its `<background_event>` trigger first. That row is
    // dropped from the transcript, so it must not resurface anything on its
    // own: the run has produced nothing the user can read yet.
    await addMessage(
      DONE_CONVERSATION_ID,
      "user",
      blocks(
        '<background_event source="schedule">Daily digest</background_event>',
      ),
      {
        metadata: {
          kind: "background-event",
          backgroundEventSource: "schedule",
          automated: true,
        },
        skipIndexing: true,
      },
    );

    expect(archivedAtOf(DONE_CONVERSATION_ID)).not.toBeNull();
    expect(listInvalidations).toHaveLength(0);

    // The run's own output is what the user reads.
    await addMessage(
      DONE_CONVERSATION_ID,
      "assistant",
      blocks("Here is today's digest."),
      { metadata: { automated: true }, skipIndexing: true },
    );

    expect(archivedAtOf(DONE_CONVERSATION_ID)).toBeNull();
    expect(listInvalidations).toEqual([
      { reason: "reordered", conversationIds: DONE_CONVERSATION_ID },
    ]);
  });

  test("an inbound channel message from a person brings the conversation back", async () => {
    await addMessage(DONE_CONVERSATION_ID, "user", "any updates?", {
      metadata: {
        userMessageChannel: "slack",
        provenanceSourceChannel: "slack",
      },
      skipIndexing: true,
    });

    expect(archivedAtOf(DONE_CONVERSATION_ID)).toBeNull();
    expect(listInvalidations).toHaveLength(1);
  });

  test("a hidden machine signal leaves the conversation Done", async () => {
    await addMessage(DONE_CONVERSATION_ID, "user", "internal signal", {
      metadata: { hidden: true },
      skipIndexing: true,
    });

    expect(archivedAtOf(DONE_CONVERSATION_ID)).not.toBeNull();
    expect(listInvalidations).toHaveLength(0);
  });

  test("a memory retrospective leaves the conversation it reviews Done", async () => {
    // A retrospective runs in a fork: its instruction and its whole pass are
    // appended to the fork, never to the conversation under review.
    await addMessage(RETRO_FORK_ID, "user", "Review the transcript.", {
      metadata: { kind: MEMORY_RETROSPECTIVE_INSTRUCTION_KIND, hidden: true },
      skipIndexing: true,
    });
    await addMessage(RETRO_FORK_ID, "assistant", blocks("Saved one fact."), {
      metadata: { automated: true },
      skipIndexing: true,
    });

    expect(archivedAtOf(DONE_CONVERSATION_ID)).not.toBeNull();
    expect(listInvalidations).toHaveLength(0);
  });

  test("the flag off keeps every append from clearing archived_at", async () => {
    sidebarDoneEnabled = false;

    await addMessage(DONE_CONVERSATION_ID, "user", "any updates?", {
      metadata: {
        userMessageChannel: "slack",
        provenanceSourceChannel: "slack",
      },
      skipIndexing: true,
    });
    await addMessage(
      DONE_CONVERSATION_ID,
      "assistant",
      blocks("Here is today's digest."),
      { metadata: { automated: true }, skipIndexing: true },
    );

    expect(archivedAtOf(DONE_CONVERSATION_ID)).not.toBeNull();
    expect(listInvalidations).toHaveLength(0);
    expect(
      getDb()
        .select()
        .from(messages)
        .where(eq(messages.conversationId, DONE_CONVERSATION_ID))
        .all(),
    ).toHaveLength(2);
  });
});
