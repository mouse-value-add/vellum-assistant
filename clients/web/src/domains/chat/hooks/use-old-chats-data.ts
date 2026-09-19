/**
 * The Old chats page's rows: the whole history, paged on scroll, with a
 * fallback for an assistant that cannot serve it in one read.
 *
 * The page reads `conversationType=all&archiveStatus=all`, which is one
 * recency-ordered cursor across every type and both archive states. An
 * assistant that predates that value rejects the request with a 400, so this
 * watches for exactly that answer and switches to the four bucket reads the
 * sidebar already fills, merged into the same recency order. No version gate:
 * the assistant's own refusal is the signal, which is what
 * `docs/BACKWARDS_COMPAT.md` asks for when the old behavior is a clean refusal
 * rather than a plausible-looking wrong answer.
 *
 * The degraded path drains four caches, so it is complete but unpaginated:
 * `hasMore` is false there and the page renders everything it was handed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import {
  useAllHistoryConversationListQuery,
  useArchivedConversationListQuery,
  useBackgroundConversationListQuery,
  useConversationListQuery,
  useScheduledConversationListQuery,
} from "@/hooks/conversation-queries";
import { captureError } from "@/lib/sentry/capture-error";
import type { Conversation } from "@/types/conversation-types";
import { ApiError } from "@/utils/api-errors";
import { mergeConversationLists } from "@/utils/conversation-cache";
import { loadMoreConversations } from "@/utils/conversation-cache-mutations";
import { ALL_HISTORY_FILTER } from "@/utils/conversation-list-keys";
import { byTimestampDesc } from "@/utils/conversation-order";

function noop(): void {}

/**
 * Whether this error is the assistant saying it does not know the combined
 * read. A 400 on this request can only be the rejected parameter: the route
 * takes no body, and the rest of the query is the shape every other list read
 * sends.
 */
export function isUnsupportedCombinedRead(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 400;
}

export interface OldChatsData {
  conversations: Conversation[];
  /** Whether the server holds rows past the loaded window. */
  hasMore: boolean;
  /** Extend the window by one page. A no-op on the degraded path. */
  loadMore: () => void;
  /** Nothing to show yet, and a first read still in flight. */
  isLoading: boolean;
  /** Nothing to show, and the read that would have filled it failed. */
  isError: boolean;
  retry: () => void;
}

export function useOldChatsData(assistantId: string | null): OldChatsData {
  const queryClient = useQueryClient();

  /* Which assistant refused the combined read, so the refusal survives the
     list invalidation every archive settle fires and is dropped when the
     active assistant changes. A capability fact about the connected
     assistant, not a copy of server data: the rows themselves are only ever
     read from the query caches below. */
  const [refusedBy, setRefusedBy] = useState<string | null>(null);
  const refused = refusedBy !== null && refusedBy === assistantId;

  const combined = useAllHistoryConversationListQuery(assistantId, !refused);
  const combinedError = combined.error;
  useEffect(() => {
    if (assistantId && isUnsupportedCombinedRead(combinedError)) {
      setRefusedBy(assistantId);
    }
  }, [assistantId, combinedError]);

  const degraded = refused || isUnsupportedCombinedRead(combinedError);

  /* Mounted disabled on the supported path, where they subscribe to the
     caches the sidebar fills without issuing a request of their own. */
  const foreground = useConversationListQuery(assistantId, degraded);
  const background = useBackgroundConversationListQuery(assistantId, degraded);
  const scheduled = useScheduledConversationListQuery(assistantId, degraded);
  const archived = useArchivedConversationListQuery(assistantId, degraded);

  const fallbackRows = useMemo(
    () =>
      [
        ...mergeConversationLists(
          foreground.conversations,
          background.conversations,
          scheduled.conversations,
          archived.conversations,
        ),
      ].sort(byTimestampDesc("lastMessageAt")),
    [
      foreground.conversations,
      background.conversations,
      scheduled.conversations,
      archived.conversations,
    ],
  );

  const loadMore = useCallback(() => {
    if (!assistantId) {
      return;
    }
    loadMoreConversations(queryClient, assistantId, ALL_HISTORY_FILTER).catch(
      (error: unknown) => {
        /* Best effort: the list re-fires this on the next scroll, so daemon
           transients filter out and only unexpected failures are reported. */
        captureError(error, {
          context: "useOldChatsData.loadMore",
          bestEffort: true,
        });
      },
    );
  }, [assistantId, queryClient]);

  const refetchForeground = foreground.refetch;
  const refetchBackground = background.refetch;
  const refetchScheduled = scheduled.refetch;
  const refetchArchived = archived.refetch;
  const retryDegraded = useCallback(() => {
    refetchForeground();
    refetchBackground();
    refetchScheduled();
    refetchArchived();
  }, [refetchForeground, refetchBackground, refetchScheduled, refetchArchived]);

  if (degraded) {
    return {
      conversations: fallbackRows,
      hasMore: false,
      loadMore: noop,
      /* Every bucket is part of the answer, so the view waits on all of them
         and fails if any of them fails: a missing bucket is missing rows the
         page claims to hold, which reads as "you have none". */
      isLoading:
        foreground.isLoading ||
        background.isLoading ||
        scheduled.isLoading ||
        archived.isLoading,
      isError:
        foreground.isError ||
        background.isError ||
        scheduled.isError ||
        archived.isError,
      retry: retryDegraded,
    };
  }

  return {
    conversations: combined.conversations,
    hasMore: combined.hasMore,
    loadMore,
    isLoading: combined.isLoading,
    /* React Query keeps the last successful page when a refetch fails, so a
       blip must not swap real rows for an error panel. */
    isError: combined.isError && !combined.hasData,
    retry: combined.refetch,
  };
}
