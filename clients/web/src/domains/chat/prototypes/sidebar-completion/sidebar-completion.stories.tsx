/**
 * Hi-fi pass on the sidebar redesign agreed at the Sep 14 standup: the
 * 3-dot menu on a conversation row becomes a Done check on hover, and the
 * rest of the row's actions move to right-click. Done conversations leave
 * the list for a Done fold. Channel sections are untouched.
 *
 * Everything on screen is the shipped sidebar's own parts: the `SideMenu`
 * shell with the same classes `AssistantSideMenu` gives it, the built-in
 * nav block, `ConversationNavSection` for every section, `PanelItem` for
 * every row, and the real conversation context menu. The one prototype
 * piece is the row's trailing control, a check where the ellipsis is, which
 * is exactly the change under review.
 *
 * "Done" is archive underneath: the check sets `archivedAt`, the Done fold
 * lists what has it, and Reopen clears it. Everything is interactive and
 * story-local.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Check, CheckCheck, RotateCcw } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  ContextMenu,
  PanelItem,
  SideMenu,
  Toaster,
  Tooltip,
  toast,
} from "@vellumai/design-library";

import { CollapsibleNavSection } from "@/components/collapsible-nav-section";
import { SIDEBAR_STACK_GAP } from "@/components/sidebar-nav-geometry";
import {
  renderConversationMenuItems,
} from "@/domains/chat/components/conversation-actions-menu";
import {
  ConversationListProvider,
  useConversationListContext,
} from "@/domains/chat/components/conversation-list-context";
import { ConversationNavSection } from "@/domains/chat/components/conversation-nav-section";
import { buildMenuProps } from "@/domains/chat/components/conversation-row";
import { PreferencesMenu } from "@/domains/chat/components/preferences-menu";
import { SideMenuBuiltInNav } from "@/domains/chat/components/side-menu-built-in-nav";
import {
  hasThreadStatus,
  ThreadStatusIndicator,
} from "@/domains/chat/components/thread-status-indicator";
import { RECENTS_SECTION_ICON } from "@/domains/chat/utils/sidebar-section-icon";
import {
  DEFAULT_GROUP_ICON,
  getGroupIcon,
} from "@/domains/chat/utils/group-icon-registry";
import { appsGetQueryKey } from "@/generated/daemon/@tanstack/react-query.gen";
import { useTranslation } from "@/i18n";
import { useAuthStore } from "@/stores/auth-store";
import { useResolvedAssistantsStore } from "@/stores/resolved-assistants-store";
import { getChannelIcon, getChannelLabel } from "@/utils/channel-presentation";
import { isChannelConversation } from "@/domains/chat/utils/conversation-channel";
import { Pin } from "lucide-react";
import type {
  Conversation,
  ConversationGroup,
} from "@/types/conversation-types";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ASSISTANT_ID = "asst-done";
const NOW = Date.UTC(2026, 8, 14, 16, 30);
const HOUR = 3_600_000;

function conversation(
  conversationId: string,
  title: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return { conversationId, title, ...overrides };
}

const CONVERSATIONS: Conversation[] = [
  conversation("p1", "Q3 planning doc", { isPinned: true, displayOrder: 0 }),

  conversation("a1", "Morning briefing", { lastMessageAt: NOW - 8 * HOUR }),
  conversation("a2", "Launch email draft", { lastMessageAt: NOW - 5 * HOUR }),
  conversation("a3", "Usage numbers", { lastMessageAt: NOW - 3 * HOUR }),
  conversation("a4", "Launch review brief", {
    lastMessageAt: NOW - HOUR,
    hasUnseenLatestAssistantMessage: true,
  }),
  conversation("a5", "Is the build green after the auth change?", {
    lastMessageAt: NOW - 10 * 60_000,
  }),

  conversation("d1", "Cozy gift ideas", {
    lastMessageAt: NOW - 26 * HOUR,
    archivedAt: NOW - 25 * HOUR,
  }),
  conversation("d2", "Apple Reminders access", {
    lastMessageAt: NOW - 30 * HOUR,
    archivedAt: NOW - 29 * HOUR,
  }),
  conversation("d3", "OS beta image support bug", {
    lastMessageAt: NOW - 3 * 24 * HOUR,
    archivedAt: NOW - 3 * 24 * HOUR,
  }),
  conversation("d4", "Pointing device detection", {
    lastMessageAt: NOW - 4 * 24 * HOUR,
    archivedAt: NOW - 4 * 24 * HOUR,
  }),
  conversation("d5", "Email address inquiry", {
    lastMessageAt: NOW - 12 * 24 * HOUR,
    archivedAt: NOW - 12 * 24 * HOUR,
  }),

  conversation("g1", "Auth rewrite - PR #412", {
    groupId: "grp-reviews",
    displayOrder: 0,
  }),
  conversation("g2", "Search relevance - PR #418", {
    groupId: "grp-reviews",
    displayOrder: 1,
  }),

  conversation("s1", "#eng-alerts - deploy failed", {
    originChannel: "slack",
    lastMessageAt: NOW - 2 * HOUR,
  }),
  conversation("s2", "#design - icon set review", {
    originChannel: "slack",
    lastMessageAt: NOW - 6 * HOUR,
    hasUnseenLatestAssistantMessage: true,
  }),
];

const GROUPS: ConversationGroup[] = [
  {
    id: "grp-reviews",
    name: "PR Reviews",
    icon: "code",
    sortPosition: 0,
    isSystemGroup: false,
  },
];

/** The message a resurfaced conversation arrives with, for the demo. */
const RESURFACE_ID = "d1";

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

interface CompletionSidebarArgs {
  /** What the open list is called. */
  activeLabel: string;
  /** Where done conversations go. */
  done: "fold" | "hidden";
  /** How the Done fold is arranged. */
  doneGrouping: "flat" | "by-day";
  /** Show the channel sections below (the grouped view). */
  channelSections: boolean;
  showPinned: boolean;
  showGroups: boolean;
  /** Marking done shows a toast with Undo. */
  undoToast: boolean;
  /**
   * Demo of the open question from the standup: a done conversation gets a
   * new assistant message a few seconds after load and comes back to the
   * open list with an unread dot.
   */
  resurfaceDemo: boolean;
  /** Reopen from the Done fold is a check-shaped control too, or an arrow. */
  reopenGlyph: "check" | "arrow";
  width: number;
}

// ---------------------------------------------------------------------------
// Row: the shipped row's parts with a check where the ellipsis was
// ---------------------------------------------------------------------------

function CompletionRow({
  conversation,
  reopenGlyph,
}: {
  conversation: Conversation;
  reopenGlyph: "check" | "arrow";
}) {
  const ctx = useConversationListContext();
  const { t } = useTranslation("chat");
  const { conversationId } = conversation;
  const menuProps = buildMenuProps(ctx, conversation);
  const isDone = conversation.archivedAt != null;
  const isChannel = isChannelConversation(conversation);
  const status = {
    isProcessing: ctx.processingConversationIds?.has(conversationId) ?? false,
    needsAttention: ctx.attentionConversationIds?.has(conversationId) ?? false,
    hasUnread: conversation.hasUnseenLatestAssistantMessage === true,
  };

  // Channel rows keep no check: the standup kept channels as they are.
  const check = isChannel ? undefined : (
    <Tooltip content={isDone ? "Reopen" : "Done"} side="right">
      <button
        type="button"
        aria-label={isDone ? "Reopen" : "Done"}
        onClick={(event) => {
          event.stopPropagation();
          if (isDone) {
            ctx.onUnarchive?.(conversation);
          } else {
            ctx.onArchive?.(conversation);
          }
        }}
        // The ellipsis trigger's own box, class for class, so the check sits
        // where the "…" did and reads at the same weight.
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--content-tertiary)] outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--content-secondary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {isDone && reopenGlyph === "arrow" ? (
          <RotateCcw size={14} />
        ) : (
          <Check size={14} />
        )}
      </button>
    </Tooltip>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <PanelItem
          label={conversation.title ?? ""}
          marqueeOnHover
          active={conversationId === ctx.activeConversationId}
          onSelect={() => ctx.onSelect(conversationId)}
          badge={
            hasThreadStatus(status) ? (
              <ThreadStatusIndicator {...status} />
            ) : undefined
          }
          badgeBare
          trailingAction={check}
          className="h-[30px] p-[6px] text-[var(--content-default)]"
        />
      </ContextMenu.Trigger>
      <ContextMenu.Content onClick={(event) => event.stopPropagation()}>
        {renderConversationMenuItems({
          Primitive: ContextMenu,
          t,
          ...menuProps,
        })}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}

function Rows({
  items,
  reopenGlyph,
}: {
  items: Conversation[];
  reopenGlyph: "check" | "arrow";
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      {items.map((c) => (
        <CompletionRow
          key={c.conversationId}
          conversation={c}
          reopenGlyph={reopenGlyph}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Done fold grouping
// ---------------------------------------------------------------------------

function dayBucket(archivedAt: number): "Today" | "Yesterday" | "This week" | "Earlier" {
  const ago = NOW - archivedAt;
  if (ago < 24 * HOUR) {
    return "Today";
  }
  if (ago < 48 * HOUR) {
    return "Yesterday";
  }
  if (ago < 7 * 24 * HOUR) {
    return "This week";
  }
  return "Earlier";
}

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

function CompletionSidebar(args: CompletionSidebarArgs) {
  const [conversations, setConversations] = useState(CONVERSATIONS);
  const [activeId, setActiveId] = useState<string | undefined>("a4");
  const [open, setOpen] = useState<string[]>([
    "pinned",
    "grp-reviews",
    "active",
    "slack",
  ]);

  const patch = useCallback(
    (id: string, changes: Partial<Conversation>) => {
      setConversations((prev) =>
        prev.map((c) => (c.conversationId === id ? { ...c, ...changes } : c)),
      );
    },
    [],
  );

  const markDone = useCallback(
    (c: Conversation) => {
      patch(c.conversationId, { archivedAt: Date.now() });
      if (args.undoToast) {
        toast("Done", {
          description: c.title,
          action: {
            label: "Undo",
            onClick: () => patch(c.conversationId, { archivedAt: undefined }),
          },
        });
      }
    },
    [args.undoToast, patch],
  );

  // The standup's open question, made visible: a done conversation gets a
  // new assistant message and comes back to the open list, unread.
  useEffect(() => {
    if (!args.resurfaceDemo) {
      return;
    }
    const timer = window.setTimeout(() => {
      patch(RESURFACE_ID, {
        archivedAt: undefined,
        hasUnseenLatestAssistantMessage: true,
        lastMessageAt: NOW,
      });
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [args.resurfaceDemo, patch]);

  const ctx = useMemo(
    () => ({
      activeConversationId: activeId,
      onSelect: (id: string) => setActiveId(id),
      onPin: (c: Conversation) => patch(c.conversationId, { isPinned: !c.isPinned }),
      onRename: () => {},
      onArchive: markDone,
      onUnarchive: (c: Conversation) => patch(c.conversationId, { archivedAt: undefined }),
      onDelete: (c: Conversation) =>
        setConversations((prev) => prev.filter((x) => x.conversationId !== c.conversationId)),
      onMarkRead: (c: Conversation) =>
        patch(c.conversationId, { hasUnseenLatestAssistantMessage: false }),
      onMarkUnread: (c: Conversation) =>
        patch(c.conversationId, { hasUnseenLatestAssistantMessage: true }),
      conversationGroups: GROUPS,
      onMoveToGroup: (c: Conversation, groupId: string) =>
        patch(c.conversationId, { groupId }),
      onCreateGroupInto: () => {},
      onRemoveFromGroup: (c: Conversation) => patch(c.conversationId, { groupId: undefined }),
    }),
    [activeId, markDone, patch],
  );

  const byRecency = (a: Conversation, b: Conversation) =>
    (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
  const openOnes = conversations.filter((c) => c.archivedAt == null);
  const pinned = openOnes.filter((c) => c.isPinned);
  const channels = args.channelSections
    ? [...new Set(openOnes.filter((c) => c.originChannel).map((c) => c.originChannel!))]
    : [];
  const inChannel = (c: Conversation) =>
    args.channelSections && c.originChannel != null;
  const active = openOnes
    .filter((c) => !c.isPinned && !c.groupId && !inChannel(c))
    .sort(byRecency);
  const done = conversations
    .filter((c) => c.archivedAt != null)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const doneByDay = (["Today", "Yesterday", "This week", "Earlier"] as const)
    .map((label) => ({
      label,
      items: done.filter((c) => dayBucket(c.archivedAt ?? 0) === label),
    }))
    .filter((g) => g.items.length > 0);

  const section = (
    value: string,
    label: string,
    icon: Parameters<typeof ConversationNavSection>[0]["icon"],
    items: Conversation[],
    extra?: Partial<Parameters<typeof ConversationNavSection>[0]>,
    children?: ReactNode,
  ) => (
    <ConversationNavSection
      key={value}
      value={value}
      label={label}
      icon={icon}
      items={items}
      collapsedIndicator={
        items.some((c) => c.hasUnseenLatestAssistantMessage) ? (
          <ThreadStatusIndicator hasUnread />
        ) : undefined
      }
      {...extra}
    >
      {children ?? <Rows items={items} reopenGlyph={args.reopenGlyph} />}
    </ConversationNavSection>
  );

  return (
    <ConversationListProvider value={ctx}>
      <SideMenu
        ariaLabel="Assistant navigation"
        collapsed={false}
        variant="rail"
        width={args.width}
        onWidthChange={() => {}}
        className="relative h-full border-0 bg-transparent p-0 pr-[6px]"
      >
        <SideMenu.Header>
          <SideMenuBuiltInNav
            assistantId={ASSISTANT_ID}
            assistantName="Vex"
            collapsed={false}
            variant="rail"
            onOpenIntelligence={() => {}}
            onStartNewConversation={() => {}}
          />
        </SideMenu.Header>
        <SideMenu.Body className={`${SIDEBAR_STACK_GAP} pt-2`}>
          <CollapsibleNavSection.Root
            type="multiple"
            value={open}
            onValueChange={setOpen}
          >
            {args.showPinned && pinned.length > 0
              ? section("pinned", "Pinned", Pin, pinned, { unbounded: true })
              : null}
            {args.showGroups
              ? GROUPS.map((g) =>
                  section(
                    g.id,
                    g.name,
                    getGroupIcon(g.icon) ?? DEFAULT_GROUP_ICON,
                    openOnes.filter((c) => c.groupId === g.id),
                  ),
                )
              : null}
            {section("active", args.activeLabel, RECENTS_SECTION_ICON, active, {
              isLast: args.done === "hidden" && channels.length === 0,
            })}
            {args.done === "fold"
              ? section(
                  "done",
                  "Done",
                  CheckCheck,
                  done,
                  { isLast: channels.length === 0 },
                  args.doneGrouping === "by-day" ? (
                    <CollapsibleNavSection.Root type="multiple" defaultValue={["done-Today"]}>
                      {doneByDay.map((g) => (
                        <ConversationNavSection
                          key={g.label}
                          value={`done-${g.label}`}
                          label={g.label}
                          items={g.items}
                          unbounded
                        >
                          <Rows items={g.items} reopenGlyph={args.reopenGlyph} />
                        </ConversationNavSection>
                      ))}
                    </CollapsibleNavSection.Root>
                  ) : undefined,
                )
              : null}
            {channels.map((ch, i) =>
              section(
                ch,
                getChannelLabel(ch),
                getChannelIcon(ch),
                openOnes.filter((c) => c.originChannel === ch).sort(byRecency),
                { isLast: i === channels.length - 1 },
              ),
            )}
          </CollapsibleNavSection.Root>
        </SideMenu.Body>
        <SideMenu.Footer>
          <PreferencesMenu assistantId={ASSISTANT_ID} />
        </SideMenu.Footer>
      </SideMenu>
      <Toaster />
    </ConversationListProvider>
  );
}

// ---------------------------------------------------------------------------
// Story plumbing (the shipped sidebar story's seeds, so the header renders)
// ---------------------------------------------------------------------------

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
client.setQueryData(appsGetQueryKey({ path: { assistant_id: ASSISTANT_ID } }), {
  apps: [],
});
client.setQueryData(["assistant-capability", "appPins", ASSISTANT_ID], true);

function seedStores() {
  useAuthStore.setState({ sessionStatus: "authenticated" });
  useResolvedAssistantsStore.setState({ activeAssistantId: ASSISTANT_ID });
}

const meta: Meta<CompletionSidebarArgs> = {
  title: "Chat/Prototypes/Sidebar Completion",
  tags: ["!autodocs"],
  parameters: { layout: "fullscreen" },
  beforeEach: seedStores,
  args: {
    activeLabel: "Active",
    done: "fold",
    doneGrouping: "flat",
    channelSections: true,
    showPinned: true,
    showGroups: true,
    undoToast: true,
    resurfaceDemo: false,
    reopenGlyph: "arrow",
    width: 280,
  },
  argTypes: {
    activeLabel: {
      control: "radio",
      options: ["Active", "Chats", "Today", "Open"],
      description: "What the open list is called.",
      table: { category: "Naming" },
    },
    done: {
      control: "radio",
      options: ["fold", "hidden"],
      description:
        "fold = a Done section below Active. hidden = done conversations leave the sidebar entirely (archive as it is today).",
      table: { category: "Done" },
    },
    doneGrouping: {
      control: "radio",
      options: ["flat", "by-day"],
      description: "Done as one list, or folded by day inside the section.",
      table: { category: "Done" },
    },
    reopenGlyph: {
      control: "radio",
      options: ["arrow", "check"],
      description: "The control on a done row: an undo arrow, or the same check.",
      table: { category: "Done" },
    },
    undoToast: {
      control: "boolean",
      description: "Marking done shows a toast with Undo.",
      table: { category: "Done" },
    },
    resurfaceDemo: {
      control: "boolean",
      description:
        "Demo: 5s after load, a done conversation gets a new assistant message and returns to the open list with an unread dot.",
      table: { category: "Done" },
    },
    channelSections: {
      control: "boolean",
      description: "The grouped view: one section per channel, below, without checks.",
      table: { category: "Sections" },
    },
    showPinned: { control: "boolean", table: { category: "Sections" } },
    showGroups: { control: "boolean", table: { category: "Sections" } },
    width: {
      control: { type: "range", min: 240, max: 360, step: 10 },
      table: { category: "Sections" },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <div className="flex h-screen gap-4 bg-[var(--surface-base)] p-4">
          <aside className="w-fit shrink-0 overflow-hidden">
            <Story />
          </aside>
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" />
        </div>
      </QueryClientProvider>
    ),
  ],
  render: (args) => <CompletionSidebar {...args} />,
};

export default meta;
type Story = StoryObj<CompletionSidebarArgs>;

/**
 * The agreed shape. Hover a row for the check; right-click for everything
 * the 3-dot menu held; open Done to see what left.
 */
export const Default: Story = {};

/** Done folded by day inside the section. */
export const DoneByDay: Story = {
  args: { doneGrouping: "by-day" },
};

/** Archive as it is today: done rows leave the sidebar with nothing to open. */
export const DoneHidden: Story = {
  args: { done: "hidden" },
};

/**
 * The resurfacing question: five seconds in, a done conversation gets a
 * new assistant message and comes back to Active with an unread dot.
 */
export const Resurfacing: Story = {
  args: { resurfaceDemo: true },
};

/** The ungrouped view: channel conversations sit in Active, still without a check. */
export const ChannelsUngrouped: Story = {
  args: { channelSections: false },
};

/** Just the list: no pinned, no groups, no channels. */
export const Bare: Story = {
  args: { showPinned: false, showGroups: false, channelSections: false },
};
