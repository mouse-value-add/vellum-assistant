/**
 * In-memory cache for the installable plugin catalog.
 *
 * Two read paths with different guarantees:
 *
 * - **Display** ({@link getPluginCatalog}) is a pure read that never blocks on
 *   the network: the in-memory copy, even past its TTL, or the bundled offline
 *   manifest when nothing is cached yet. The copy a caller sees may therefore
 *   be up to one refresh behind the platform. Catching it up is the caller's
 *   explicit {@link revalidatePluginCatalogInBackground} call, which is
 *   single-flight, TTL-gated, backs off on failure, and reports whether the
 *   refresh changed what the ref serves.
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

/**
 * The one platform fetch a ref has in flight, plus everything that settles with
 * it. The change notification lives here rather than on each caller's own
 * `.then`: joiners share this record, so one refresh publishes at most one
 * invalidation no matter how many reads join it.
 */
interface InFlightRefresh {
  promise: Promise<PluginCatalog>;
  /** What the ref served when the refresh started, for change detection. */
  readonly before: string;
  /** Registered by the first caller that supplies one, called at most once. */
  notify?: () => void;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, InFlightRefresh>();
const backoff = new Map<string, BackoffEntry>();

/**
 * Bumped by every invalidation. A refresh captures it at its start and writes
 * its result back only while it still matches, which fences a response that
 * lands after the cache it was meant for was cleared.
 */
let generation = 0;

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

/** Serialized copy of what a ref currently serves, for change detection. */
function catalogSignature(catalog: PluginCatalog): string {
  return JSON.stringify(catalog.matches);
}

/**
 * Fetch the platform catalog into the cache, deduped per ref: concurrent
 * callers share one in-flight request. Resolves with the merged catalog and
 * rejects with the fetch failure, so the authoritative path can propagate it
 * while the display path swallows it.
 *
 * `onChanged` belongs to the refresh, not to the caller: the first caller to
 * supply one registers it on the in-flight record and every later joiner reuses
 * it, so a refresh that moves the catalog notifies exactly once however many
 * reads are waiting on it.
 *
 * A result whose generation no longer matches (the cache was invalidated while
 * the fetch was in flight) is returned to its caller but never written back and
 * never notifies, so a slow response cannot resurrect a cleared cache, overwrite
 * a newer one, or announce a change that was discarded.
 */
function refreshPluginCatalog(
  ref: string,
  deps: SearchPluginsDeps,
  onChanged?: () => void,
): Promise<PluginCatalog> {
  const existing = inFlight.get(ref);
  if (existing) {
    existing.notify ??= onChanged;
    return existing.promise;
  }

  const startedAt = generation;
  const before = catalogSignature(
    cache.get(ref)?.catalog ?? bundledCatalogAt(ref),
  );
  // Declared before the promise so the settle handler reads whatever a later
  // joiner registered rather than only this caller's callback.
  const pending: Pick<InFlightRefresh, "notify"> = { notify: onChanged };

  const promise = fetchPluginCatalogFromPlatform(deps, { ref }).then(
    (catalog) => {
      const merged = mergePlatformCatalogWithBundledLocals(catalog);
      if (generation !== startedAt) {
        return merged;
      }
      inFlight.delete(ref);
      cache.set(ref, { catalog: merged, timestamp: Date.now() });
      backoff.delete(ref);
      if (pending.notify && catalogSignature(merged) !== before) {
        pending.notify();
      }
      return merged;
    },
    (err: unknown) => {
      if (generation === startedAt) {
        inFlight.delete(ref);
        recordRefreshFailure(ref, err);
      }
      throw err;
    },
  );

  inFlight.set(ref, Object.assign(pending, { promise, before }));
  return promise;
}

/**
 * Resolve the catalog at {@link ref} for display, without ever waiting on the
 * platform.
 *
 * A pure read: the in-memory copy when there is one, even past its TTL,
 * otherwise the bundled manifest. Bringing a stale copy up to date is
 * {@link revalidatePluginCatalogInBackground}, which the caller invokes
 * explicitly.
 */
export async function getPluginCatalog(
  ref: string,
  _deps: SearchPluginsDeps,
): Promise<PluginCatalog> {
  if (!arePlatformFeaturesEnabled()) {
    return bundledCatalogAt(ref);
  }
  return cache.get(ref)?.catalog ?? bundledCatalogAt(ref);
}

/**
 * Bring {@link ref} up to date behind the response, at most one refresh at a
 * time.
 *
 * A no-op when platform features are disabled, when the cached copy is still
 * inside its TTL, or while a failed refresh is backing off. Otherwise it starts
 * (or joins) the single in-flight platform fetch and returns immediately.
 * `onChanged` is handed to that refresh rather than chained here, so a refresh
 * that moves the catalog notifies once however many reads joined it: the
 * installed list and the catalog search of one page load, and every tab, share
 * a single invalidation. Telling clients is the caller's job because this
 * module is transport-agnostic and runs in the CLI too. Failures are logged and
 * backed off, never surfaced: the last known catalog keeps serving.
 */
export function revalidatePluginCatalogInBackground(
  ref: string,
  deps: SearchPluginsDeps,
  onChanged?: () => void,
): void {
  if (!arePlatformFeaturesEnabled()) {
    return;
  }

  const cached = cache.get(ref);
  if (cached && isFresh(cached)) {
    return;
  }

  const backingOff = backoff.get(ref);
  if (backingOff && Date.now() < backingOff.until) {
    return;
  }

  // Fire and forget: the refresh populates the cache for the next read, and a
  // rejection is already logged in `recordRefreshFailure`.
  void refreshPluginCatalog(ref, deps, onChanged).catch(() => {});
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
  generation += 1;
  cache.clear();
  inFlight.clear();
  backoff.clear();
}
