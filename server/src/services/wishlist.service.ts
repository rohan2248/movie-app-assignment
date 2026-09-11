import type {
  MovieDetail,
  MovieSummary,
  WishlistEntry,
  WishlistOp,
} from '@shared/api-types';

import * as queries from '../db/queries';
import { logger } from '../logger';
import { placeholderDetail, summaryToDetail, toMovieSummary } from './dto';

/**
 * Wishlist logic.
 *
 * The wishlist is the one piece of state this application *owns* — everything
 * else is a cache of somebody else's data. So it is stored server-side and
 * treated as durable, while the app keeps a local mirror purely for instant
 * and offline reads.
 */

/**
 * Resolves a full snapshot for a movie the client wants to save.
 *
 * Injected rather than imported so this service has no dependency on the TMDB
 * client: it works, and is testable, with no network and no API key. Phase 3
 * supplies a resolver that fetches details; without one the chain simply ends
 * at the client-supplied summary.
 */
export type DetailResolver = (id: number) => Promise<MovieDetail | null>;

let resolveDetail: DetailResolver | null = null;

export function setDetailResolver(resolver: DetailResolver): void {
  resolveDetail = resolver;
}

/**
 * Preference order, best data first:
 *   1. a snapshot we already hold (may be a full detail from a prior view)
 *   2. the summary the client posted (avoids a network call entirely)
 *   3. a live detail fetch, if a resolver is registered and upstream is healthy
 *   4. a placeholder
 *
 * Step 4 matters: it means wishlisting *never fails* because TMDB is down. The
 * row self-heals the next time the movie is viewed successfully.
 */
async function resolveSnapshot(
  movieId: number,
  supplied?: MovieSummary,
): Promise<MovieDetail> {
  const existing = queries.getMovieSnapshot(movieId);
  if (existing && existing.title !== 'Untitled') return existing;

  if (supplied) return summaryToDetail(supplied);

  if (resolveDetail) {
    try {
      const fetched = await resolveDetail(movieId);
      if (fetched) return fetched;
    } catch (error) {
      logger.warn('Could not fetch details while wishlisting; storing a placeholder', {
        movieId,
        error: String(error),
      });
    }
  }

  return existing ?? placeholderDetail(movieId);
}

const toEntry = (row: { addedAt: number; movie: MovieDetail }): WishlistEntry => ({
  movie: toMovieSummary(row.movie),
  addedAt: new Date(row.addedAt).toISOString(),
});

export function getWishlist(deviceId: string): WishlistEntry[] {
  return queries.listWishlist(deviceId).map(toEntry);
}

export function getWishlistIds(deviceId: string): number[] {
  return queries.listWishlistIds(deviceId);
}

export async function addToWishlist(
  deviceId: string,
  movieId: number,
  supplied?: MovieSummary,
): Promise<{ entry: WishlistEntry; created: boolean }> {
  const snapshot = await resolveSnapshot(movieId, supplied);
  const { addedAt, created } = queries.addToWishlist(deviceId, snapshot);

  return {
    entry: { movie: toMovieSummary(snapshot), addedAt: new Date(addedAt).toISOString() },
    created,
  };
}

/** Idempotent by design: the client's intent is "not in my list". */
export function removeFromWishlist(deviceId: string, movieId: number): boolean {
  return queries.removeFromWishlist(deviceId, movieId);
}

/**
 * Applies a batch of queued offline writes.
 *
 * Conflicts are resolved last-write-wins per movie by the client's `at`
 * timestamp: if a user toggled the same movie several times while offline, only
 * the final intent is applied. This is a deliberate simplification — with two
 * devices and clock skew it can lose an interleaved edit, which the README
 * states as a known limitation.
 */
export async function syncWishlist(
  deviceId: string,
  ops: WishlistOp[],
): Promise<{ items: WishlistEntry[]; applied: number; rejected: number }> {
  const latestPerMovie = new Map<number, WishlistOp>();

  for (const op of ops) {
    const current = latestPerMovie.get(op.movieId);
    if (!current || new Date(op.at).getTime() >= new Date(current.at).getTime()) {
      latestPerMovie.set(op.movieId, op);
    }
  }

  let applied = 0;
  let rejected = 0;

  for (const op of latestPerMovie.values()) {
    try {
      if (op.op === 'add') {
        const snapshot = await resolveSnapshot(op.movieId, op.movie);
        const at = new Date(op.at).getTime();
        queries.addToWishlist(
          deviceId,
          snapshot,
          Number.isFinite(at) ? at : Date.now(),
        );
      } else {
        queries.removeFromWishlist(deviceId, op.movieId);
      }
      applied += 1;
    } catch (error) {
      rejected += 1;
      logger.warn('Rejected a wishlist sync op', {
        movieId: op.movieId,
        op: op.op,
        error: String(error),
      });
    }
  }

  return { items: getWishlist(deviceId), applied, rejected };
}
