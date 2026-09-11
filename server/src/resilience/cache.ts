import * as queries from '../db/queries';
import { logger } from '../logger';
import { metrics } from './metrics';

/**
 * A two-tier response cache: in-process LRU (L1) over SQLite (L2).
 *
 * Why two tiers rather than one:
 *  - L1 alone loses everything on restart, so `tsx watch` reloading on every
 *    file save would hammer TMDB during development, and a restarted server
 *    would have no stale data to fall back on if TMDB were down.
 *  - L2 alone costs a SQLite round trip and a JSON parse on every request.
 *
 * Together, the hot path is a Map lookup and a cold start still answers from
 * disk. This is also what makes the demo honest: restart the API, request the
 * same page, and `meta.source` is still `cache`.
 */

export type CacheState = 'fresh' | 'stale' | 'miss';

export type CacheLookup<T> =
  | { state: 'miss'; value: null; storedAt: null }
  | { state: 'fresh' | 'stale'; value: T; storedAt: number };

export type CachePolicy = {
  namespace: string;
  /** Serve without revalidating for this long. */
  freshMs: number;
  /**
   * After `freshMs`, serve stale and revalidate in the background for this
   * long. Past it an entry is only usable as a stale-if-error fallback.
   */
  staleMs: number;
};

type L1Entry = {
  value: unknown;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
  namespace: string;
};

const L1_MAX_ENTRIES = 500;

/**
 * Map iteration order is insertion order, so re-inserting on read turns a Map
 * into an LRU with no extra bookkeeping.
 */
const l1 = new Map<string, L1Entry>();

function l1Set(key: string, entry: L1Entry): void {
  if (l1.has(key)) l1.delete(key);
  l1.set(key, entry);

  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next();
    if (oldest.done) break;
    l1.delete(oldest.value);
  }
}

function l1Get(key: string): L1Entry | undefined {
  const entry = l1.get(key);
  if (!entry) return undefined;
  // Touch for recency.
  l1.delete(key);
  l1.set(key, entry);
  return entry;
}

function classify(entry: { freshUntil: number; staleUntil: number }, atMs: number): CacheState {
  if (atMs < entry.freshUntil) return 'fresh';
  if (atMs < entry.staleUntil) return 'stale';
  return 'miss';
}

/**
 * Looks up an entry, promoting an L2 hit into L1.
 *
 * `includeExpired` is what implements stale-if-error: the normal path ignores
 * entries past their stale window, but a failed upstream call will take
 * anything rather than show the user an error.
 */
export function get<T>(key: string, options: { includeExpired?: boolean } = {}): CacheLookup<T> {
  const atMs = Date.now();
  const miss: CacheLookup<T> = { state: 'miss', value: null, storedAt: null };

  const memory = l1Get(key);
  if (memory) {
    const state = classify(memory, atMs);
    if (state !== 'miss') {
      metrics.cacheHits += 1;
      return { state, value: memory.value as T, storedAt: memory.storedAt };
    }
    if (options.includeExpired) {
      return { state: 'stale', value: memory.value as T, storedAt: memory.storedAt };
    }
  }

  let row: queries.CacheRecord | null = null;
  try {
    row = queries.readCache(key);
  } catch (error) {
    // A cache read must never fail a request.
    logger.warn('L2 cache read failed', { key, error: String(error) });
  }

  if (!row) {
    metrics.cacheMisses += 1;
    return miss;
  }

  let parsed: T;
  try {
    parsed = JSON.parse(row.valueJson) as T;
  } catch (error) {
    logger.warn('Discarding corrupt cache entry', { key, error: String(error) });
    metrics.cacheMisses += 1;
    return miss;
  }

  const state = classify(row, atMs);

  if (state === 'miss' && !options.includeExpired) {
    metrics.cacheMisses += 1;
    return miss;
  }

  l1Set(key, {
    value: parsed,
    storedAt: row.storedAt,
    freshUntil: row.freshUntil,
    staleUntil: row.staleUntil,
    namespace: 'l2',
  });

  metrics.cacheHits += 1;
  return {
    state: state === 'miss' ? 'stale' : state,
    value: parsed,
    storedAt: row.storedAt,
  };
}

export function set<T>(key: string, policy: CachePolicy, value: T): void {
  const storedAt = Date.now();
  const freshUntil = storedAt + policy.freshMs;
  const staleUntil = storedAt + policy.freshMs + policy.staleMs;

  l1Set(key, { value, storedAt, freshUntil, staleUntil, namespace: policy.namespace });

  try {
    queries.writeCache({
      cacheKey: key,
      namespace: policy.namespace,
      valueJson: JSON.stringify(value),
      storedAt,
      freshUntil,
      staleUntil,
    });
  } catch (error) {
    // L1 already holds it; losing durability is not worth failing the response.
    logger.warn('L2 cache write failed', { key, error: String(error) });
  }
}

export function clear(namespace?: string): number {
  if (namespace) {
    for (const [key, entry] of l1) {
      if (entry.namespace === namespace) l1.delete(key);
    }
  } else {
    l1.clear();
  }

  try {
    return queries.deleteCacheNamespace(namespace);
  } catch (error) {
    logger.warn('L2 cache clear failed', { error: String(error) });
    return 0;
  }
}

/**
 * Drops the in-memory tier only, leaving SQLite intact.
 *
 * Exists so a test can simulate a process restart in-process and assert that a
 * cached response is genuinely rehydrated from disk — the property that makes a
 * restarted server answer instantly and keeps a stale-if-error floor available
 * after a cold start.
 */
export function clearL1ForTests(): number {
  const size = l1.size;
  l1.clear();
  return size;
}

export function stats(): { l1Entries: number; l2Entries: number } {
  let l2Entries = 0;
  try {
    l2Entries = queries.getDbStats().cacheRows;
  } catch {
    l2Entries = 0;
  }
  return { l1Entries: l1.size, l2Entries };
}

/**
 * Builds a readable canonical cache key.
 *
 * Deliberately not a hash: `SELECT cache_key FROM http_cache` being
 * human-readable makes the cache demonstrable during a review, and the cost
 * (slightly longer keys) is irrelevant at this scale.
 *
 * Sorting the parameters and dropping empties is what makes
 * `?sort=popularity&page=1` and `?page=1&sort=popularity` a single entry — and
 * the client's query-key factory normalises identically, so both sides agree.
 */
export function cacheKey(
  namespace: string,
  params: Record<string, string | number | boolean | null | undefined | number[]>,
): string {
  const parts = Object.entries(params)
    .map(([key, value]): [string, string] => [
      key,
      Array.isArray(value) ? [...value].sort((a, b) => a - b).join(',') : String(value ?? ''),
    ])
    // Filter on the *rendered* value, so an empty array drops out too rather
    // than leaving a dangling `genres=` in the key.
    .filter(([, rendered]) => rendered !== '' && rendered !== 'null' && rendered !== 'undefined')
    .map(([key, rendered]) => `${key}=${rendered}`)
    .sort();

  return [namespace, ...parts].join('|');
}
