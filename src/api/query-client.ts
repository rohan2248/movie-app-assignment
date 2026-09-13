import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

/**
 * Errors the client must not retry *automatically*, because the server already
 * spent a full retry budget producing them.
 *
 * Measured, not assumed: under a 6 s injected upstream delay the server needs
 * ~10 s to exhaust its own attempts and return `UPSTREAM_TIMEOUT`, so two more
 * client attempts turned a 10 s failure into **30 s** of spinner before any
 * error appeared on screen. Retrying a verdict that was itself the result of
 * retries just multiplies the wait.
 *
 * These stay `retryable: true` in the error taxonomy, which is what puts "Try
 * again" on screen — a person choosing to wait again is different from us
 * deciding for them.
 */
const NO_AUTO_RETRY = new Set(['UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE']);

/**
 * Created per app instance (inside `useState` in the root layout), never at
 * module scope, so the static web prerender cannot share a cache across routes.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        // The server decides what is worth retrying; a 404 or a missing API
        // key will fail identically on every attempt.
        retry: (failureCount, error) =>
          error instanceof ApiError &&
          error.retryable &&
          !NO_AUTO_RETRY.has(error.code) &&
          failureCount < MAX_RETRIES,
        // Honour Retry-After when the server sent one; otherwise back off exponentially.
        retryDelay: (attempt, error) => {
          const hinted = error instanceof ApiError ? error.retryAfterMs : null;
          return Math.min(hinted ?? 1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
        },
        refetchOnWindowFocus: false,
        throwOnError: false,
      },
    },
  });
}
