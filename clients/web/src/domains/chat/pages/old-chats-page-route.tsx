/**
 * Route wiring for Old chats (`/assistant/chats`).
 *
 * Resolves what the page cannot know on its own: the history to draw, the
 * groups behind the chips, which chip the URL preselected, and what every row
 * action does. The row actions come from the same `useConversationActions`
 * the sidebar's rows use, so a Done here and a Done there are one mutation
 * with one optimistic write and one invalidation.
 *
 * Behind the `sidebar-done` flag; with it off the route sends the user to
 * chat, so a stale link never opens a surface nothing else offers. The
 * redirect waits for the flag store to hydrate: on a cold load the flags
 * start out answering "no", and bouncing on that default would send a
 * remotely enabled user away from their own history.
 *
 * Mounted under `ActiveAssistantGate`, so the active id is resolved by the
 * time this renders and needs no second guard.
 */

import { useCallback, useMemo, useRef } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { useActiveAssistantId } from "@/assistant/use-active-assistant-id";
import type { ConversationListContextValue } from "@/domains/chat/components/conversation-list-context";
import {
  DeleteConversationConfirmDialog,
  useDeleteConversationConfirmation,
} from "@/domains/chat/components/delete-conversation-confirm-dialog";
import { useConversationActions } from "@/domains/chat/hooks/use-conversation-actions";
import { useOldChatsData } from "@/domains/chat/hooks/use-old-chats-data";
import { OldChatsPage } from "@/domains/chat/pages/old-chats-page";
import {
  filterFromSearchParams,
  oldChatsFilters,
  oldChatsSearchFor,
  type OldChatsFilter,
} from "@/domains/chat/utils/old-chats-filters";
import {
  useConversationGroupsQuery,
  useConversationListQuery,
} from "@/hooks/conversation-queries";
import { useConversationStore } from "@/stores/conversation-store";
import { useClientFeatureFlagStore } from "@/stores/client-feature-flag-store";
import { isCustomGroupId } from "@/utils/conversation-predicates";
import {
  navigateToConversation,
  navigateToNewConversation,
} from "@/utils/conversation-navigation";
import { routes } from "@/utils/routes";

export function OldChatsPageRoute() {
  const navigate = useNavigate();
  const assistantId = useActiveAssistantId();
  const flagsHydrated = useClientFeatureFlagStore.use.hydrated();
  const enabled = useClientFeatureFlagStore.use.sidebarDone();
  const [searchParams, setSearchParams] = useSearchParams();

  const history = useOldChatsData(assistantId);
  const { conversationGroups } = useConversationGroupsQuery(assistantId);

  /* The foreground list the sidebar already holds. `useConversationActions`
     reads it to pick the conversation to land on when the one being marked
     done is the open one; this page mounts no request of its own for it. */
  const { conversations: foreground } = useConversationListQuery(assistantId);
  const activeConversationId = useConversationStore.use.activeConversationId();
  const prePinGroupIdsRef = useRef<Map<string, string | undefined>>(new Map());

  const switchConversation = useCallback(
    (conversationId: string) => {
      navigateToConversation(navigate, conversationId);
    },
    [navigate],
  );
  const startNewConversation = useCallback(
    (opts?: { silent?: boolean }) => {
      navigateToNewConversation(navigate, opts);
    },
    [navigate],
  );

  const {
    handleArchiveConversation,
    handleUnarchiveConversation,
    handleDeleteConversation,
    handleMarkConversationRead,
    handleMarkConversationUnread,
    handleTogglePinConversation,
    handleRenameConversation,
    handleMoveToGroup,
    handleRemoveFromGroup,
  } = useConversationActions({
    assistantId,
    activeConversationId,
    conversations: foreground,
    switchConversation,
    startNewConversation,
    prePinGroupIdsRef,
  });

  const deleteGate = useDeleteConversationConfirmation({
    assistantId,
    deleteConversation: handleDeleteConversation,
  });
  const requestDelete = deleteGate.requestDelete;

  const listContext = useMemo<ConversationListContextValue>(
    () => ({
      activeConversationId: activeConversationId ?? undefined,
      onSelect: switchConversation,
      onPin: handleTogglePinConversation,
      onRename: handleRenameConversation,
      onArchive: handleArchiveConversation,
      onUnarchive: handleUnarchiveConversation,
      onDelete: requestDelete,
      onMarkRead: handleMarkConversationRead,
      onMarkUnread: handleMarkConversationUnread,
      conversationGroups,
      onMoveToGroup: handleMoveToGroup,
      onRemoveFromGroup: handleRemoveFromGroup,
    }),
    [
      activeConversationId,
      switchConversation,
      handleTogglePinConversation,
      handleRenameConversation,
      handleArchiveConversation,
      handleUnarchiveConversation,
      requestDelete,
      handleMarkConversationRead,
      handleMarkConversationUnread,
      conversationGroups,
      handleMoveToGroup,
      handleRemoveFromGroup,
    ],
  );

  /* Only a custom group earns a chip: a system group is a placement this page
     already expresses another way (a pinned chat is an ordinary row here, and
     background has a chip of its own). */
  const customGroups = useMemo(
    () => conversationGroups.filter((group) => isCustomGroupId(group.id)),
    [conversationGroups],
  );

  /* The chips the loaded rows justify, so a link naming a channel or group
     with nothing behind it falls back to All rather than opening empty. */
  const available = useMemo(() => {
    const chips = oldChatsFilters(history.conversations, customGroups);
    return {
      channelIds: chips.flatMap((chip) =>
        chip.kind === "channel" ? [chip.channelId] : [],
      ),
      groupIds: chips.flatMap((chip) =>
        chip.kind === "group" ? [chip.groupId] : [],
      ),
    };
  }, [history.conversations, customGroups]);

  const filter = useMemo(
    () => filterFromSearchParams(searchParams, available),
    [searchParams, available],
  );

  const onFilterChange = useCallback(
    (next: OldChatsFilter) => {
      /* Replace rather than push: a chip is a view of one page, and pushing
         would make Back walk every chip the user tried instead of leaving. */
      setSearchParams(new URLSearchParams(oldChatsSearchFor(next).slice(1)), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  if (!flagsHydrated) {
    return null;
  }
  if (!enabled) {
    return <Navigate to={routes.assistant} replace />;
  }

  return (
    <>
      <OldChatsPage
        conversations={history.conversations}
        groups={customGroups}
        filter={filter}
        onFilterChange={onFilterChange}
        listContext={listContext}
        hasMore={history.hasMore}
        onLoadMore={history.loadMore}
        isLoading={history.isLoading}
        isError={history.isError}
        onRetry={history.retry}
      />
      <DeleteConversationConfirmDialog
        pending={deleteGate.pending}
        onConfirm={deleteGate.confirmDelete}
        onCancel={deleteGate.cancelDelete}
      />
    </>
  );
}
