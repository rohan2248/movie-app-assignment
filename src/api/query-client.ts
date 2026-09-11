import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 8_000;

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
          error instanceof ApiError && error.retryable && failureCount < MAX_RETRIES,
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
