import type { BreakerState, FaultMode, HealthResponse } from '@shared/api-types';

import { env } from '../env';
import { cacheHitRate, metrics } from '../resilience/metrics';

/**
 * Health is assembled from *registered providers* rather than by importing the
 * db, cache and TMDB client directly.
 *
 * Two payoffs: this module stays a leaf (no import cycles with the cache, which
 * itself writes to the db), and the server boots and reports health even when a
 * subsystem is absent — which is exactly the state a reviewer is in before
 * configuring a TMDB key.
 */

export type DbStats = { path: string; wishlistRows: number; movieRows: number };
export type CacheStats = { l1Entries: number; l2Entries: number };
export type TmdbStats = {
  breaker: BreakerState;
  consecutiveFailures: number;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
};
export type FaultStats = { mode: FaultMode; latencyMs: number; failRate: number };

type Providers = {
  db?: () => DbStats;
  cache?: () => CacheStats;
  tmdb?: () => TmdbStats;
  fault?: () => FaultStats;
};

const providers: Providers = {};

export function registerHealthProviders(next: Providers): void {
  Object.assign(providers, next);
}

const startedAt = Date.now();

/** Never throws: a failing provider degrades one section, not the whole report. */
function safely<T>(provider: (() => T) | undefined, fallback: T): T {
  if (!provider) return fallback;
  try {
    return provider();
  } catch {
    return fallback;
  }
}

export function buildHealth(version: string): HealthResponse {
  const db = safely(providers.db, {
    path: env.DATABASE_PATH,
    wishlistRows: 0,
    movieRows: 0,
  });
  const cache = safely(providers.cache, { l1Entries: 0, l2Entries: 0 });
  const tmdb = safely(providers.tmdb, {
    breaker: 'closed' as BreakerState,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorCode: null,
  });
  const fault = safely(providers.fault, {
    mode: 'off' as FaultMode,
    latencyMs: 0,
    failRate: 0,
  });

  // "degraded" means the app still works but not from live data — the same
  // notion the list endpoints report per-response via meta.degraded.
  const degraded = !env.tmdbConfigured || tmdb.breaker !== 'closed';

  return {
    status: degraded ? 'degraded' : 'ok',
    version,
    uptimeMs: Date.now() - startedAt,
    tmdb: {
      configured: env.tmdbConfigured,
      breaker: tmdb.breaker,
      consecutiveFailures: tmdb.consecutiveFailures,
      lastErrorAt: tmdb.lastErrorAt,
      lastErrorCode: tmdb.lastErrorCode,
    },
    cache: {
      l1Entries: cache.l1Entries,
      l2Entries: cache.l2Entries,
      hits: metrics.cacheHits,
      misses: metrics.cacheMisses,
      staleServes: metrics.staleServes + metrics.staleIfErrorServes,
      hitRate: cacheHitRate(),
    },
    upstreamCalls: metrics.upstreamCalls,
    faultInjection: {
      enabled: env.ENABLE_FAULT_INJECTION,
      mode: fault.mode,
      latencyMs: fault.latencyMs,
      failRate: fault.failRate,
    },
    db,
  };
}
