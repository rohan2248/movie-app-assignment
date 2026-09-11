/**
 * Retry with exponential backoff and jitter, plus a per-attempt timeout.
 *
 * Two rules keep this from doing harm:
 *
 * 1. **Only retry what can succeed on a retry.** A 401 or a 422 will fail
 *    identically every time; retrying it just triples the latency before the
 *    user sees the same error. Only transport faults, timeouts, 5xx and 429
 *    are retried.
 * 2. **Jitter is not optional.** Without it, N callers that failed together
 *    retry together, producing a synchronised thundering herd against an
 *    upstream that is already struggling.
 */

export class TimeoutError extends Error {
  readonly code = 'TIMEOUT';
  constructor(ms: number) {
    super(`Attempt exceeded ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class DeadlineError extends Error {
  readonly code = 'DEADLINE';
  constructor(ms: number) {
    super(`Overall deadline of ${ms}ms exceeded`);
    this.name = 'DeadlineError';
  }
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  /** Per-attempt cap. */
  timeoutMs?: number;
  /** Cap across *all* attempts, so a retry chain can't outlive the request. */
  deadlineMs?: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs one attempt under its own timeout, aborting the underlying work. */
export async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  outerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);

  const forwardAbort = () => controller.abort(outerSignal?.reason);
  outerSignal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', forwardAbort);
  }
}

/** Default policy: transport faults, timeouts, and 5xx/429 responses. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof DeadlineError) return false;

  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') {
    return status >= 500 || status === 429 || status === 408;
  }

  const code = (error as { code?: string })?.code;
  if (
    code &&
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET'].includes(
      code,
    )
  ) {
    return true;
  }

  // Undici surfaces most transport problems as a bare TypeError.
  if (error instanceof TypeError && /fetch failed|network|socket/i.test(error.message)) {
    return true;
  }

  return false;
}

export async function retry<T>(
  fn: (attempt: number, signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3; // 1 initial + 2 retries
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const deadlineMs = options.deadlineMs ?? 10_000;
  const isRetryable = options.isRetryable ?? isRetryableError;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const startedAt = now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const elapsed = now() - startedAt;
    if (elapsed >= deadlineMs) throw new DeadlineError(deadlineMs);

    // Never let a single attempt run past the overall deadline.
    const attemptTimeout = Math.min(timeoutMs, deadlineMs - elapsed);

    try {
      return await withTimeout(attemptTimeout, (signal) => fn(attempt, signal), options.signal);
    } catch (error) {
      lastError = error;

      if (options.signal?.aborted) throw error;
      if (attempt >= attempts || !isRetryable(error)) throw error;

      const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      // +/- jitterRatio around the exponential value.
      const jitter = exponential * jitterRatio * (random() * 2 - 1);
      const delayMs = Math.max(0, Math.round(exponential + jitter));

      // Pointless to sleep if waking up would already be past the deadline.
      if (now() - startedAt + delayMs >= deadlineMs) throw new DeadlineError(deadlineMs);

      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }

  throw lastError;
}
