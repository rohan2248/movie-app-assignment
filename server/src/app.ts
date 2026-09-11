import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './env';
import { requestContext } from './http/context';
import {
  errorHandler,
  inboundLimiter,
  notFoundHandler,
  readDeviceId,
  requestLogger,
} from './http/middleware';
import { debugRouter } from './routes/debug.routes';
import { healthRouter } from './routes/health.routes';
import { genresRouter, moviesRouter } from './routes/movies.routes';
import { wishlistRouter } from './routes/wishlist.routes';

/**
 * Builds the Express app without listening, so tests can mount it directly.
 *
 * Middleware order matters and is deliberate:
 *   context   -> every later layer can log a request id
 *   logger    -> registers a 'finish' hook before anything can fail
 *   cors      -> must run before routes to answer preflights
 *   json      -> body parsing, capped so a bad client can't exhaust memory
 *   deviceId  -> read (not required) so browsing needs no identity
 *   limiter   -> after deviceId, so the bucket keys on device rather than IP
 *   routes
 *   404       -> a terminal `use`; Express 5 throws on a bare '*' path
 *   errors    -> last, always
 */
export function createApp(): Express {
  const app = express();

  // We sit behind nothing in development, but this keeps req.ip honest if a
  // reviewer runs it behind a tunnel (ngrok/Expo tunnel) for device testing.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(requestLogger);

  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      allowedHeaders: ['content-type', 'x-device-id'],
      exposedHeaders: ['x-request-id', 'retry-after'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '64kb' }));
  app.use(readDeviceId);
  app.use(inboundLimiter());

  app.use('/api', healthRouter);
  app.use('/api/movies', moviesRouter);
  app.use('/api/genres', genresRouter);
  app.use('/api/wishlist', wishlistRouter);

  // Mounted only when explicitly enabled; otherwise these paths 404 like any
  // unknown route.
  if (env.ENABLE_FAULT_INJECTION) {
    app.use('/api/debug', debugRouter);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
