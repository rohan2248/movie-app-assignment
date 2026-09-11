import { ApiError, type ClientErrorCode } from '@/api/client';

export type ErrorCopy = {
  title: string;
  message: string;
  /** Whether offering "Try again" could plausibly help. */
  canRetry: boolean;
};

/**
 * Every error code mapped to human copy in one table, so no screen invents its
 * own wording. `null` message means "use the server's message", reserved for
 * codes where the server's text is more specific than anything generic.
 */
const COPY: Record<ClientErrorCode, { title: string; message: string | null }> = {
  NETWORK: {
    title: "Can't reach the server",
    message: 'Check your connection. If you are running the app locally, make sure the API is running.',
  },
  TIMEOUT: { title: 'This is taking too long', message: 'The server did not answer in time.' },
  UPSTREAM_TIMEOUT: {
    title: 'The movie service is slow',
    message: 'It did not answer in time. Trying again usually works.',
  },
  UPSTREAM_UNAVAILABLE: {
    title: 'The movie service is unavailable',
    message: 'It is not responding right now. Please try again in a moment.',
  },
  UPSTREAM_RATE_LIMITED: {
    title: 'Too many requests',
    message: 'The movie service asked us to slow down. Try again in a few seconds.',
  },
  RATE_LIMITED: {
    title: 'Too many requests',
    message: 'Slow down a little and try again in a few seconds.',
  },
  UPSTREAM_MISCONFIGURED: { title: 'Movie data is not set up', message: null },
  NOT_FOUND: { title: 'Not found', message: 'We could not find what you were looking for.' },
  BAD_REQUEST: { title: 'Something went wrong', message: 'That request was not valid.' },
  MISSING_DEVICE_ID: { title: 'Something went wrong', message: 'Please restart the app.' },
  BAD_RESPONSE: { title: 'Something went wrong', message: 'The server sent a response we could not read.' },
  INTERNAL: { title: 'Something went wrong', message: 'The server hit an unexpected error.' },
};

export function describeError(error: unknown): ErrorCopy {
  if (error instanceof ApiError) {
    const copy = COPY[error.code] ?? COPY.INTERNAL;
    return {
      title: copy.title,
      message: copy.message ?? error.message,
      canRetry: error.retryable,
    };
  }
  return { title: 'Something went wrong', message: 'An unexpected error occurred.', canRetry: true };
}
