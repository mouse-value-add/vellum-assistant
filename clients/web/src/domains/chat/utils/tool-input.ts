/**
 * Reading identifier-ish strings out of a tool call's input bag.
 *
 * A tool's input is whatever the model sent, and the same field reaches us
 * under more than one spelling: a path arrives as `file_path`, `path` or
 * `filePath`, a shell command as `command` or the legacy `cmd`. Every surface
 * that shows one has to accept the whole set or it renders blank for calls the
 * chip beside it renders fine.
 */

/**
 * First non-blank string among `keys`, trimmed, or `""` when none is set.
 *
 * Trimming suits identifiers (a path, a command, a query), which is all this is
 * for. Content whose whitespace is load-bearing (an edit's `old_string`) must
 * be read raw instead, since a whitespace-only value is real content and would
 * come back from here as absent.
 */
export function readToolInputString(
  input: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

/**
 * Spellings a file path arrives under, the key the tool actually reads first.
 *
 * `path` is that key either way: the daemon's alias table rewrites `file_path`
 * to it for aliased filesystem tools (`assistant/src/tools/tool-name-aliases.ts`),
 * and a canonically-named tool reads `parsed.data.path` directly
 * (`assistant/src/tools/filesystem/write.ts`). The other two spellings only
 * ever arrive as fields nothing read: the input schemas are `z.looseObject`,
 * so a call can carry more than one of these and still be valid, and naming a
 * file the tool did not touch is worse than naming none.
 */
export const FILE_PATH_KEYS = ["path", "file_path", "filePath"] as const;

/** Spellings a shell command arrives under; `cmd` is the legacy one. */
export const COMMAND_KEYS = ["command", "cmd"] as const;

/**
 * The status sentence the daemon asked the model to put in a tool call's
 * `input.activity`, or "" when the call has none.
 *
 * A tool can own an `activity` parameter of its own (an MCP server's, say); the
 * daemon then reports `activityIsStatus: false` and the value is input, not a
 * description of the call. Older daemons do not report it, and every
 * `activity` they sent was the status sentence.
 */
export function toolCallActivity(call: {
  input?: Record<string, unknown>;
  activityIsStatus?: boolean;
}): string {
  if (call.activityIsStatus === false) {
    return "";
  }
  return readToolInputString(call.input ?? {}, "activity");
}
