/**
 * In-memory cache for the installable plugin catalog.
 *
 * Two read paths with different guarantees:
 *
 * - **Display** ({@link getPluginCatalog}) is stale-while-revalidate and never
 *   blocks on the network. It answers from the in-memory copy (even past its
 *   TTL), or from the bundled offline manifest when nothing is cached yet, and
 *   kicks a single background platform refresh whenever the entry is missing or
 *   expired. A refresh failure keeps the last good copy and backs off. The copy
 *   a caller sees may therefore be up to one refresh behind the platform.
 * - **Install** ({@link getAuthoritativePluginCatalog}) is platform-authoritative:
 *   it serves the cache only within the TTL and otherwise awaits a fresh
 *   platform fetch, propagating any failure. Pinned refs and sources reach the
 *   installer from this path alone, so a stale display copy can never pin an
 *   install to an outdated revision.
 *
 * Both paths share one cache and one in-flight refresh, so a display read warms
 * the catalog the installer later reads. When `VELLUM_DISABLE_PLATFORM` disables
 * platform features the bundled offline manifest is the whole catalog, with zero
 * network calls.
 */

import { arePlatformFeaturesEnabled } from "../../platform/feature-gate.js";
import { getLogger } from "../../util/logger.js";
import {
  readBundledLocalPluginCatalog,
  readBundledPluginCatalog,
} from "./plugin-catalog-local.js";
import { fetchPluginCatalogFromPlatform } from "./plugin-catalog-platform.js";
import type { PluginCatalog, SearchPluginsDeps } from "./search-plugins.js";

const log = getLogger("plugin-catalog-cache");

/** How long a fetched catalog is served before a refresh is attempted. */
export const PLUGIN_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** First wait after a failed refresh; each further failure doubles it. */
export const PLUGIN_CATALOG_REFRESH_BACKOFF_MS = 30 * 1000; // 30 seconds

/** Ceiling on the doubling, so a long outage retries once per TTL at worst. */
export const PLUGIN_CATALOG_REFRESH_BACKOFF_MAX_MS =
  PLUGIN_CATALOG_CACHE_TTL_MS;

interface CacheEntry {
  catalog: PluginCatalog;
  timestamp: number;
}

interface BackoffEntry {
  /** Epoch ms before which no further background refresh is attempted. */
  until: number;
  /** Consecutive failures, driving the exponential wait. */
  failures: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<PluginCatalog>>();
const backoff = new Map<string, BackoffEntry>();

/** Add bundled local packages without overriding platform-authoritative rows. */
export function mergePlatformCatalogWithBundledLocals(
  platform: PluginCatalog,
  bundledLocal: PluginCatalog = readBundledLocalPluginCatalog(),
): PluginCatalog {
  const seen = new Set(platform.matches.map((match) => match.name));
  return {
    ref: platform.ref,
    matches: [
      ...platform.matches,
      ...bundledLocal.matches.filter((match) => !seen.has(match.name)),
    ].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function bundledCatalogAt(ref: string): PluginCatalog {
  return { ...readBundledPluginCatalog(), ref };
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < PLUGIN_CATALOG_CACHE_TTL_MS;
}

function recordRefreshFailure(ref: string, err: unknown): void {
  const failures = (backoff.get(ref)?.failures ?? 0) + 1;
  const wait = Math.min(
    PLUGIN_CATALOG_REFRESH_BACKOFF_MS * 2 ** (failures - 1),
    PLUGIN_CATALOG_REFRESH_BACKOFF_MAX_MS,
  );
  backoff.set(ref, { until: Date.now() + wait, failures });
  log.warn(
    { err, ref, failures, retryInMs: wait, servingStale: cache.has(ref) },
    "Plugin catalog refresh failed; serving the last known catalog",
  );
}

/**
 * Fetch the platform catalog into the cache, deduped per ref: concurrent
 * callers share one in-flight request. Resolves with the merged catalog and
 * rejects with the fetch failure, so the authoritative path can propagate it
 * while the display path swallows it.
 */
function refreshPluginCatalog(
  ref: string,
  deps: SearchPluginsDeps,
): Promise<PluginCatalog> {
  const existing = inFlight.get(ref);
  if (existing) {
    return existing;
  }
  const promise = fetchPluginCatalogFromPlatform(deps, { ref }).then(
    (catalog) => {
      const merged = mergePlatformCatalogWithBundledLocals(catalog);
      inFlight.delete(ref);
      cache.set(ref, { catalog: merged, timestamp: Date.now() });
      backoff.delete(ref);
      return merged;
    },
    (err: unknown) => {
      inFlight.delete(ref);
      recordRefreshFailure(ref, err);
      throw err;
    },
  );
  inFlight.set(ref, promise);
  return promise;
}

/**
 * Resolve the catalog at {@link ref} for display, without ever waiting on the
 * platform.
 *
 * Answers from the in-memory copy when there is one (even an expired one),
 * otherwise from the bundled manifest, and triggers at most one background
 * refresh per ref when the copy is missing or past the TTL. Failures are logged
 * and backed off rather than surfaced, so a platform outage degrades to the
 * last known catalog instead of an empty grid.
 */
export async function getPluginCatalog(
  ref: string,
  deps: SearchPluginsDeps,
): Promise<PluginCatalog> {
  if (!arePlatformFeaturesEnabled()) {
    return bundledCatalogAt(ref);
  }

  const cached = cache.get(ref);
  if (cached && isFresh(cached)) {
    return cached.catalog;
  }

  const backingOff = backoff.get(ref);
  if (!backingOff || Date.now() >= backingOff.until) {
    // Fire and forget: the refresh populates the cache for the next read. The
    // rejection is already logged in `recordRefreshFailure`.
    void refreshPluginCatalog(ref, deps).catch(() => {});
  }

  return cached?.catalog ?? bundledCatalogAt(ref);
}

/**
 * Resolve the catalog at {@link ref} from the platform, for callers that pin an
 * install to a source and ref.
 *
 * Serves the cached copy only while it is within the TTL; otherwise it awaits a
 * fresh fetch and propagates any failure so the caller can surface it (e.g. map
 * a rate limit to 503). A stale copy is never returned: an install must resolve
 * the revision the platform currently publishes.
 */
export async function getAuthoritativePluginCatalog(
  ref: string,
  deps: SearchPluginsDeps,
): Promise<PluginCatalog> {
  if (!arePlatformFeaturesEnabled()) {
    return bundledCatalogAt(ref);
  }

  const cached = cache.get(ref);
  if (cached && isFresh(cached)) {
    return cached.catalog;
  }

  return refreshPluginCatalog(ref, deps);
}

/** Invalidate the cache (for testing or forced refresh). */
export function invalidatePluginCatalogCache(): void {
  cache.clear();
  inFlight.clear();
  backoff.clear();
}
