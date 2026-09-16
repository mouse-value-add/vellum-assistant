import { getConfig } from "../config/loader.js";
import { isVirtualDesktopEnabled } from "../desktop/virtual-desktop-feature.js";
import { browserManager } from "../tools/browser/browser-manager.js";
import { normalizeBrowserMode } from "../tools/browser/browser-mode.js";
import { getPinnedTab } from "../tools/browser/pinned-tabs.js";
import type { ToolContext } from "../tools/types.js";

export function isVirtualDesktopBrowserContext(context: ToolContext): boolean {
  return (
    context.transportInterface === "web" &&
    context.clientOs !== "macos" &&
    context.clientOs !== "windows" &&
    context.clientOs !== "linux" &&
    context.trustClass === "guardian" &&
    !!context.sourceActorPrincipalId &&
    isVirtualDesktopEnabled(getConfig())
  );
}

export function shouldUseVirtualDesktopBrowser(
  desktop: boolean | undefined,
  input: Record<string, unknown>,
  context: ToolContext,
): boolean {
  if (desktop !== undefined) {
    return desktop;
  }
  const mode = normalizeBrowserMode(input.browser_mode);
  if (
    "error" in mode ||
    mode.mode !== "auto" ||
    input.target_client_id ||
    input.use_active_tab ||
    browserManager.getPreferredBackendKind(context.conversationId) !== null ||
    getPinnedTab(context.conversationId)
  ) {
    return false;
  }
  return isVirtualDesktopBrowserContext(context);
}
