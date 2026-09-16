/**
 * Checks `touch-mobile:` layout in real Chromium and WebKit with the app's
 * compiled stylesheet. Storybook cannot emulate a coarse pointer and happy-dom
 * does no layout, so this is where the variant's geometry is asserted.
 *
 * For each engine and viewport it first proves which branch the page is in,
 * then asserts the detail block's invariant on rendered boxes: the copy button
 * sits inside the block, and no line of text runs under the button.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { TOUCH_SURFACE_MEDIA_QUERY } from "@vellumai/design-library/utils/touch-surface";
import {
  chromium,
  webkit,
  type BrowserContextOptions,
  type Page,
} from "playwright";

import type {} from "./fixtures/touch-layout";

import { bundleFixture, PHONE_CONTEXT } from "./browser-harness";
import { compileAppCss } from "./compile-app-css";

const css = await compileAppCss();
assert.ok(
  css.includes(`@media ${TOUCH_SURFACE_MEDIA_QUERY}`),
  "the compiled app CSS must carry touch-mobile rules",
);
const bundle = await bundleFixture(
  fileURLToPath(new URL("./fixtures/touch-layout.tsx", import.meta.url)),
);

const VIEWPORTS: {
  name: string;
  context: BrowserContextOptions;
  touchMobile: boolean;
}[] = [
  { name: "phone", context: PHONE_CONTEXT, touchMobile: true },
  {
    name: "desktop",
    context: { viewport: { width: 1280, height: 800 } },
    touchMobile: false,
  },
];

const BLOCKS = ["one-line", "unbreakable-token"];

/** Sub-pixel slack for rounding differences between engines. */
const EPSILON = 0.5;

interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

async function measure(page: Page, id: string) {
  return page.locator(`#${id}`).evaluate((host) => {
    const box = (r: DOMRect) => ({
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
    });
    const range = document.createRange();
    range.selectNodeContents(host.querySelector("pre")!);
    return {
      block: box(host.firstElementChild!.getBoundingClientRect()),
      button: box(host.querySelector("button")!.getBoundingClientRect()),
      lines: Array.from(range.getClientRects(), box),
    };
  });
}

function assertInside(label: string, inner: Box, outer: Box) {
  for (const side of ["top", "left"] as const) {
    assert.ok(
      inner[side] >= outer[side] - EPSILON,
      `${label}: copy button ${side} (${inner[side]}) is outside the block ${side} (${outer[side]})`,
    );
  }
  for (const side of ["right", "bottom"] as const) {
    assert.ok(
      inner[side] <= outer[side] + EPSILON,
      `${label}: copy button ${side} (${inner[side]}) overhangs the block ${side} (${outer[side]}) by ${(inner[side] - outer[side]).toFixed(1)}px`,
    );
  }
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const viewport of VIEWPORTS) {
      const where = `${engine.name()} ${viewport.name}`;
      const page = await browser.newPage(viewport.context);
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
      });
      // The app's index.html declares this viewport. Without it a mobile
      // browser lays the page out at 980px, so the width half of
      // `touch-mobile` never matches and the phone branch is never entered.
      await page.setContent(
        `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div>`,
      );
      await page.addScriptTag({ content: bundle });
      await page.waitForFunction(() => window.touchLayoutTest.ready);

      const branch = await page.evaluate(
        (query) => ({ width: innerWidth, matches: matchMedia(query).matches }),
        TOUCH_SURFACE_MEDIA_QUERY,
      );
      assert.equal(
        branch.width,
        viewport.context.viewport!.width,
        `${where}: layout viewport width`,
      );
      assert.equal(
        branch.matches,
        viewport.touchMobile,
        `${where}: ${TOUCH_SURFACE_MEDIA_QUERY} matches`,
      );

      for (const id of BLOCKS) {
        const label = `${where} ${id}`;
        const { block, button, lines } = await measure(page, id);
        assert.ok(lines.length > 0, `${label}: the block renders text`);
        if (id === "unbreakable-token") {
          assert.ok(
            lines.length > 1,
            `${label}: the token wraps, so its first line fills the block`,
          );
        }
        assertInside(label, button, block);
        for (const [index, line] of lines.entries()) {
          assert.ok(
            line.right <= button.left + EPSILON,
            `${label}: text line ${index + 1} right edge (${line.right}) runs under the copy button left edge (${button.left})`,
          );
        }
        console.log(
          `${label}: block ${(block.bottom - block.top).toFixed(0)}px tall, copy button ${(button.right - button.left).toFixed(0)}px, ${lines.length} line(s): ok`,
        );
      }
      assert.deepEqual(errors, [], `${where}: page errors`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
