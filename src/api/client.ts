import type { ApiErrorBody, ApiErrorCode } from '@shared/api-types';

import { getApiBaseUrl } from '@/api/config';

/** Server codes plus the three failures that never reach the server. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK' | 'TIMEOUT' | 'BAD_RESPONSE';

/**
 * The single error type every query and screen deals with. One taxonomy drives
 * both the retry predicate (`retryable`) and the error copy (`code`).
 */
export class ApiError extends Error {
  readonly code: ClientErrorCode;
  /** HTTP status; 0 when the request never got a response. */
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | null;
  /** From the `Retry-After` header, when the server sent one. */
  readonly retryAfterMs: number | null;

  constructor(init: {
    code: ClientErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    requestId?: string | null;
    retryAfterMs?: number | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/** Above the server's own 10 s upstream deadline, so its 504 wins the race. */
const DEFAULT_TIMEOUT_MS = 15_000;

type QueryValue = string | number | null | undefined;

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  /** React Query's signal: aborts when the query is cancelled or unused. */
  signal?: AbortSignal;
  timeoutMs?: number;
};

// Hand-built rather than URLSearchParams, whose React Native polyfill is incomplete.
function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const pairs = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] != null && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return `${getApiBaseUrl()}${path}${pairs.length ? `?${pairs.join('&')}` : ''}`;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  const requestId = response.headers.get('x-request-id');
  try {
    const { error } = (await response.json()) as ApiErrorBody;
    return new ApiError({
      code: error.code,
      message: error.message,
      status: response.status,
      retryable: error.retryable,
      requestId: error.requestId ?? requestId,
      retryAfterMs,
    });
  } catch {
    // A non-JSON error (proxy page, crashed server) still gets a typed error.
    return new ApiError({
      code: response.status >= 500 ? 'INTERNAL' : 'BAD_RESPONSE',
      message: `Unexpected response (${response.status}).`,
      status: response.status,
      retryable: response.status >= 500,
      requestId,
      retryAfterMs,
    });
  }
}

/**
 * fetch + timeout + cancellation + typed errors.
 *
 * Abort signals are composed by hand (one local controller, a timer, and a
 * listener forwarding the caller's signal) rather than with AbortSignal.any /
 * AbortSignal.timeout, which cannot be assumed to exist in Hermes.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const external = options.signal;
  const forwardAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', forwardAbort);

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;

    try {
      return (await response.json()) as T;
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      throw new ApiError({
        code: 'BAD_RESPONSE',
        message: 'The server sent a response we could not read.',
        status: response.status,
        retryable: false,
        requestId: response.headers.get('x-request-id'),
      });
    }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (timedOut) {
      throw new ApiError({
        code: 'TIMEOUT',
        message: 'The request took too long.',
        status: 0,
        retryable: true,
      });
    }
    // Cancelled by React Query (superseded filters, unmounted screen): rethrow
    // the abort untouched so it is treated as a cancellation, not a failure.
    if (external?.aborted) throw cause;
    throw new ApiError({
      code: 'NETWORK',
      message: 'Could not reach the server.',
      status: 0,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', forwardAbort);
  }
}
