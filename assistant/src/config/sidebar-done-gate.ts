import { isAssistantFeatureFlagEnabled } from "./assistant-feature-flags.js";
import type { AssistantConfig } from "./schema.js";

export const SIDEBAR_DONE_FLAG = "sidebar-done" as const;

/**
 * Whether the chat sidebar's Archive action is presented as a Done check,
 * with the Old chats page behind it.
 *
 * "Done" is `archived_at`, so the daemon-side half of the flag is what stops
 * an archived conversation from being a half-deleted one: with the flag on a
 * wake still runs on it, and a user-visible message brings it back to the
 * list. With the flag off every archived conversation rejects wakes and
 * nothing but the unarchive route clears the column.
 */
export function isSidebarDoneEnabled(config?: AssistantConfig): boolean {
  return isAssistantFeatureFlagEnabled(SIDEBAR_DONE_FLAG, config);
}
