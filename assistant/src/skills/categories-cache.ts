import { type BigIntStats, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { getPlatformBaseUrl } from "../config/env.js";
import { getLogger } from "../util/logger.js";
import { getRepoSkillsDir } from "./catalog-install.js";

const log = getLogger("categories-cache");
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface SkillCategoryDef {
  slug: string;
  label: string;
  description: string;
  icon: string;
}

let cachedCategories: SkillCategoryDef[] | null = null;
let cacheTimestamp = 0;

async function fetchCategories(): Promise<SkillCategoryDef[]> {
  const platformUrl = getPlatformBaseUrl();
  const url = `${platformUrl}/v1/skills/categories/`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `Platform API error ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    categories: SkillCategoryDef[];
  };
  if (!Array.isArray(data.categories)) {
    throw new Error(
      "Platform categories response has invalid categories array",
    );
  }
  return data.categories.filter(
    (c): c is SkillCategoryDef =>
      !!c && typeof c.slug === "string" && typeof c.label === "string",
  );
}

/** Catalog filename, fixed under whichever `skills/` dir resolves. */
const CATEGORY_CATALOG_FILENAME = "skill-categories-catalog.yaml";

/**
 * Identity of the file a parsed entry came from: inode, nanosecond ctime and
 * mtime, and size. `ino` catches an atomic replace, `ctimeNs` catches an
 * archive extraction that restores an old `mtime` onto same-sized bytes, and
 * nanoseconds distinguish two writes inside the same millisecond.
 */
function fileIdentity(stat: BigIntStats): string {
  return `${stat.ino}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`;
}

/**
 * Parsed catalog per path, keyed by {@link fileIdentity}.
 *
 * The plugins list and search paths resolve the taxonomy on every request, so
 * the read and the YAML parse are memoized: an unchanged file is parsed once
 * per process.
 */
const parsedCatalogs = new Map<
  string,
  { identity: string; categories: SkillCategoryDef[] }
>();

function readLocalCategories(repoSkillsDir: string): SkillCategoryDef[] {
  const path = join(repoSkillsDir, CATEGORY_CATALOG_FILENAME);
  try {
    const stat = statSync(path, { bigint: true });
    const cached = parsedCatalogs.get(path);
    if (cached && cached.identity === fileIdentity(stat)) {
      return cached.categories;
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = parseYaml(raw) as { categories?: SkillCategoryDef[] };
    const categories = Array.isArray(parsed?.categories)
      ? parsed.categories.filter(
          (c): c is SkillCategoryDef =>
            !!c && typeof c.slug === "string" && typeof c.label === "string",
        )
      : [];
    parsedCatalogs.set(path, { identity: fileIdentity(stat), categories });
    return categories;
  } catch {
    return [];
  }
}

export async function getCategories(): Promise<SkillCategoryDef[]> {
  if (cachedCategories && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCategories;
  }

  const repoSkillsDir = getRepoSkillsDir();
  const local = repoSkillsDir ? readLocalCategories(repoSkillsDir) : [];
  let categories: SkillCategoryDef[];

  try {
    const remote = await fetchCategories();
    if (local.length > 0) {
      const localSlugs = new Set(local.map((c) => c.slug));
      categories = [...local, ...remote.filter((c) => !localSlugs.has(c.slug))];
    } else {
      categories = remote;
    }
  } catch (err) {
    if (cachedCategories) {
      log.warn(
        { err },
        "Failed to fetch skill categories, keeping stale cache",
      );
      cacheTimestamp = Date.now();
      return cachedCategories;
    }
    if (local.length > 0) {
      log.warn(
        { err },
        "Failed to fetch skill categories, falling back to bundled local catalog",
      );
      categories = local;
    } else {
      log.warn({ err }, "Failed to fetch skill categories, returning empty");
      return [];
    }
  }

  cachedCategories = categories;
  cacheTimestamp = Date.now();
  return categories;
}

export function getCachedCategoriesSync(): SkillCategoryDef[] {
  return cachedCategories ?? [];
}

/**
 * Valid Skills category slugs, read synchronously from the bundled
 * `skill-categories-catalog.yaml`. Local + sync so callers that must stay off
 * the remote path (e.g. the plugins list) get the shared taxonomy without
 * remote-fetch latency. Resolves the catalog across environments and degrades
 * to an empty set when it is unreachable — callers treat an empty set as
 * "everything is unknown" rather than failing. The file read and YAML parse
 * are memoized on the file's identity, so a per-request caller costs one
 * `stat`.
 */
export function getLocalCategorySlugs(): Set<string> {
  // Primary: getRepoSkillsDir() resolves the catalog for compiled binaries and
  // VELLUM_DEV dev runs.
  const repoSkillsDir = getRepoSkillsDir();
  if (repoSkillsDir) {
    const slugs = readLocalCategories(repoSkillsDir).map((c) => c.slug);
    if (slugs.length > 0) {
      return new Set(slugs);
    }
  }
  // Fallback for source runs where getRepoSkillsDir() returns undefined (e.g.
  // the Docker image runs `bun run src/index.ts` without VELLUM_DEV and is not
  // on the /$bunfs/ path): the catalog is copied to the repo-root `skills/`
  // dir, resolvable relative to this module (assistant/src/skills -> skills).
  const moduleRelativeSkillsDir = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "skills",
  );
  const relativeSlugs = readLocalCategories(moduleRelativeSkillsDir).map(
    (c) => c.slug,
  );
  if (relativeSlugs.length > 0) {
    return new Set(relativeSlugs);
  }
  // Last resort: slugs from categories already fetched via the async/remote
  // path, so normalization still works once that cache is warm.
  return new Set(getCachedCategoriesSync().map((c) => c.slug));
}

export function invalidateCategoriesCache(): void {
  cachedCategories = null;
  cacheTimestamp = 0;
  parsedCatalogs.clear();
}
