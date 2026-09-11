/**
 * Process-wide counters.
 *
 * These exist so the Status screen can *show* that caching and coalescing are
 * working rather than assert it. Comparing `upstreamCalls` against
 * `cacheHits + cacheMisses` is the demo for "the same information requested
 * repeatedly" and "the user changes filters quickly".
 *
 * Deliberately in-process: a single-instance server is a stated limitation, and
 * the README notes that a real deployment would move these to Redis/StatsD.
 */
export const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  /** Fresh-enough entries served while a background refresh was triggered. */
  staleServes: 0,
  /** Stale entries served *because* the upstream failed (degraded responses). */
  staleIfErrorServes: 0,
  /** Actual network calls made to TMDB. */
  upstreamCalls: 0,
  /** Requests satisfied by an already in-flight identical call. */
  coalescedCalls: 0,
  upstreamFailures: 0,
};

export type Metrics = typeof metrics;

export function resetMetrics(): void {
  for (const key of Object.keys(metrics) as (keyof Metrics)[]) {
    metrics[key] = 0;
  }
}

export function cacheHitRate(): number {
  const total = metrics.cacheHits + metrics.cacheMisses;
  if (total === 0) return 0;
  return Math.round((metrics.cacheHits / total) * 1000) / 1000;
}
