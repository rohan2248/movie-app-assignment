import type { Request, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Per-request context.
 *
 * `cacheSource` and `upstreamCalls` are written by the service layer and read
 * by the request logger, which is what makes caching and in-flight coalescing
 * *observable*: one log line per request shows whether it hit the cache and how
 * many TMDB calls it actually cost. A burst of filter changes should show a
 * handful of requests and far fewer upstream calls.
 */
export type RequestContext = {
  id: string;
  startedAt: number;
  deviceId?: string;
  cacheSource?: 'live' | 'cache' | 'stale-cache';
  upstreamCalls: number;
  degraded?: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}

export const requestContext: RequestHandler = (req, res, next) => {
  req.ctx = {
    id: randomUUID(),
    startedAt: performance.now(),
    upstreamCalls: 0,
  };
  // Echoed so a reviewer can correlate a UI error banner with a server log line.
  res.setHeader('x-request-id', req.ctx.id);
  next();
};

/** Safe accessor for code paths that may run outside a request (tests, GC). */
export const requestIdOf = (req?: Request): string => req?.ctx?.id ?? 'no-request';
