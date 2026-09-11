import { env, redact } from '../env';
import {
  notFound,
  upstreamCredentialRejected,
  upstreamMisconfigured,
  upstreamRateLimited,
  upstreamTimeout,
  upstreamUnavailable,
} from '../http/errors';
import { logger } from '../logger';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import { metrics } from '../resilience/metrics';
import { RateLimiter, RateLimitExceededError } from '../resilience/rate-limiter';
import { DeadlineError, TimeoutError, isRetryableError, retry } from '../resilience/retry';
import {
  InjectedRateLimitError,
  InjectedUpstreamError,
  applyFault,
  faultActive,
  getFaultState,
  injectedDelayMs,
  syntheticBody,
} from './fault-injection';
import { tmdbErrorSchema } from './tmdb-schemas';

/**
 * The single door to TMDB.
 *
 * Composition order, outermost to innermost:
 *
 *   fault injection -> circuit breaker -> rate limiter -> retry -> timeout -> fetch
 *
 * The ordering is the design:
 *  - The breaker is outside the limiter, so a known-dead upstream costs no
 *    tokens and no queue slot.
 *  - The limiter is outside retry, so *each attempt* takes a token rather than
 *    a retry storm bypassing the budget.
 *  - The timeout is innermost and per-attempt, so a slow call is abandoned and
 *    retried instead of consuming the whole request deadline.
 *
 * Caching and in-flight coalescing sit *above* this entirely (in the service
 * layer), so a cache hit costs no tokens at all.
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const PER_ATTEMPT_TIMEOUT_MS = 4_000;
const OVERALL_DEADLINE_MS = 10_000;

const breaker = new CircuitBreaker();
const limiter = new RateLimiter({ capacity: 20, refillPerSecond: 20 });

/** An HTTP error carrying its status, so the retry policy can classify it. */
class TmdbHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TmdbHttpError';
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  // Prefer the v4 bearer token; it is the modern credential and keeps the key
  // out of the URL (and therefore out of logs and proxy access logs).
  if (env.TMDB_ACCESS_TOKEN) headers.authorization = `Bearer ${env.TMDB_ACCESS_TOKEN}`;
  return headers;
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  // Only fall back to the v3 query-param key when no bearer token is available.
  if (!env.TMDB_ACCESS_TOKEN && env.TMDB_API_KEY) {
    url.searchParams.set('api_key', env.TMDB_API_KEY);
  }
  return url.toString();
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return undefined;
}

/** Sleeps under the attempt's abort signal, so a timeout can cut it short. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Performs one HTTP attempt, translating transport and status into our errors. */
async function attemptFetch(
  url: string,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  metrics.upstreamCalls += 1;

  // Injected latency lives here, inside the per-attempt timeout, so a delay
  // longer than the timeout produces a genuine TimeoutError and retry.
  const delayMs = injectedDelayMs();
  if (delayMs > 0) await abortableSleep(delayMs, signal);

  // Only reachable with a fault active (tmdbGet requires a credential
  // otherwise): lets the timeout/slow paths be demonstrated with no API key.
  if (!env.tmdbConfigured) return syntheticBody(path);

  const response = await fetch(url, { headers: authHeaders(), signal });

  if (response.ok) return response.json();

  // Read TMDB's own error text; it explains 401s far better than the status.
  let upstreamMessage = `HTTP ${response.status}`;
  try {
    const parsed = tmdbErrorSchema.safeParse(await response.json());
    if (parsed.success && parsed.data.status_message) {
      upstreamMessage = parsed.data.status_message;
    }
  } catch {
    // A non-JSON error body is not worth failing over.
  }

  throw new TmdbHttpError(
    response.status,
    upstreamMessage,
    parseRetryAfter(response.headers.get('retry-after')),
  );
}

/** Maps any internal failure onto the API's error taxonomy. */
function toApiError(error: unknown): never {
  if (error instanceof TimeoutError || error instanceof DeadlineError) {
    throw upstreamTimeout(error);
  }

  if (error instanceof InjectedRateLimitError) {
    throw upstreamRateLimited(error.retryAfterSeconds);
  }

  if (error instanceof RateLimitExceededError) {
    throw upstreamRateLimited(Math.ceil(error.retryAfterMs / 1000));
  }

  if (error instanceof TmdbHttpError) {
    if (error.status === 429) throw upstreamRateLimited(error.retryAfterSeconds ?? 2);
    // 401/403 mean the key is wrong, which is a configuration problem the
    // reviewer can fix — so say so instead of blaming the network.
    // A present-but-rejected credential is a different diagnosis from a
    // missing one, even though the client treats both the same way.
    if (error.status === 401 || error.status === 403) {
      throw upstreamCredentialRejected(error.status);
    }
    /**
     * An upstream 404 means the resource genuinely does not exist — not that
     * the service is unwell. Mapping it to 503 (as an earlier version did) was
     * wrong twice over: the user saw "service unavailable, retry" instead of
     * "we couldn't find that movie", and the caller's negative-cache branch
     * keys on NOT_FOUND, so every lookup of a bad id re-hit the upstream.
     */
    if (error.status === 404) throw notFound('That movie could not be found.');
    throw upstreamUnavailable(redact(error.message), error);
  }

  if (error instanceof InjectedUpstreamError) {
    throw upstreamUnavailable('Injected upstream failure', error);
  }

  throw upstreamUnavailable('Could not reach the movie service.', error);
}

export type TmdbGetOptions = {
  signal?: AbortSignal;
  /** Overrides the default overall deadline. */
  deadlineMs?: number;
};

export async function tmdbGet<T = unknown>(
  path: string,
  params: Record<string, string> = {},
  options: TmdbGetOptions = {},
): Promise<T> {
  /**
   * Fault injection runs *before* the credential check, deliberately.
   *
   * The injected modes synthesize their own response or failure, so they need
   * no API key. Checking credentials first would have made the entire
   * resilience story undemonstrable until a key was configured — exactly
   * backwards, since a reviewer's first run has no key.
   */
  let interception;
  try {
    interception = await applyFault(path);
  } catch (error) {
    // An injected failure must look exactly like a real one, so it feeds the
    // breaker and the limiter the same way.
    breaker.onFailure(error instanceof InjectedRateLimitError ? 'RATE_LIMIT' : 'INJECTED');
    metrics.upstreamFailures += 1;
    if (error instanceof InjectedRateLimitError) {
      limiter.applyUpstreamCooldown(error.retryAfterSeconds * 1000);
    }
    toApiError(error);
  }

  if (interception.kind === 'respond') {
    // Counted as an upstream call so the demo's numbers stay honest.
    metrics.upstreamCalls += 1;
    breaker.onSuccess();
    return interception.body as T;
  }

  // Passthrough normally needs a real credential. The exception is an active
  // fault: `slow` must still be able to demonstrate the timeout path on a
  // fresh checkout, so attemptFetch synthesizes a body in that case.
  if (!env.tmdbConfigured && !faultActive()) throw upstreamMisconfigured();

  // --- circuit breaker ------------------------------------------------------
  const gate = breaker.canAttempt();
  if (!gate.allowed) {
    // Fails in microseconds instead of after a full timeout. The caller turns
    // this into a stale-cache response where one exists.
    throw upstreamUnavailable(
      'The movie service is temporarily unavailable (circuit open).',
    );
  }

  const url = buildUrl(path, params);

  try {
    const result = await retry(
      async (attempt, signal) => {
        // --- rate limiter: one token per attempt ---------------------------
        await limiter.acquire();

        if (attempt > 1) {
          logger.debug('Retrying TMDB request', { path, attempt });
        }

        return attemptFetch(url, path, signal);
      },
      {
        attempts: 3,
        timeoutMs: PER_ATTEMPT_TIMEOUT_MS,
        deadlineMs: options.deadlineMs ?? OVERALL_DEADLINE_MS,
        signal: options.signal,
        isRetryable: (error) => {
          // Never retry into a queue that just rejected us, and never retry a
          // credential problem.
          if (error instanceof RateLimitExceededError) return false;
          if (error instanceof TmdbHttpError && [401, 403, 404, 422].includes(error.status)) {
            return false;
          }
          return isRetryableError(error);
        },
        onRetry: ({ attempt, delayMs, error }) => {
          // An upstream 429 is an instruction, not a suggestion: cool the
          // whole bucket down so queued callers don't stampede.
          if (error instanceof TmdbHttpError && error.status === 429) {
            limiter.applyUpstreamCooldown((error.retryAfterSeconds ?? 2) * 1000);
          }
          logger.warn('TMDB attempt failed; backing off', {
            path,
            attempt,
            delayMs,
            error: redact(String(error)),
          });
        },
      },
    );

    breaker.onSuccess();
    return result as T;
  } catch (error) {
    metrics.upstreamFailures += 1;

    const code =
      error instanceof TmdbHttpError
        ? `HTTP_${error.status}`
        : error instanceof TimeoutError || error instanceof DeadlineError
          ? 'TIMEOUT'
          : 'TRANSPORT';

    breaker.onFailure(code);

    if (error instanceof TmdbHttpError && error.status === 429) {
      limiter.applyUpstreamCooldown((error.retryAfterSeconds ?? 2) * 1000);
    }

    logger.warn('TMDB request failed', { path, code, error: redact(String(error)) });
    toApiError(error);
  }
}

/* ------------------------------------------------------- introspection ---- */

export const tmdbStats = () => {
  const snapshot = breaker.snapshot();
  return {
    breaker: snapshot.state,
    consecutiveFailures: snapshot.consecutiveFailures,
    lastErrorAt: snapshot.lastErrorAt,
    lastErrorCode: snapshot.lastErrorCode,
  };
};

export const limiterStats = () => limiter.snapshot();
export const faultStats = () => getFaultState();

/** Debug-only breaker control, exposed via POST /api/debug/breaker. */
export const breakerControl = {
  open: () => breaker.forceOpen(),
  close: () => breaker.forceClose(),
};
