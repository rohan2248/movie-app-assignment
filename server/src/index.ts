/**
 * Entry point.
 *
 * `dotenv/config` must be the very first import: env.ts validates
 * `process.env` at module scope, so anything that loads it before the .env file
 * is read would see an empty config. A side-effect import guarantees that
 * ordering in a way an explicit `loadEnv()` call site can get wrong.
 */
import 'dotenv/config';

import { createApp } from './app';
import { closeDb } from './db/client';
import { runMigrations } from './db/migrate';
import { getDbStats, pruneExpiredCache, pruneUnreferencedMovies } from './db/queries';
import { env } from './env';
import { logger } from './logger';
import * as cache from './resilience/cache';
import { registerHealthProviders } from './services/health.service';
import { resolveDetailForSnapshot } from './services/movies.service';
import { setDetailResolver } from './services/wishlist.service';
import { faultStats, tmdbStats } from './tmdb/tmdb-client';

const CACHE_GC_INTERVAL_MS = 10 * 60 * 1000;
const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Keeps the cache table from growing without bound over a long dev session. */
function startCacheGc(): NodeJS.Timeout {
  const sweep = () => {
    try {
      const cacheRows = pruneExpiredCache();
      const movieRows = pruneUnreferencedMovies(Date.now() - SNAPSHOT_RETENTION_MS);
      if (cacheRows || movieRows) {
        logger.debug('Pruned stale rows', { cacheRows, movieRows });
      }
    } catch (error) {
      logger.warn('Cache GC failed', { error: String(error) });
    }
  };

  sweep();
  // unref so a pending timer never holds the process open on shutdown.
  return setInterval(sweep, CACHE_GC_INTERVAL_MS).unref();
}

function main(): void {
  runMigrations();

  registerHealthProviders({
    db: () => {
      const stats = getDbStats();
      return {
        path: env.databaseAbsolutePath,
        wishlistRows: stats.wishlistRows,
        movieRows: stats.movieRows,
      };
    },
    cache: () => cache.stats(),
    tmdb: () => tmdbStats(),
    fault: () => faultStats(),
  });

  // Injected here rather than imported by the wishlist service, so that service
  // stays testable with no network and no API key. This is the last resort in
  // its snapshot chain: it only runs when a movie is wishlisted by bare id and
  // we hold nothing locally.
  setDetailResolver(resolveDetailForSnapshot);

  startCacheGc();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info('API listening', {
      url: `http://localhost:${env.PORT}`,
      env: env.NODE_ENV,
      tmdb: env.tmdbConfigured ? 'configured' : 'NOT CONFIGURED',
      faultInjection: env.ENABLE_FAULT_INJECTION ? 'enabled' : 'disabled',
    });

    if (!env.tmdbConfigured) {
      logger.warn(
        'No TMDB credentials found. Browsing will return 503 UPSTREAM_MISCONFIGURED; ' +
          'genres fall back to a built-in list and the wishlist still works. ' +
          'Set TMDB_ACCESS_TOKEN or TMDB_API_KEY in server/.env to enable live data.',
      );
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.PORT} is already in use. Stop the other process or set PORT in server/.env.`,
      );
      process.exit(1);
    }
    throw error;
  });

  // Graceful shutdown so `tsx watch` restarts don't leave the port held or the
  // SQLite WAL mid-checkpoint.
  const shutdown = (signal: string) => () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    // Don't hang forever on a stuck keep-alive connection.
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main();
