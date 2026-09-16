/**
 * Setup shared by the real-browser scripts (`test-*-browser.ts`): the phone
 * context they emulate and the bundling of a `.tsx` fixture into a script the
 * page can load.
 */

import assert from "node:assert/strict";

import type { BrowserContextOptions } from "playwright";

/** An iPhone-sized touch device: narrow viewport and a coarse pointer. */
export const PHONE_CONTEXT = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
} satisfies BrowserContextOptions;

/** Bundles a fixture entry point into an IIFE for `page.addScriptTag`. */
export async function bundleFixture(entrypoint: string): Promise<string> {
  const build = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
  });
  assert.ok(build.success, build.logs.join("\n"));
  return build.outputs[0].text();
}
