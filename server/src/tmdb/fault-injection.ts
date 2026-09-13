import type { FaultMode } from '@shared/api-types';

import { env } from '../env';
import { logger } from '../logger';

/**
 * Deliberate upstream failures, for demonstrating the resilience behaviour.
 *
 * The assignment asks the application to behave well when the external service
 * is slow, unavailable, rate limiting, or returning junk. Waiting for TMDB to
 * actually do those things is not a test strategy, so they can be induced.
 *
 * The key design decision: this intercepts at the *outermost* layer of the
 * TMDB client, replacing only the network call. Every real mechanism —
 * timeouts, retry with backoff, the circuit breaker, the rate limiter, the
 * cache, and the zod normalisation — still executes exactly as in production.
 * Nothing is stubbed, so the demo proves the actual code paths.
 *
 * Gated behind ENABLE_FAULT_INJECTION; the debug routes 404 without it.
 */

export type FaultState = {
  mode: FaultMode;
  latencyMs: number;
  failRate: number;
};

const state: FaultState = { mode: 'off', latencyMs: 3_000, failRate: 1 };

export function getFaultState(): FaultState {
  return { ...state };
}

export function setFaultState(next: {
  mode: FaultMode;
  latencyMs?: number;
  failRate?: number;
}): FaultState {
  state.mode = next.mode;
  if (next.latencyMs !== undefined) state.latencyMs = next.latencyMs;
  if (next.failRate !== undefined) state.failRate = next.failRate;

  logger.warn('Fault injection changed', state as unknown as Record<string, unknown>);
  return getFaultState();
}

export const faultInjectionEnabled = (): boolean => env.ENABLE_FAULT_INJECTION;

/** Thrown for `fail`; shaped like an HTTP error so the real retry policy applies. */
export class InjectedUpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Injected upstream failure (${status})`);
    this.name = 'InjectedUpstreamError';
  }
}

export class InjectedRateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super('Injected upstream rate limit (429)');
    this.name = 'InjectedRateLimitError';
  }
}

export type Interception =
  | { kind: 'passthrough' }
  /** Replace the network response body, then let real parsing run on it. */
  | { kind: 'respond'; body: unknown };

/**
 * The injected latency, applied *inside* the timed attempt by the client.
 *
 * It deliberately does not sleep here. An earlier version awaited the delay at
 * this outer layer, which meant a 6s delay ran to completion and *then* started
 * a fresh request with its own 4s budget — so the per-attempt timeout could
 * never fire and `slow` mode proved nothing. Returning the duration lets the
 * client await it under the attempt's abort signal, where the timeout applies.
 */
export function injectedDelayMs(): number {
  if (!faultInjectionEnabled() || state.mode !== 'slow') return 0;
  return state.latencyMs;
}

/** True when a fault is active, so the client can skip the credential check. */
export function faultActive(): boolean {
  return faultInjectionEnabled() && state.mode !== 'off';
}

/**
 * A plausible, valid payload used only when a fault is active and no TMDB
 * credential is configured — so every fault mode (including the timeout path)
 * is demonstrable on a fresh checkout with no API key.
 */
export function syntheticBody(path: string): unknown {
  if (isGenrePath(path)) {
    return {
      genres: [
        { id: 28, name: 'Action' },
        { id: 35, name: 'Comedy' },
        { id: 18, name: 'Drama' },
        { id: 878, name: 'Science Fiction' },
        { id: 53, name: 'Thriller' },
      ],
    };
  }

  if (isListPath(path)) {
    return {
      page: 1,
      total_pages: 3,
      total_results: 60,
      results: Array.from({ length: 20 }, (_unused, index) => ({
        id: 900_000 + index,
        title: `Synthetic Movie ${index + 1}`,
        poster_path: null,
        release_date: '2020-01-01',
        vote_average: 7 + (index % 3) * 0.5,
        vote_count: 500 + index,
        genre_ids: [28, 18],
        popularity: 50 - index,
      })),
    };
  }

  return {
    id: 900_000,
    title: 'Synthetic Movie',
    overview: 'Returned by fault injection because no TMDB key is configured.',
    poster_path: null,
    backdrop_path: null,
    release_date: '2020-01-01',
    runtime: 108,
    vote_average: 7.5,
    vote_count: 1200,
    genres: [{ id: 28, name: 'Action' }],
  };
}

const isListPath = (path: string) => path.includes('/discover/') || path.includes('/search/');
/**
 * The genre catalogue needs its own fixtures. Without this it fell through to
 * the *movie detail* body, whose `genres` array has exactly one valid entry —
 * so `malformed` and `empty` silently replaced all 19 genres with a single
 * "Thriller" chip. That looked like a bug in genre handling rather than the
 * injected upstream fault it actually was.
 */
const isGenrePath = (path: string) => path.includes('/genre/');

/** Two valid rows and three unusable ones, to show per-item dropping. */
function malformedGenreBody(): unknown {
  return {
    genres: [
      { id: 28, name: 'Action' },
      { id: 18 }, // no name
      { name: 'Drama' }, // no id
      { id: 'x', name: 'Broken' }, // non-numeric id
      { id: 53, name: '   ' }, // whitespace name
      { id: 35, name: 'Comedy' },
    ],
  };
}

/**
 * A page that is *partly* broken.
 *
 * Chosen to hit every normalisation rule at once: an item with no id (must be
 * dropped), an item with a non-numeric id (dropped), an item with nulls
 * throughout (kept, rendered with placeholders), one with a whitespace title
 * and an out-of-range rating (kept, clamped), and a non-numeric `total_pages`
 * on the envelope. A correct implementation still renders a usable page.
 */
function malformedListBody(): unknown {
  return {
    page: 1,
    total_pages: 'abc',
    total_results: null,
    results: [
      {},
      { id: 'not-a-number', title: 'Bad id' },
      {
        id: 1,
        title: null,
        original_title: null,
        poster_path: null,
        release_date: '',
        vote_average: null,
        vote_count: 0,
        genre_ids: null,
      },
      {
        id: 2,
        title: '   ',
        original_title: 'Whitespace Title',
        poster_path: 'no-leading-slash.jpg',
        release_date: '0000-00-00',
        vote_average: 11.4,
        vote_count: 12,
        genre_ids: [18, 'x', 53],
      },
      {
        id: 3,
        title: 'Perfectly Fine Movie',
        poster_path: '/fine.jpg',
        release_date: '2019-07-02',
        vote_average: 7.25,
        vote_count: 1200,
        genre_ids: [28],
      },
    ],
  };
}

function malformedDetailBody(): unknown {
  return {
    id: 1,
    title: '',
    original_title: '',
    overview: '   ',
    poster_path: null,
    backdrop_path: null,
    release_date: 'not-a-date',
    runtime: 0,
    vote_average: -3,
    vote_count: 0,
    genres: [{ id: 18 }, { name: 'Drama' }, { id: 53, name: 'Thriller' }],
  };
}

/**
 * Applies the active fault, if any. Returns whether the caller should proceed
 * with a real network call.
 */
export async function applyFault(path: string): Promise<Interception> {
  if (!faultInjectionEnabled() || state.mode === 'off') return { kind: 'passthrough' };

  switch (state.mode) {
    case 'slow':
      // The delay itself is applied by the client inside the timed attempt
      // (see injectedDelayMs), so the real timeout logic can abort it.
      return { kind: 'passthrough' };

    case 'fail': {
      if (Math.random() < state.failRate) throw new InjectedUpstreamError(503);
      return { kind: 'passthrough' };
    }

    case 'rate-limit':
      throw new InjectedRateLimitError(2);

    case 'malformed':
      return {
        kind: 'respond',
        body: isGenrePath(path)
          ? malformedGenreBody()
          : isListPath(path)
            ? malformedListBody()
            : malformedDetailBody(),
      };

    case 'empty':
      return {
        kind: 'respond',
        body: isGenrePath(path)
          ? { genres: [] }
          : isListPath(path)
            ? { page: 1, results: [], total_pages: 0, total_results: 0 }
            : malformedDetailBody(),
      };

    // 'off' is unreachable: handled by the early return above.
    default:
      return { kind: 'passthrough' };
  }
}
