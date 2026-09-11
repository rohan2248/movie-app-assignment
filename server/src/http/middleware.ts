import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@shared/api-types';

import { describeError, logger } from '../logger';
import { ApiError, internal, isApiError, missingDeviceId, rateLimited } from './errors';

/* ------------------------------------------------------------ async errors */

/**
 * Express 5 does forward rejected promises from handlers to the error
 * middleware, but wrapping is explicit rather than relying on that subtlety —
 * and it keeps the behaviour identical if a handler is ever reused elsewhere.
 */
export const asyncHandler =
  <T extends RequestHandler>(handler: T): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };

/* -------------------------------------------------------- request logging */

export const requestLogger: RequestHandler = (req, res, next) => {
  res.on('finish', () => {
    const ms = Math.round(performance.now() - req.ctx.startedAt);
    logger.info(`${req.method} ${req.originalUrl}`, {
      status: res.statusCode,
      ms,
      source: req.ctx.cacheSource,
      upstreamCalls: req.ctx.upstreamCalls || undefined,
      degraded: req.ctx.degraded || undefined,
      requestId: req.ctx.id,
    });
  });
  next();
};

/* ---------------------------------------------------------------- device id */

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Reads and validates `x-device-id`. It is *optional* here and enforced only by
 * `requireDeviceId` on wishlist routes, so browsing never demands an identity.
 */
export const readDeviceId: RequestHandler = (req, _res, next) => {
  const header = req.header('x-device-id');
  if (header && DEVICE_ID_PATTERN.test(header)) {
    req.ctx.deviceId = header;
  }
  next();
};

export const requireDeviceId: RequestHandler = (req, _res, next) => {
  if (!req.ctx.deviceId) return next(missingDeviceId());
  next();
};

/* ----------------------------------------------------------- inbound limits */

type Bucket = { tokens: number; updatedAt: number };

/**
 * Token bucket per device-id (falling back to IP), protecting *this* server
 * from a client loop. This is separate from the outbound limiter that protects
 * TMDB from us — the two failure modes are unrelated and need separate budgets.
 */
export function inboundLimiter(options?: {
  capacity?: number;
  refillPerSecond?: number;
  maxKeys?: number;
}): RequestHandler {
  const capacity = options?.capacity ?? 60;
  const refillPerSecond = options?.refillPerSecond ?? 6; // 60 requests / 10s
  const maxKeys = options?.maxKeys ?? 5_000;
  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const key = req.ctx.deviceId ?? req.ip ?? 'unknown';
    const now = Date.now();

    // Bound memory: an unbounded map keyed by client input is a leak.
    if (buckets.size > maxKeys && !buckets.has(key)) buckets.clear();

    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    const elapsedSeconds = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
      buckets.set(key, bucket);
      return next(rateLimited(retryAfter));
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}

/* ----------------------------------------------------------- 404 + errors */

/**
 * Express 5 uses path-to-regexp v8, where a bare '*' path throws at startup.
 * A terminal `app.use` is the correct way to express "nothing matched".
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new ApiError({
      code: 'NOT_FOUND',
      status: 404,
      message: `No route for ${req.method} ${req.path}`,
      retryable: false,
    }),
  );
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const apiError = isApiError(error) ? error : internal(undefined, error);

  // Unexpected errors are bugs: log them loudly, with the stack.
  if (!isApiError(error)) {
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
      requestId: req.ctx?.id,
      error: describeError(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
    });
  } else if (apiError.status >= 500) {
    logger.warn(`${apiError.code} on ${req.method} ${req.originalUrl}`, {
      requestId: req.ctx?.id,
      error: describeError(error),
    });
  }

  if (apiError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(apiError.retryAfterSeconds));
  }

  const body: ApiErrorBody = {
    error: {
      code: apiError.code,
      message: apiError.message,
      retryable: apiError.retryable,
      requestId: req.ctx?.id ?? 'no-request',
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
    },
  };

  res.status(apiError.status).json(body);
};
