/**
 * Tests for {@link getPluginCatalog} and {@link getAuthoritativePluginCatalog}.
 *
 * Exercises the gate between the platform fetcher and the bundled reader, the
 * per-ref TTL cache, and the split between the stale-while-revalidate display
 * read and the authoritative install read. Platform paths drive a fake
 * `deps.fetch` returning a `/v1/plugins/` payload (no real network); the offline
 * path reads the bundled manifest and must touch the network zero times.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";

import type { FetchLike } from "../fetch-like.js";
import {
  getAuthoritativePluginCatalog,
  getPluginCatalog,
  invalidatePluginCatalogCache,
  mergePlatformCatalogWithBundledLocals,
  PLUGIN_CATALOG_CACHE_TTL_MS,
  PLUGIN_CATALOG_REFRESH_BACKOFF_MS,
  revalidatePluginCatalogInBackground,
} from "../plugin-catalog-cache.js";
import { readBundledPluginCatalog } from "../plugin-catalog-local.js";
import type { SearchPluginsDeps } from "../search-plugins.js";
import type { PluginCatalog } from "../search-plugins.js";

// A non-zero base time. Bun treats `setSystemTime(new Date(0))` as "reset to
// the real clock", so the fake clock must start from a positive epoch.
const BASE_TIME_MS = 1_700_000_000_000;

function githubNames(catalog: PluginCatalog): string[] {
  return catalog.matches
    .filter((match) => match.source.kind === "github")
    .map((match) => match.name);
}

/** A `deps.fetch` that serves a `/v1/plugins/` payload and counts its calls. */
function platformFetch(
  names: string[],
  opts: { delayMs?: number } = {},
): {
  fetch: FetchLike;
  calls: () => number;
  release: () => void;
} {
  let calls = 0;
  let release = (): void => {};
  const body = JSON.stringify({
    plugins: names.map((name) => ({
      name,
      repo: `acme/${name}`,
      ref: "0".repeat(40),
    })),
  });
  const gate =
    opts.delayMs === undefined
      ? null
      : new Promise<void>((resolve) => {
          release = resolve;
        });
  const fetch: FetchLike = (async () => {
    calls += 1;
    if (gate) {
      await gate;
    }
    return new Response(body, { status: 200 });
  }) as never;
  return { fetch, calls: () => calls, release: () => release() };
}

/** A `deps.fetch` that always fails with a non-2xx (→ unavailable). */
function failingFetch(): { fetch: FetchLike; calls: () => number } {
  let calls = 0;
  const fetch: FetchLike = (async () => {
    calls += 1;
    return new Response("", { status: 503 });
  }) as never;
  return { fetch, calls: () => calls };
}

/**
 * Yield to the event loop so an in-flight background refresh settles. The fakes
 * resolve without real I/O, so one turn is enough. `setSystemTime` moves the
 * clock `Date.now()` reads, not the timer loop, so this waits real time.
 */
async function settleRefresh(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const ORIGINAL_ENV = {
  IS_PLATFORM: process.env.IS_PLATFORM,
  VELLUM_DISABLE_PLATFORM: process.env.VELLUM_DISABLE_PLATFORM,
};

/**
 * What a display route does per request: read from memory, then schedule the
 * revalidation. Mirrors `readDisplayCatalog` in `plugins-routes.ts`.
 */
async function readForDisplay(
  ref: string,
  deps: SearchPluginsDeps,
  onChanged?: () => void,
): Promise<PluginCatalog> {
  const catalog = await getPluginCatalog(ref, deps);
  revalidatePluginCatalogInBackground(ref, deps, onChanged);
  return catalog;
}

describe("getPluginCatalog + revalidatePluginCatalogInBackground", () => {
  beforeEach(() => {
    invalidatePluginCatalogCache();
    // Default: platform features enabled (neither flag set).
    delete process.env.IS_PLATFORM;
    delete process.env.VELLUM_DISABLE_PLATFORM;
  });

  afterEach(() => {
    setSystemTime();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("serves the bundled catalog immediately on a cold cache and refreshes behind it", async () => {
    // GIVEN platform features enabled and a platform fetch that has not settled
    // while the caller is waiting.
    const { fetch, calls, release } = platformFetch(["remote-only"], {
      delayMs: 1,
    });
    const deps: SearchPluginsDeps = { fetch };

    // WHEN the first read lands on a cold cache
    const first = await readForDisplay("main", deps);

    // THEN it answers from the bundled manifest without waiting on the platform
    expect(first.matches).toEqual(readBundledPluginCatalog().matches);
    expect(first.ref).toBe("main");
    // ...and one background refresh is under way
    expect(calls()).toBe(1);

    // WHEN the refresh lands, the next read serves the platform copy
    release();
    await settleRefresh();
    const second = await readForDisplay("main", deps);
    expect(githubNames(second)).toEqual(["remote-only"]);
    expect(calls()).toBe(1);
  });

  test("reports a refresh that changes what the ref serves, and stays quiet when it does not", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const changes: number[] = [];
    const onChanged = (): void => {
      changes.push(Date.now());
    };

    // GIVEN a cold cache: the platform copy differs from the bundled manifest
    const first = platformFetch(["remote-only"]);
    await readForDisplay("main", { fetch: first.fetch }, onChanged);
    await settleRefresh();

    // THEN clients are told the catalog moved
    expect(changes).toHaveLength(1);

    // WHEN the TTL elapses and the platform returns the same rows
    setSystemTime(new Date(BASE_TIME_MS + PLUGIN_CATALOG_CACHE_TTL_MS + 1));
    const same = platformFetch(["remote-only"]);
    await readForDisplay("main", { fetch: same.fetch }, onChanged);
    await settleRefresh();

    // THEN no invalidation is published for an unchanged catalog
    expect(same.calls()).toBe(1);
    expect(changes).toHaveLength(1);
  });

  test("serves the cached copy within the TTL without refreshing", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const { fetch, calls } = platformFetch(["a"]);
    const deps: SearchPluginsDeps = { fetch };

    // GIVEN a warm cache (first read kicks the refresh, which settles)
    await readForDisplay("main", deps);
    await settleRefresh();

    // WHEN we read again inside the TTL
    const warm = await readForDisplay("main", deps);

    // THEN it is the cached copy and no second fetch is issued
    expect(githubNames(warm)).toEqual(["a"]);
    expect(calls()).toBe(1);
  });

  test("serves the stale copy past the TTL and triggers exactly one refresh for concurrent callers", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const first = platformFetch(["stale"]);
    await readForDisplay("main", { fetch: first.fetch });
    await settleRefresh();

    // GIVEN the cached copy is past its TTL
    setSystemTime(new Date(BASE_TIME_MS + PLUGIN_CATALOG_CACHE_TTL_MS + 1));
    const next = platformFetch(["fresh"], { delayMs: 1 });

    // WHEN five callers read at once
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        readForDisplay("main", { fetch: next.fetch }),
      ),
    );

    // THEN every one of them is answered with the stale copy...
    for (const result of results) {
      expect(githubNames(result)).toEqual(["stale"]);
    }
    // ...and they share a single in-flight refresh
    expect(next.calls()).toBe(1);

    next.release();
    await settleRefresh();
    expect(
      githubNames(await readForDisplay("main", { fetch: next.fetch })),
    ).toEqual(["fresh"]);
  });

  test("keeps the last good copy when the refresh fails, and backs off", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const good = platformFetch(["good"]);
    await readForDisplay("main", { fetch: good.fetch });
    await settleRefresh();

    // GIVEN the TTL has elapsed and the platform is down
    setSystemTime(new Date(BASE_TIME_MS + PLUGIN_CATALOG_CACHE_TTL_MS + 1));
    const failing = failingFetch();

    // WHEN we read while the refresh fails
    const stale = await readForDisplay("main", { fetch: failing.fetch });
    await settleRefresh();

    // THEN the last good copy is served rather than an error or an empty grid
    expect(githubNames(stale)).toEqual(["good"]);
    expect(failing.calls()).toBe(1);

    // AND further reads inside the backoff window do not re-hammer the platform
    await readForDisplay("main", { fetch: failing.fetch });
    await settleRefresh();
    expect(failing.calls()).toBe(1);

    // ...until the backoff expires
    setSystemTime(
      new Date(
        BASE_TIME_MS +
          PLUGIN_CATALOG_CACHE_TTL_MS +
          PLUGIN_CATALOG_REFRESH_BACKOFF_MS +
          2,
      ),
    );
    await readForDisplay("main", { fetch: failing.fetch });
    await settleRefresh();
    expect(failing.calls()).toBe(2);
  });

  test("a refresh that outlives an invalidation does not repopulate the cleared cache", async () => {
    // GIVEN a slow refresh in flight
    const slow = platformFetch(["stale-in-flight"], { delayMs: 1 });
    await readForDisplay("main", { fetch: slow.fetch });
    expect(slow.calls()).toBe(1);

    // WHEN the cache is invalidated before it lands, and it lands afterwards
    invalidatePluginCatalogCache();
    slow.release();
    await settleRefresh();

    // THEN its result was discarded: the next read is cold again (bundled) and
    // starts a fresh fetch rather than serving the fenced copy.
    const next = platformFetch(["after-invalidate"]);
    const after = await readForDisplay("main", { fetch: next.fetch });
    expect(after.matches).toEqual(readBundledPluginCatalog().matches);
    expect(next.calls()).toBe(1);
  });

  test("reads the bundled catalog with zero network when platform is disabled", async () => {
    // GIVEN platform features disabled (offline / self-hosted)
    process.env.VELLUM_DISABLE_PLATFORM = "true";
    delete process.env.IS_PLATFORM;

    const { fetch, calls } = platformFetch(["ignored"]);
    const deps: SearchPluginsDeps = { fetch };

    // WHEN we request the catalog
    const result = await readForDisplay("main", deps);

    // THEN it comes from the bundled manifest and no fetch is made
    expect(calls()).toBe(0);
    const bundled = readBundledPluginCatalog();
    expect(result.matches).toEqual(bundled.matches);
    // The requested ref is echoed onto the wire contract.
    expect(result.ref).toBe("main");
  });
});

describe("getAuthoritativePluginCatalog", () => {
  beforeEach(() => {
    invalidatePluginCatalogCache();
    delete process.env.IS_PLATFORM;
    delete process.env.VELLUM_DISABLE_PLATFORM;
  });

  afterEach(() => {
    setSystemTime();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("awaits the platform on a cold cache instead of serving the bundled copy", async () => {
    const { fetch, calls } = platformFetch(["remote-only"]);

    const catalog = await getAuthoritativePluginCatalog("main", { fetch });

    expect(calls()).toBe(1);
    expect(githubNames(catalog)).toEqual(["remote-only"]);
  });

  test("fetches once, then serves cache within the TTL", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const { fetch, calls } = platformFetch(["a"]);
    const deps: SearchPluginsDeps = { fetch };

    const first = await getAuthoritativePluginCatalog("main", deps);
    const second = await getAuthoritativePluginCatalog("main", deps);

    expect(calls()).toBe(1);
    expect(first).toBe(second);
    expect(githubNames(first)).toEqual(["a"]);
    expect(first.ref).toBe("main");
  });

  test("refetches after invalidation", async () => {
    const { fetch, calls } = platformFetch(["a"]);
    const deps: SearchPluginsDeps = { fetch };
    await getAuthoritativePluginCatalog("main", deps);

    invalidatePluginCatalogCache();
    await getAuthoritativePluginCatalog("main", deps);

    expect(calls()).toBe(2);
  });

  test("refetches after the TTL elapses", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const { fetch, calls } = platformFetch(["a"]);
    const deps: SearchPluginsDeps = { fetch };
    await getAuthoritativePluginCatalog("main", deps);

    setSystemTime(new Date(BASE_TIME_MS + PLUGIN_CATALOG_CACHE_TTL_MS + 1));
    await getAuthoritativePluginCatalog("main", deps);

    expect(calls()).toBe(2);
  });

  test("fails hard on refresh failure — does NOT serve the stale cache", async () => {
    // GIVEN a good catalog cached at t0
    setSystemTime(new Date(BASE_TIME_MS));
    const good = platformFetch(["good"]);
    const cached = await getAuthoritativePluginCatalog("main", {
      fetch: good.fetch,
    });
    expect(githubNames(cached)).toEqual(["good"]);

    // WHEN the TTL has elapsed and the refresh fails
    setSystemTime(new Date(BASE_TIME_MS + PLUGIN_CATALOG_CACHE_TTL_MS + 1));
    const failing = failingFetch();
    const err = await getAuthoritativePluginCatalog("main", {
      fetch: failing.fetch,
    }).catch((e: unknown) => e);

    // THEN the failure propagates instead of serving the stale catalog: an
    // install must pin against a revision the platform currently publishes.
    expect(err).toBeInstanceOf(Error);
    expect(failing.calls()).toBe(1);
  });

  test("ignores the display path's backoff so an install still reaches the platform", async () => {
    setSystemTime(new Date(BASE_TIME_MS));
    const failing = failingFetch();
    // A display read fails and arms the backoff.
    await readForDisplay("main", { fetch: failing.fetch });
    await settleRefresh();
    expect(failing.calls()).toBe(1);

    // The install read fetches anyway rather than inheriting the wait.
    const good = platformFetch(["good"]);
    const catalog = await getAuthoritativePluginCatalog("main", {
      fetch: good.fetch,
    });
    expect(good.calls()).toBe(1);
    expect(githubNames(catalog)).toEqual(["good"]);
  });

  test("reads the bundled catalog when platform features are disabled", async () => {
    process.env.VELLUM_DISABLE_PLATFORM = "true";
    const { fetch, calls } = platformFetch(["ignored"]);

    const result = await getAuthoritativePluginCatalog("main", { fetch });

    expect(calls()).toBe(0);
    expect(result.matches).toEqual(readBundledPluginCatalog().matches);
  });
});

describe("mergePlatformCatalogWithBundledLocals", () => {
  test("adds local packages while keeping a platform row on name collision", () => {
    const platform: PluginCatalog = {
      ref: "main",
      matches: [
        {
          name: "fathom",
          path: "github:provider/fathom@pin",
          category: null,
          source: {
            kind: "github",
            repo: "provider/fathom",
            ref: "0".repeat(40),
          },
        },
      ],
    };
    const bundled: PluginCatalog = {
      ref: "bundled",
      matches: [
        {
          name: "fathom",
          path: "local:plugins/mcp-catalog/fathom@1.0.0",
          category: null,
          source: {
            kind: "local",
            path: "plugins/mcp-catalog/fathom",
            version: "1.0.0",
          },
        },
        {
          name: "notion",
          path: "local:plugins/mcp-catalog/notion@1.0.0",
          category: null,
          source: {
            kind: "local",
            path: "plugins/mcp-catalog/notion",
            version: "1.0.0",
          },
        },
      ],
    };

    const merged = mergePlatformCatalogWithBundledLocals(platform, bundled);

    expect(merged.matches.map((match) => match.name)).toEqual([
      "fathom",
      "notion",
    ]);
    expect(merged.matches[0]?.source.kind).toBe("github");
    expect(merged.matches[1]?.source.kind).toBe("local");
    expect(merged.ref).toBe("main");
  });
});
