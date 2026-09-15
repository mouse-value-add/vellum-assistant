import type { ToolContext } from "../tools/types.js";

export function isNativeBrowserClient(context: ToolContext): boolean {
  const surface = context.clientOs ?? context.transportInterface;
  return surface === "macos" || surface === "windows" || surface === "linux";
}
