import type { ApiErrorCode } from '@shared/api-types';

/**
 * One error taxonomy for the whole server.
 *
 * Every failure is expressed as an ApiError carrying a stable `code`, an HTTP
 * status, and a `retryable` flag. The client mirrors this taxonomy, so the same
 * three fields drive its retry predicate AND its user-facing copy — no screen
 * has to guess whether a failure is worth a Retry button.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  /** Seconds — surfaced as a `Retry-After` header when present. */
  readonly retryAfterSeconds?: number;

  constructor(init: {
    code: ApiErrorCode;
    status: number;
    message: string;
    retryable: boolean;
    details?: unknown;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/* Constructors, so call sites never have to remember a status/retryable pairing. */

export const badRequest = (message: string, details?: unknown) =>
  new ApiError({ code: 'BAD_REQUEST', status: 400, message, retryable: false, details });

export const missingDeviceId = () =>
  new ApiError({
    code: 'MISSING_DEVICE_ID',
    status: 400,
    message: 'This request requires an x-device-id header.',
    retryable: false,
  });

export const notFound = (message = 'Not found') =>
  new ApiError({ code: 'NOT_FOUND', status: 404, message, retryable: false });

export const rateLimited = (retryAfterSeconds: number) =>
  new ApiError({
    code: 'RATE_LIMITED',
    status: 429,
    message: 'Too many requests. Please slow down.',
    retryable: true,
    retryAfterSeconds,
  });

export const upstreamTimeout = (cause?: unknown) =>
  new ApiError({
    code: 'UPSTREAM_TIMEOUT',
    status: 504,
    message: 'The movie service took too long to respond.',
    retryable: true,
    cause,
  });

export const upstreamUnavailable = (message = 'The movie service is unavailable.', cause?: unknown) =>
  new ApiError({ code: 'UPSTREAM_UNAVAILABLE', status: 503, message, retryable: true, cause });

export const upstreamRateLimited = (retryAfterSeconds: number) =>
  new ApiError({
    code: 'UPSTREAM_RATE_LIMITED',
    status: 503,
    message: 'The movie service is rate limiting us. Please retry shortly.',
    retryable: true,
    retryAfterSeconds,
  });

/**
 * Deliberately names the file to edit. A reviewer who forgot the TMDB key
 * should see an instruction, not an empty grid that looks like a bug.
 */
export const upstreamMisconfigured = () =>
  new ApiError({
    code: 'UPSTREAM_MISCONFIGURED',
    status: 503,
    message:
      'No TMDB credentials configured. Copy server/.env.example to server/.env and set TMDB_ACCESS_TOKEN or TMDB_API_KEY.',
    retryable: false,
  });

export const internal = (message = 'Something went wrong.', cause?: unknown) =>
  new ApiError({ code: 'INTERNAL', status: 500, message, retryable: true, cause });

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
