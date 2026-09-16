import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import {
  configureDesktopChromeFrame,
  removeStaleDesktopChromeLocks,
} from "./desktop-chrome-session.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each(["{truncated", "[]", '{"browser":[]}'])(
  "leaves unreadable or malformed preferences untouched: %s",
  (contents) => {
    const directory = mkdtempSync(join(tmpdir(), "desktop-frame-"));
    directories.push(directory);
    mkdirSync(join(directory, "Default"));
    const path = join(directory, "Default", "Preferences");
    writeFileSync(path, contents);

    expect(() => configureDesktopChromeFrame(directory)).toThrow();
    expect(readFileSync(path, "utf8")).toBe(contents);
  },
);

test("does not rewrite an already configured profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "desktop-frame-"));
  directories.push(directory);
  mkdirSync(join(directory, "Default"));
  const path = join(directory, "Default", "Preferences");
  const contents =
    '{ "browser": { "custom_chrome_frame": true }, "profile": { "exit_type": "Crashed" } }';
  writeFileSync(path, contents);

  configureDesktopChromeFrame(directory);

  expect(readFileSync(path, "utf8")).toBe(contents);
});

test.each(["missing", "reused", "browser", "socket"])(
  "profile recovery handles a %s owner without losing browser data",
  (owner) => {
    const directory = mkdtempSync(join(tmpdir(), "desktop-lock-"));
    directories.push(directory);
    const profile = join(directory, "profile");
    const proc = join(directory, "proc");
    const socket = join(directory, "old-socket");
    mkdirSync(profile);
    mkdirSync(join(profile, "Default"));
    writeFileSync(join(profile, "Default", "Cookies"), "example-session");
    symlinkSync("previous-container-1234", join(profile, "SingletonLock"));
    symlinkSync("example-cookie", join(profile, "SingletonCookie"));
    symlinkSync(socket, join(profile, "SingletonSocket"));
    if (owner === "browser" || owner === "reused") {
      mkdirSync(join(proc, "1234"), { recursive: true });
      writeFileSync(
        join(proc, "1234", "cmdline"),
        owner === "browser"
          ? `/opt/chrome\0--user-data-dir=${profile}\0`
          : "/usr/bin/unrelated\0",
      );
    }
    if (owner === "socket") {
      writeFileSync(socket, "occupied");
    }
    removeStaleDesktopChromeLocks(profile, proc);
    for (const name of [
      "SingletonLock",
      "SingletonCookie",
      "SingletonSocket",
    ]) {
      expect(
        lstatSync(join(profile, name), { throwIfNoEntry: false }) !== undefined,
      ).toBe(owner === "browser" || owner === "socket");
    }
    expect(readFileSync(join(profile, "Default", "Cookies"), "utf8")).toBe(
      "example-session",
    );
    removeStaleDesktopChromeLocks(profile, proc);
  },
);
