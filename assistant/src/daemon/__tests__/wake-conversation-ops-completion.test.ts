import { beforeEach, describe, expect, mock, test } from "bun:test";

// persistWakeTriggerMessage syncs each row to the disk view and publishes a
// sync invalidation; stub both so this unit test stays a pure DB round-trip
// without touching the filesystem or the event hub.
mock.module("../../persistence/conversation-disk-view.js", () => ({
  syncMessageToDisk: () => {},
}));
mock.module("../../runtime/sync/resource-sync-events.js", () => ({
  publishConversationMessagesChanged: () => {},
}));

import {
  createConversation,
  getMessages,
} from "../../persistence/conversation-crud.js";
import { initializeDb } from "../../persistence/db-init.js";
import type { Message } from "../../providers/types.js";
import type { CompletedBackgroundTool } from "../../tools/background-tool-registry.js";
import type { Conversation } from "../conversation.js";
import {
  persistWakeTailMessage,
  persistWakeTriggerMessage,
} from "../wake-conversation-ops.js";

await initializeDb();

/** Minimal Conversation stub exercising only the fields the function reads. */
function makeConversationStub(
  conversationId: string,
  clientState: { hasNoClient?: boolean; headlessLock?: boolean } = {},
): Conversation {
  return {
    conversationId,
    trustContext: undefined,
    hasNoClient: clientState.hasNoClient ?? false,
    headlessLock: clientState.headlessLock ?? false,
    getTurnChannelContext: () => null,
    getTurnInterfaceContext: () => null,
  } as unknown as Conversation;
}

function triggerMessage(): Message {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: '<background_event source="background-tool">Background command completed (id=bg-1, exit=0):</background_event>',
      },
    ],
  };
}

function readMetadata(conversationId: string): Record<string, unknown> {
  const rows = getMessages(conversationId);
  expect(rows.length).toBe(1);
  const raw = rows[0]?.metadata;
  expect(raw).toBeTruthy();
  return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("persistWakeTriggerMessage backgroundToolCompletion", () => {
  let conversationId: string;

  beforeEach(() => {
    conversationId = createConversation("wake-completion-test").id;
  });

  test("round-trips a completion onto the persisted metadata", async () => {
    const completion: CompletedBackgroundTool = {
      id: "bg-1",
      toolName: "bash",
      conversationId,
      command: "sleep 1 && echo done",
      startedAt: 1_700_000_000_000,
      status: "completed",
      exitCode: 0,
      output: "done\n",
      completedAt: 1_700_000_001_000,
    };

    await persistWakeTriggerMessage(
      makeConversationStub(conversationId),
      triggerMessage(),
      "background-tool",
      false,
      completion,
    );

    const metadata = readMetadata(conversationId);
    expect(metadata.backgroundToolCompletion).toEqual(completion);
    // Existing wake-trigger metadata is unaffected.
    expect(metadata.kind).toBe("background-event");
    expect(metadata.backgroundEventSource).toBe("background-tool");
    expect(metadata.automated).toBe(true);
    // A non-clientless wake on a client-connected conversation runs interactive,
    // and that mode is recorded for later retries.
    expect(metadata.backgroundEventInteractive).toBe(true);
  });

  test("omits the completion key and records non-interactive for a clientless wake", async () => {
    await persistWakeTriggerMessage(
      makeConversationStub(conversationId),
      triggerMessage(),
      "background-tool",
      true,
    );

    const metadata = readMetadata(conversationId);
    expect("backgroundToolCompletion" in metadata).toBe(false);
    expect(metadata.kind).toBe("background-event");
    // A clientless wake (interrupted-turn recovery, local IPC wake) pins
    // `hasNoClient` for its dispatch, so it records the non-interactive mode.
    expect(metadata.backgroundEventInteractive).toBe(false);
  });

  test("records non-interactive for a cold-hydrated wake without clientless", async () => {
    // A conversation cold-hydrated after a restart carries `hasNoClient = true`
    // (no client attached). A scheduled wake omits `clientless`, yet the loop
    // still resolves the turn non-interactive from `hasNoClient`, so the
    // recorded mode is false rather than the requested `!clientless`.
    await persistWakeTriggerMessage(
      makeConversationStub(conversationId, { hasNoClient: true }),
      triggerMessage(),
      "schedule",
      false,
    );

    const metadata = readMetadata(conversationId);
    expect(metadata.backgroundEventSource).toBe("schedule");
    expect(metadata.backgroundEventInteractive).toBe(false);
  });
});

describe("persistWakeTailMessage activity ownership", () => {
  test("stamps the live ownership onto the persisted tool_use block, not the message", async () => {
    const conversationId = createConversation("wake-activity-test").id;
    const message: Message = {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tu-mcp",
          name: "mcp__calendar__create_event",
          input: { activity: "planning" },
        },
        {
          type: "tool_use",
          id: "tu-native",
          name: "web_search",
          input: { query: "weather" },
        },
      ],
    };

    await persistWakeTailMessage(
      makeConversationStub(conversationId),
      message,
      new Map([["tu-mcp", false]]),
    );

    const [row] = getMessages(conversationId);
    expect(row.content[0]).toMatchObject({ _activityIsStatus: false });
    // A call the live event said nothing about stays unstamped.
    expect(row.content[1]).not.toHaveProperty("_activityIsStatus");
    // The in-memory message the model sees again carries no rider.
    expect(message.content[0]).not.toHaveProperty("_activityIsStatus");
  });
});
