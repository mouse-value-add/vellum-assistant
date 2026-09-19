/**
 * The one place that decides whether the app says "Archive" or "Done".
 *
 * Under `sidebar-done` the archive is presented as completion: a row is
 * marked done rather than archived, a section is marked all done, and a done
 * chat carries "[Done]" instead of "[Archived]". Every surface that shows one
 * of those words reads its copy from here, so the wording cannot drift
 * between the row menu, the header dropdown, the swipe action, the bulk
 * confirmation and the Old chats page.
 *
 * Both key sets ship side by side: the flag-off catalogue entries are the
 * archive wording the app has always used, and the flag-on ones are the new
 * copy. Callers never choose a key.
 */

import { useTranslation, type TFunction } from "@/i18n";
import { useClientFeatureFlagStore } from "@/stores/client-feature-flag-store";

/** Every string whose wording depends on the flag, already resolved. */
export interface ConversationDoneLabels {
  /** Row menu, header dropdown: files the conversation away. */
  archive: string;
  /** Row menu, header dropdown: brings it back. */
  unarchive: string;
  /** Swipe-to-reveal action on a touch row, which has room for one word. */
  swipeArchive: string;
  /** Section header menu: the bulk action. */
  archiveAll: string;
  /** The bulk action's confirmation dialog. */
  archiveAllTitle: string;
  archiveAllConfirm: string;
  archiveAllMessage: (vars: { count: number; groupName: string }) => string;
  /** Prefix on the chat header's title for a filed conversation. */
  headerBadge: string;
}

/**
 * Resolve the label set against an explicit flag value.
 *
 * Takes the boolean rather than reading the store so it stays a pure function
 * of its inputs: a surface that only ever exists with the flag on (the Old
 * chats page) passes `true`, and a test passes whichever case it documents.
 */
export function conversationDoneLabels(
  t: TFunction<"chat">,
  done: boolean,
): ConversationDoneLabels {
  if (done) {
    return {
      archive: t("conversationActions.markAsDone"),
      unarchive: t("conversationActions.reopen"),
      swipeArchive: t("conversationActions.done"),
      archiveAll: t("groupActions.markAllAsDone"),
      archiveAllTitle: t("markAllDoneConfirmDialog.title"),
      archiveAllConfirm: t("markAllDoneConfirmDialog.confirm"),
      archiveAllMessage: (vars) => t("markAllDoneConfirmDialog.message", vars),
      headerBadge: t("chatConversationHeader.done"),
    };
  }
  return {
    archive: t("conversationActions.archive"),
    unarchive: t("conversationActions.unarchive"),
    swipeArchive: t("conversationActions.archive"),
    archiveAll: t("groupActions.archiveAll"),
    archiveAllTitle: t("archiveAllConfirmDialog.title"),
    archiveAllConfirm: t("archiveAllConfirmDialog.confirm"),
    archiveAllMessage: (vars) => t("archiveAllConfirmDialog.message", vars),
    headerBadge: t("chatConversationHeader.archived"),
  };
}

/** Whether the sidebar's Done treatment is on for this user. */
export function useSidebarDoneEnabled(): boolean {
  return useClientFeatureFlagStore.use.sidebarDone();
}

/** The label set for the flag as it stands for this user. */
export function useConversationDoneLabels(): ConversationDoneLabels {
  const { t } = useTranslation("chat");
  const done = useSidebarDoneEnabled();
  return conversationDoneLabels(t, done);
}

/**
 * How a schedule's run list describes a filed conversation. Its own hook
 * because the string lives in the `schedules` namespace, and its own copy of
 * the flag read so the schedules panel needs no knowledge of either.
 */
export function useScheduleConversationDoneLabel(): string {
  const { t } = useTranslation("schedules");
  return useSidebarDoneEnabled()
    ? t("scheduleDetail.conversationDone")
    : t("scheduleDetail.conversationArchived");
}
