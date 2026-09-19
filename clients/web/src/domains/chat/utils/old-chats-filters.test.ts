import { describe, expect, test } from "bun:test";

import {
  filterFromSearchParams,
  filterOldChats,
  oldChatsFilterKey,
  oldChatsFilters,
  oldChatsSearchFor,
  searchOldChats,
} from "@/domains/chat/utils/old-chats-filters";
import type {
  Conversation,
  ConversationGroup,
} from "@/types/conversation-types";

function conversation(
  conversationId: string,
  fields: Partial<Conversation> = {},
): Conversation {
  return { conversationId, lastMessageAt: 1, ...fields };
}

const GROUPS: ConversationGroup[] = [
  { id: "group-a", name: "Work", sortPosition: 0, isSystemGroup: false },
  { id: "group-b", name: "Home", sortPosition: 1, isSystemGroup: false },
];

const ROWS: Conversation[] = [
  conversation("conv-native", { originChannel: "vellum" }),
  conversation("conv-slack", { originChannel: "slack" }),
  conversation("conv-grouped", { groupId: "group-a" }),
  conversation("conv-done", { archivedAt: 5 }),
  conversation("conv-background", { conversationType: "background" }),
  conversation("conv-scheduled", { conversationType: "scheduled" }),
];

describe("filterOldChats", () => {
  test("hides automated rows from every view but Background", () => {
    expect(
      filterOldChats(ROWS, { kind: "all" }).map((c) => c.conversationId),
    ).toEqual(["conv-native", "conv-slack", "conv-grouped", "conv-done"]);
  });

  test("shows only automated rows under Background", () => {
    expect(
      filterOldChats(ROWS, { kind: "background" }).map((c) => c.conversationId),
    ).toEqual(["conv-background", "conv-scheduled"]);
  });

  test("keeps a surfaced background row in the default view", () => {
    const surfaced = conversation("conv-surfaced", {
      conversationType: "background",
      surfacedAt: 9,
    });
    expect(
      filterOldChats([surfaced], { kind: "all" }).map((c) => c.conversationId),
    ).toEqual(["conv-surfaced"]);
  });

  test("narrows to archived rows under Done", () => {
    expect(
      filterOldChats(ROWS, { kind: "done" }).map((c) => c.conversationId),
    ).toEqual(["conv-done"]);
  });

  test("narrows to one channel and to one group", () => {
    expect(
      filterOldChats(ROWS, { kind: "channel", channelId: "slack" }).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["conv-slack"]);
    expect(
      filterOldChats(ROWS, { kind: "group", groupId: "group-a" }).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["conv-grouped"]);
  });
});

describe("oldChatsFilters", () => {
  test("offers All, Done, the external channels, the used groups, then Background", () => {
    expect(oldChatsFilters(ROWS, GROUPS).map(oldChatsFilterKey)).toEqual([
      "all",
      "done",
      "channel:slack",
      "group:group-a",
      "background",
    ]);
  });

  test("offers no chip for a group nothing is filed into", () => {
    expect(
      oldChatsFilters([conversation("conv-1")], GROUPS).map(oldChatsFilterKey),
    ).toEqual(["all", "done", "background"]);
  });

  test("offers no chip for a channel only an automated row carries", () => {
    const rows = [
      conversation("conv-run", {
        conversationType: "background",
        originChannel: "slack",
      }),
    ];
    expect(oldChatsFilters(rows, GROUPS).map(oldChatsFilterKey)).toEqual([
      "all",
      "done",
      "background",
    ]);
  });
});

describe("searchOldChats", () => {
  const displayTitle = (title: string | null | undefined) =>
    title?.trim() ? title : "New chat";
  const rows = [
    conversation("conv-1", { title: "Quarterly plan" }),
    conversation("conv-2", { title: "" }),
  ];

  test("returns every row for an empty query", () => {
    expect(searchOldChats(rows, "  ", displayTitle)).toEqual(rows);
  });

  test("matches the persisted title, ignoring case", () => {
    expect(
      searchOldChats(rows, "QUARTERLY", displayTitle).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["conv-1"]);
  });

  test("matches the label an untitled row renders as", () => {
    expect(
      searchOldChats(rows, "new chat", displayTitle).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["conv-2"]);
  });
});

describe("filterFromSearchParams", () => {
  const available = { channelIds: ["slack"], groupIds: ["group-a"] };

  test("reads a channel, a group and a named view off the URL", () => {
    expect(
      filterFromSearchParams(new URLSearchParams("channel=slack"), available),
    ).toEqual({ kind: "channel", channelId: "slack" });
    expect(
      filterFromSearchParams(new URLSearchParams("group=group-a"), available),
    ).toEqual({ kind: "group", groupId: "group-a" });
    expect(
      filterFromSearchParams(new URLSearchParams("filter=done"), available),
    ).toEqual({ kind: "done" });
    expect(
      filterFromSearchParams(
        new URLSearchParams("filter=background"),
        available,
      ),
    ).toEqual({ kind: "background" });
  });

  test("falls back to All for a stale channel or group", () => {
    expect(
      filterFromSearchParams(
        new URLSearchParams("channel=telegram"),
        available,
      ),
    ).toEqual({ kind: "all" });
    expect(
      filterFromSearchParams(new URLSearchParams("group=gone"), available),
    ).toEqual({ kind: "all" });
  });

  test("falls back to All for an empty or unknown query string", () => {
    expect(filterFromSearchParams(new URLSearchParams(""), available)).toEqual({
      kind: "all",
    });
    expect(
      filterFromSearchParams(new URLSearchParams("filter=nope"), available),
    ).toEqual({ kind: "all" });
  });
});

describe("oldChatsSearchFor", () => {
  test("round-trips every filter through the URL", () => {
    const available = { channelIds: ["slack"], groupIds: ["group-a"] };
    for (const filter of oldChatsFilters(ROWS, GROUPS)) {
      const search = oldChatsSearchFor(filter);
      expect(
        filterFromSearchParams(new URLSearchParams(search), available),
      ).toEqual(filter);
    }
  });

  test("gives the default view no query string at all", () => {
    expect(oldChatsSearchFor({ kind: "all" })).toBe("");
  });
});
