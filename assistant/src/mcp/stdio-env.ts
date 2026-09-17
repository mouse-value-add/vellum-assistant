/**
 * Environment passed to workspace stdio MCP servers.
 *
 * The spawn is given a small allowlist of non-secret locale and path
 * variables plus any `env` the server's `mcp.json` entry names. It does
 * not inherit the daemon's full `process.env`, so a planted stdio server
 * cannot read CES tokens, provider keys, or other host secrets unless
 * those names are written into `mcp.json` (a High control-plane write).
 */

const MCP_STDIO_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "TZ",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "SystemRoot",
  "COMSPEC",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemDrive",
] as const;

export function buildMcpStdioEnv(
  overlay?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_STDIO_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined && value !== "") {
      env[key] = value;
    }
  }
  if (overlay) {
    for (const [key, value] of Object.entries(overlay)) {
      env[key] = value;
    }
  }
  return env;
}
