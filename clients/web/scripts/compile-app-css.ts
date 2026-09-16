/**
 * Compiles the web app's real stylesheet (`src/index.css`) the way
 * `@tailwindcss/vite` does during a build, so a browser test can style a
 * fixture with the same utilities and custom variants the app ships.
 *
 * Source detection mirrors the Vite plugin: with no `source(...)` on the
 * `tailwindcss` import, the compiler's root is `null` and the plugin scans
 * the Vite root (this package) for candidates, plus every `@source` the
 * stylesheet pulls in. The design library's `tokens.css` declares one for its
 * own sources, so its classes are generated too.
 *
 * The output is the compiler's raw CSS. A production build additionally runs
 * it through Lightning CSS, which this skips.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "@tailwindcss/node";
import { Scanner, type SourceEntry } from "@tailwindcss/oxide";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function compileAppCss(): Promise<string> {
  const entry = join(webDir, "src", "index.css");
  const compiler = await compile(await readFile(entry, "utf8"), {
    base: dirname(entry),
    onDependency: () => {},
  });
  const root: SourceEntry[] =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: webDir, pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const scanner = new Scanner({ sources: [...root, ...compiler.sources] });
  return compiler.build(scanner.scan());
}
