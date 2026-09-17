import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// Control what getRepoSkillsDir() returns per test. Mocked before the module
// under test is imported so getLocalCategorySlugs() sees the override.
let repoSkillsDirOverride: string | undefined;

mock.module("../catalog-install.js", () => ({
  getRepoSkillsDir: () => repoSkillsDirOverride,
}));

// Count YAML parses so the memoization tests can assert the catalog is parsed
// once per file version rather than once per call. Destructuring snapshots the
// real exports before `mock.module` replaces them in the registry, so the
// wrapper delegates to the real parser instead of to itself.
const { parse: realParseYaml, ...restOfYaml } = await import("yaml");
let yamlParseCount = 0;
mock.module("yaml", () => ({
  ...restOfYaml,
  parse: (...args: Parameters<typeof realParseYaml>): unknown => {
    yamlParseCount += 1;
    return realParseYaml(...args);
  },
}));

const { getLocalCategorySlugs, invalidateCategoriesCache } =
  await import("../categories-cache.js");

// Repo-root `skills/` relative to this test file
// (assistant/src/skills/__tests__ -> repo root -> skills).
const REAL_SKILLS_DIR = join(import.meta.dir, "..", "..", "..", "..", "skills");

describe("getLocalCategorySlugs", () => {
  test("resolves slugs via getRepoSkillsDir when it is available", () => {
    repoSkillsDirOverride = REAL_SKILLS_DIR;
    const slugs = getLocalCategorySlugs();
    expect(slugs.has("development")).toBe(true);
    expect(slugs.has("system")).toBe(true);
  });

  test("falls back to the module-relative catalog when getRepoSkillsDir is undefined (Docker source-run)", () => {
    // Regression: in Docker mode the launcher runs `bun run src/index.ts`
    // without VELLUM_DEV, so getRepoSkillsDir() returns undefined. The reader
    // previously returned an empty set, which made normalizeMarketplaceCategory
    // treat every marketplace category as invalid and bucket all plugins under
    // System. The module-relative fallback must still resolve the bundled YAML.
    repoSkillsDirOverride = undefined;
    const slugs = getLocalCategorySlugs();
    expect(slugs.size).toBeGreaterThan(0);
    expect(slugs.has("development")).toBe(true);
    expect(slugs.has("system")).toBe(true);
  });
});

/**
 * The catalog read and YAML parse are memoized on the file's identity (inode,
 * ctime, mtime, size), so a per-request caller costs one `stat`.
 */
describe("getLocalCategorySlugs memoization", () => {
  let skillsDir: string;
  let catalogPath: string;

  function writeCatalog(slug: string): void {
    writeFileSync(
      catalogPath,
      `categories:\n  - slug: ${slug}\n    label: ${slug}\n`,
    );
  }

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "skill-categories-"));
    catalogPath = join(skillsDir, "skill-categories-catalog.yaml");
    repoSkillsDirOverride = skillsDir;
    invalidateCategoriesCache();
    yamlParseCount = 0;
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
    invalidateCategoriesCache();
  });

  test("parses the catalog once across repeated calls", () => {
    writeCatalog("aaa");

    for (let i = 0; i < 5; i += 1) {
      expect(getLocalCategorySlugs().has("aaa")).toBe(true);
    }

    expect(yamlParseCount).toBe(1);
  });

  test("re-parses once the catalog changes on disk", () => {
    writeCatalog("aaa");
    expect(getLocalCategorySlugs().has("aaa")).toBe(true);
    expect(yamlParseCount).toBe(1);

    writeCatalog("bbb");
    const slugs = getLocalCategorySlugs();

    expect(slugs.has("bbb")).toBe(true);
    expect(slugs.has("aaa")).toBe(false);
    expect(yamlParseCount).toBe(2);
  });
});
