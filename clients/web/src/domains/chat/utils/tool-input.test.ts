import { describe, expect, test } from "bun:test";

import {
  COMMAND_KEYS,
  FILE_PATH_KEYS,
  readToolInputString,
  toolCallActivity,
} from "@/domains/chat/utils/tool-input";

describe("readToolInputString", () => {
  test("returns the first key that is set", () => {
    expect(readToolInputString({ path: "a.ts" }, ...FILE_PATH_KEYS)).toBe(
      "a.ts",
    );
    expect(readToolInputString({ file_path: "b.ts" }, ...FILE_PATH_KEYS)).toBe(
      "b.ts",
    );
    expect(readToolInputString({ filePath: "c.ts" }, ...FILE_PATH_KEYS)).toBe(
      "c.ts",
    );
  });

  test("skips a blank earlier key rather than letting it win", () => {
    // Why this is not a `??` chain: an empty string is present, so `??` would
    // return it and hide the spelling that actually carries the value.
    expect(
      readToolInputString({ command: "", cmd: "ls" }, ...COMMAND_KEYS),
    ).toBe("ls");
  });

  test("skips a non-string earlier key rather than stopping at it", () => {
    expect(
      readToolInputString({ command: 42, cmd: "ls" }, ...COMMAND_KEYS),
    ).toBe("ls");
  });

  test("trims, and treats whitespace-only as absent", () => {
    expect(readToolInputString({ path: "  a.ts  " }, "path")).toBe("a.ts");
    expect(readToolInputString({ path: "   " }, "path")).toBe("");
  });

  test("returns an empty string when no key is set", () => {
    expect(readToolInputString({}, ...FILE_PATH_KEYS)).toBe("");
    expect(readToolInputString({ other: "x" }, ...COMMAND_KEYS)).toBe("");
  });
});

describe("toolCallActivity", () => {
  test("reads the status sentence the daemon marks as its own", () => {
    expect(
      toolCallActivity({
        input: { activity: "Reading the config" },
        activityIsStatus: true,
      }),
    ).toBe("Reading the config");
  });

  test("reads it from a daemon too old to say, as every such activity was", () => {
    expect(
      toolCallActivity({ input: { activity: "Reading the config" } }),
    ).toBe("Reading the config");
  });

  test("ignores an activity parameter the tool owns", () => {
    expect(
      toolCallActivity({
        input: { date: "2026-09-16", activity: "planning" },
        activityIsStatus: false,
      }),
    ).toBe("");
  });

  test("no longer reads the retired reason key", () => {
    expect(toolCallActivity({ input: { reason: "why" } })).toBe("");
  });
});
