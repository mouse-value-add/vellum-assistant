/**
 * Old chats: the whole conversation history on one page, banded by date and
 * narrowed by a chip row.
 *
 * Presentational. Everything it cannot know on its own arrives as a prop, so
 * a story renders exactly what ships. The row actions come through
 * {@link ConversationListContextValue}, the same channel the sidebar's rows
 * read, so this page's right-click menu is the sidebar's menu rather than a
 * second copy of it.
 *
 * Quiet by intent: one glyph per row, a muted band label, no colour beyond
 * the selected chip. The list is virtualized and pages on scroll, so the band
 * headings travel with their rows instead of sticking.
 */

import { Check, RotateCcw, Search } from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import {
  Button,
  ContextMenu,
  FilterChip,
  Input,
  PanelItem,
  VirtualList,
} from "@vellumai/design-library";

import { PageShell } from "@/components/page-shell";
import {
  ConversationListProvider,
  useConversationListContext,
  type ConversationListContextValue,
} from "@/domains/chat/components/conversation-list-context";
import {
  buildMenuProps,
  skipNestedControls,
} from "@/domains/chat/components/conversation-row";
import {
  ConversationActionsSheet,
  renderConversationMenuItems,
} from "@/domains/chat/components/conversation-actions-menu";
import { LoadMoreSentinel } from "@/domains/chat/components/load-more-sentinel";
import { useLongPressSheet } from "@/hooks/use-long-press-sheet";
import {
  filterOldChats,
  isDoneConversation,
  oldChatsFilterKey,
  oldChatsFilters,
  searchOldChats,
  type OldChatsFilter,
} from "@/domains/chat/utils/old-chats-filters";
import { formatLocale, useTranslation, type TFunction } from "@/i18n";
import { formatRelativeTime } from "@/lib/relative-time";
import type {
  Conversation,
  ConversationGroup,
} from "@/types/conversation-types";
import { bucketByDate, type DateBucketId } from "@/utils/bucket-by-date";
import { ChannelIcon, getChannelLabel } from "@/utils/channel-presentation";
import { useDisplayConversationTitle } from "@/utils/conversation-title";
import { isPointerCoarse } from "@/utils/pointer";

export interface OldChatsPageProps {
  /** Every row loaded so far, unfiltered and recency-ordered. */
  conversations: Conversation[];
  /** Custom groups, for the chip labels. */
  groups: ConversationGroup[];
  /** The selected chip. The URL owns it, so the page never changes it alone. */
  filter: OldChatsFilter;
  onFilterChange: (filter: OldChatsFilter) => void;
  /** Row actions and the open handler, shared with the sidebar's rows. */
  listContext: ConversationListContextValue;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The instant the date bands are measured against. Defaults to now. */
  now?: Date;
}

/** One rendered line: a band heading, or a conversation under it. */
type OldChatsListItem =
  | { kind: "header"; key: string; label: string }
  | { kind: "row"; key: string; conversation: Conversation };

/**
 * Spelled out rather than built from the band's kind: the catalog guard finds
 * a key by its literal in source, so an interpolated key reads as four
 * unreferenced entries and is deleted the next time the catalogs are swept.
 */
const BAND_LABEL_KEYS = {
  today: "oldChatsPage.band.today",
  yesterday: "oldChatsPage.band.yesterday",
  previous7Days: "oldChatsPage.band.previous7Days",
  previous30Days: "oldChatsPage.band.previous30Days",
} as const;

function bandLabel(
  id: DateBucketId,
  t: TFunction<"chat">,
  locale: string,
): string {
  if (id.kind === "month") {
    return new Date(id.year, id.month, 1).toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
  }
  return t(BAND_LABEL_KEYS[id.kind]);
}

/**
 * The instant a row is filed under: its last message, falling back to when it
 * was created, which is what a chat with no messages yet has.
 */
function rowTime(conversation: Conversation): number | undefined {
  return conversation.lastMessageAt ?? conversation.createdAt;
}

function OldChatsRow({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation("chat");
  const displayTitle = useDisplayConversationTitle();
  const ctx = useConversationListContext();
  const done = isDoneConversation(conversation);
  const timestamp = rowTime(conversation);
  const relative =
    timestamp === undefined
      ? ""
      : formatRelativeTime(timestamp, {
          locale: formatLocale(),
          minimumUnit: "minute",
        });
  const toggleLabel = done
    ? t("conversationActions.reopen")
    : t("conversationActions.markAsDone");

  const longPress = useLongPressSheet({ shouldSkip: skipNestedControls });
  const menuProps = buildMenuProps(ctx, conversation);
  const toggleDone = useCallback(() => {
    if (done) {
      ctx.onUnarchive?.(conversation);
    } else {
      ctx.onArchive?.(conversation);
    }
  }, [ctx, conversation, done]);

  const row = (
    <PanelItem
      label={displayTitle(conversation.title)}
      aria-label={displayTitle(conversation.title)}
      leadingSlot={
        <ChannelIcon
          channelId={conversation.originChannel}
          className="size-4 shrink-0 text-[color:var(--content-tertiary)]"
        />
      }
      badge={
        done
          ? t("oldChatsPage.doneMeta", { time: relative })
          : relative || undefined
      }
      badgeBare
      onSelect={() => ctx.onSelect(conversation.conversationId)}
      trailingAction={
        <Button
          variant="ghost"
          size="compact"
          iconOnly={done ? <RotateCcw aria-hidden /> : <Check aria-hidden />}
          aria-label={toggleLabel}
          tooltip={toggleLabel}
          onClick={toggleDone}
        />
      }
      className="min-h-[36px] px-2 text-[var(--content-default)]"
      title={
        timestamp === undefined
          ? undefined
          : new Date(timestamp).toLocaleString(formatLocale())
      }
    />
  );

  /* Touch: a long press opens the actions sheet instead of Radix's
     pointer-positioned context popover, matching the sidebar's rows. The
     wrapper adds no layout box and the sheet is its sibling, which is what
     `useLongPressSheet` requires. */
  if (isPointerCoarse()) {
    return (
      <>
        <div {...longPress.wrapperProps}>{row}</div>
        <ConversationActionsSheet
          {...menuProps}
          open={longPress.open}
          onOpenChange={longPress.onOpenChange}
        />
      </>
    );
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
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

export function OldChatsPage({
  conversations,
  groups,
  filter,
  onFilterChange,
  listContext,
  hasMore,
  onLoadMore,
  isLoading,
  isError,
  onRetry,
  now,
}: OldChatsPageProps) {
  const { t } = useTranslation("chat");
  const displayTitle = useDisplayConversationTitle();
  const [searchText, setSearchText] = useState("");

  const chips = useMemo(
    () => oldChatsFilters(conversations, groups, filter),
    [conversations, groups, filter],
  );

  const rows = useMemo(
    () =>
      searchOldChats(
        filterOldChats(conversations, filter),
        searchText,
        displayTitle,
      ),
    [conversations, filter, searchText, displayTitle],
  );

  /* One `now` for every band in a render, so two rows minutes apart cannot
     land on opposite sides of a midnight that moved between them. */
  const bandedAt = useMemo(() => now ?? new Date(), [now]);
  const locale = formatLocale();

  const items = useMemo((): OldChatsListItem[] => {
    const bands = bucketByDate(rows, rowTime, bandedAt);
    return bands.flatMap((band): OldChatsListItem[] => [
      {
        kind: "header",
        key: `header:${band.key}`,
        label: bandLabel(band.id, t, locale),
      },
      ...band.items.map(
        (conversation): OldChatsListItem => ({
          kind: "row",
          key: conversation.conversationId,
          conversation,
        }),
      ),
    ]);
  }, [rows, bandedAt, t, locale]);

  const groupName = useCallback(
    (groupId: string) => groups.find((g) => g.id === groupId)?.name ?? groupId,
    [groups],
  );

  const chipLabel = useCallback(
    (chip: OldChatsFilter): string => {
      switch (chip.kind) {
        case "all":
          return t("oldChatsPage.chip.all");
        case "done":
          return t("oldChatsPage.chip.done");
        case "background":
          return t("oldChatsPage.chip.background");
        case "channel":
          return getChannelLabel(chip.channelId);
        case "group":
          return groupName(chip.groupId);
      }
    },
    [t, groupName],
  );

  const renderItem = useCallback(
    (_index: number, item: OldChatsListItem) =>
      item.kind === "header" ? (
        <h2 className="px-2 pt-6 pb-1 text-body-small-lighter text-[color:var(--content-tertiary)]">
          {item.label}
        </h2>
      ) : (
        <OldChatsRow conversation={item.conversation} />
      ),
    [],
  );

  const endReached = useCallback(() => {
    if (hasMore) {
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  return (
    <PageShell>
      <h1 className="mb-4 shrink-0 text-title-large text-[var(--content-default)]">
        {t("oldChatsPage.title")}
      </h1>

      <Input
        fullWidth
        wrapperClassName="shrink-0"
        type="text"
        placeholder={t("oldChatsPage.searchPlaceholder")}
        value={searchText}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setSearchText(event.target.value)
        }
        leftIcon={<Search size={16} />}
      />

      <div
        role="group"
        aria-label={t("oldChatsPage.filterAria")}
        className="mt-4 mb-2 flex shrink-0 gap-2 overflow-x-auto pb-1"
      >
        {chips.map((chip) => {
          const key = oldChatsFilterKey(chip);
          return (
            <FilterChip
              key={key}
              selected={key === oldChatsFilterKey(filter)}
              onClick={() => onFilterChange(chip)}
            >
              {chipLabel(chip)}
            </FilterChip>
          );
        })}
      </div>

      <div className="min-h-0 flex-1">
        <OldChatsBody
          items={items}
          isLoading={isLoading}
          isError={isError}
          onRetry={onRetry}
          searchText={searchText}
          listContext={listContext}
          renderItem={renderItem}
          hasMore={hasMore}
          endReached={endReached}
        />
      </div>
    </PageShell>
  );
}

/** The page's spinner, shared by the first read and the search for a match. */
function OldChatsSpinner({ label }: { label: string }) {
  return (
    <div
      className="size-6 animate-spin rounded-full border-2 border-[var(--border-base)] border-t-[var(--primary-base)]"
      role="status"
      aria-label={label}
    />
  );
}

/**
 * The list region and the states that replace it. Split out so each branch's
 * copy is explicit and the page above stays the layout alone.
 */
function OldChatsBody({
  items,
  isLoading,
  isError,
  onRetry,
  searchText,
  listContext,
  renderItem,
  hasMore,
  endReached,
}: {
  items: OldChatsListItem[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  searchText: string;
  listContext: ConversationListContextValue;
  renderItem: (index: number, item: OldChatsListItem) => ReactNode;
  hasMore: boolean;
  endReached: () => void;
}) {
  const { t } = useTranslation("chat");

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <OldChatsSpinner label={t("oldChatsPage.loading")} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-body-medium-lighter text-[var(--content-tertiary)]">
          {t("oldChatsPage.loadError")}
        </p>
        <Button variant="outlined" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          {t("oldChatsPage.retry")}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    /* The chips and the search run over the loaded window, while the window
       itself is one global recency page, so a view with no match here may
       still have plenty further back. The list is what fires `endReached`,
       and it is not on screen, so a sentinel keeps the pages coming until a
       match arrives or the server says there are none left. Only then is the
       empty state the truth. */
    if (hasMore) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <OldChatsSpinner label={t("oldChatsPage.loading")} />
          <LoadMoreSentinel onVisible={endReached} />
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <p className="text-body-medium-lighter text-[var(--content-tertiary)]">
          {searchText.trim()
            ? t("oldChatsPage.noMatches", { query: searchText.trim() })
            : t("oldChatsPage.empty")}
        </p>
      </div>
    );
  }

  return (
    <ConversationListProvider value={listContext}>
      <VirtualList
        items={items}
        itemContent={renderItem}
        computeItemKey={(_index, item) => item.key}
        endReached={endReached}
        className="h-full bg-transparent"
      />
    </ConversationListProvider>
  );
}
