import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';

import type { MovieDetail, MovieSummary } from '@shared/api-types';

import { db, rawSqlite } from './client';
import { devices, genres, httpCache, movies, wishlist } from './schema';

/**
 * Every database access in the application lives in this file.
 *
 * Keeping it in one place means the storage layer can be reasoned about (and
 * swapped) without auditing the whole server, and it is what would make a move
 * to another SQLite driver a single-file change.
 */

const now = () => Date.now();

/* ------------------------------------------------------------------ devices */

export function touchDevice(deviceId: string, platform?: string): void {
  const timestamp = now();
  db.insert(devices)
    .values({
      deviceId,
      createdAt: timestamp,
      lastSeenAt: timestamp,
      platform: platform ?? null,
    })
    .onConflictDoUpdate({
      target: devices.deviceId,
      set: { lastSeenAt: timestamp },
    })
    .run();
}

/* ------------------------------------------------------------------- movies */

/** Narrows a full detail DTO into the columns we index and order by. */
function toMovieRow(movie: MovieDetail) {
  return {
    id: movie.id,
    title: movie.title,
    releaseYear: movie.releaseYear,
    releaseDate: movie.releaseDate,
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    rating: movie.rating,
    voteCount: movie.voteCount,
    overview: movie.overview,
    runtimeMinutes: movie.runtimeMinutes,
    genreIds: movie.genreIds,
    popularity: movie.popularity,
    payloadJson: movie,
    updatedAt: now(),
  };
}

export function upsertMovie(movie: MovieDetail): void {
  const row = toMovieRow(movie);
  db.insert(movies)
    .values(row)
    .onConflictDoUpdate({ target: movies.id, set: row })
    .run();
}

export function getMovieSnapshot(id: number): MovieDetail | null {
  const row = db.select().from(movies).where(eq(movies.id, id)).get();
  return row?.payloadJson ?? null;
}

export function getMovieSnapshots(ids: number[]): Map<number, MovieDetail> {
  if (ids.length === 0) return new Map();
  const rows = db.select().from(movies).where(inArray(movies.id, ids)).all();
  return new Map(rows.map((row) => [row.id, row.payloadJson]));
}

/* ----------------------------------------------------------------- wishlist */

export type WishlistRowWithMovie = { addedAt: number; movie: MovieDetail };

export function listWishlist(deviceId: string): WishlistRowWithMovie[] {
  const rows = db
    .select({ addedAt: wishlist.addedAt, payload: movies.payloadJson })
    .from(wishlist)
    .innerJoin(movies, eq(movies.id, wishlist.movieId))
    .where(eq(wishlist.deviceId, deviceId))
    .orderBy(desc(wishlist.addedAt))
    .all();

  return rows.map((row) => ({ addedAt: row.addedAt, movie: row.payload }));
}

export function listWishlistIds(deviceId: string): number[] {
  return db
    .select({ movieId: wishlist.movieId })
    .from(wishlist)
    .where(eq(wishlist.deviceId, deviceId))
    .orderBy(desc(wishlist.addedAt))
    .all()
    .map((row) => row.movieId);
}

export function isWishlisted(deviceId: string, movieId: number): boolean {
  const row = db
    .select({ movieId: wishlist.movieId })
    .from(wishlist)
    .where(and(eq(wishlist.deviceId, deviceId), eq(wishlist.movieId, movieId)))
    .get();
  return row !== undefined;
}

/**
 * Adds to the wishlist, guaranteeing the snapshot exists first.
 *
 * The three writes are one transaction because the foreign keys make them
 * mutually dependent: a wishlist row requires both a device row and a movie
 * row. Doing this atomically is what makes "the wishlist always renders, even
 * with TMDB down" a property of the schema rather than a convention.
 *
 * Returns the effective `addedAt` so a repeat add is idempotent and still
 * reports the original time rather than moving the item to the top.
 */
export function addToWishlist(
  deviceId: string,
  movie: MovieDetail,
  addedAtMs: number = now(),
): { addedAt: number; created: boolean } {
  return db.transaction((tx) => {
    const timestamp = now();

    tx.insert(devices)
      .values({ deviceId, createdAt: timestamp, lastSeenAt: timestamp, platform: null })
      .onConflictDoUpdate({ target: devices.deviceId, set: { lastSeenAt: timestamp } })
      .run();

    const movieRow = toMovieRow(movie);
    tx.insert(movies)
      .values(movieRow)
      .onConflictDoUpdate({ target: movies.id, set: movieRow })
      .run();

    const existing = tx
      .select({ addedAt: wishlist.addedAt })
      .from(wishlist)
      .where(and(eq(wishlist.deviceId, deviceId), eq(wishlist.movieId, movie.id)))
      .get();

    if (existing) return { addedAt: existing.addedAt, created: false };

    tx.insert(wishlist)
      .values({ deviceId, movieId: movie.id, addedAt: addedAtMs })
      .run();

    return { addedAt: addedAtMs, created: true };
  });
}

/** Idempotent: removing an absent entry is a success, not a 404. */
export function removeFromWishlist(deviceId: string, movieId: number): boolean {
  const result = db
    .delete(wishlist)
    .where(and(eq(wishlist.deviceId, deviceId), eq(wishlist.movieId, movieId)))
    .run();
  return result.changes > 0;
}

/* ------------------------------------------------------------------- genres */

export function replaceGenres(list: { id: number; name: string }[]): void {
  if (list.length === 0) return;
  const timestamp = now();

  db.transaction((tx) => {
    for (const genre of list) {
      tx.insert(genres)
        .values({ id: genre.id, name: genre.name, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: genres.id,
          set: { name: genre.name, updatedAt: timestamp },
        })
        .run();
    }
  });
}

export function listGenres(): { id: number; name: string }[] {
  return db
    .select({ id: genres.id, name: genres.name })
    .from(genres)
    .orderBy(genres.name)
    .all();
}

export function getGenreMap(): Map<number, string> {
  return new Map(listGenres().map((genre) => [genre.id, genre.name]));
}

/* --------------------------------------------------------------- http cache */

export type CacheRecord = {
  valueJson: string;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
};

export function readCache(cacheKey: string): CacheRecord | null {
  const row = db
    .select({
      valueJson: httpCache.valueJson,
      storedAt: httpCache.storedAt,
      freshUntil: httpCache.freshUntil,
      staleUntil: httpCache.staleUntil,
    })
    .from(httpCache)
    .where(eq(httpCache.cacheKey, cacheKey))
    .get();

  if (!row) return null;

  // Fire-and-forget hit counter; it only feeds the Status screen.
  db.update(httpCache)
    .set({ hits: sql`${httpCache.hits} + 1` })
    .where(eq(httpCache.cacheKey, cacheKey))
    .run();

  return row;
}

export function writeCache(entry: {
  cacheKey: string;
  namespace: string;
  valueJson: string;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
}): void {
  db.insert(httpCache)
    .values({ ...entry, hits: 0 })
    .onConflictDoUpdate({
      target: httpCache.cacheKey,
      set: {
        valueJson: entry.valueJson,
        namespace: entry.namespace,
        storedAt: entry.storedAt,
        freshUntil: entry.freshUntil,
        staleUntil: entry.staleUntil,
      },
    })
    .run();
}

export function deleteCacheNamespace(namespace?: string): number {
  const result = namespace
    ? db.delete(httpCache).where(eq(httpCache.namespace, namespace)).run()
    : db.delete(httpCache).run();
  return result.changes;
}

/** Called on boot and periodically; drops entries past even their stale window. */
export function pruneExpiredCache(atMs: number = now()): number {
  return db.delete(httpCache).where(lt(httpCache.staleUntil, atMs)).run().changes;
}

/**
 * Drops old snapshots that nothing references. The foreign key protects
 * wishlisted movies, so this cannot delete a row the wishlist still needs.
 */
export function pruneUnreferencedMovies(olderThanMs: number): number {
  return db
    .delete(movies)
    .where(
      and(
        lt(movies.updatedAt, olderThanMs),
        sql`${movies.id} NOT IN (SELECT ${wishlist.movieId} FROM ${wishlist})`,
      ),
    )
    .run().changes;
}

/* -------------------------------------------------------------------- stats */

export function getDbStats(): { wishlistRows: number; movieRows: number; cacheRows: number } {
  const single = (value: { value: number } | undefined) => value?.value ?? 0;
  return {
    wishlistRows: single(db.select({ value: count() }).from(wishlist).get()),
    movieRows: single(db.select({ value: count() }).from(movies).get()),
    cacheRows: single(db.select({ value: count() }).from(httpCache).get()),
  };
}

/** Used by tests to get a clean slate without deleting the file. */
export function truncateAll(): void {
  rawSqlite.exec(
    'DELETE FROM wishlist; DELETE FROM movies; DELETE FROM devices; DELETE FROM http_cache; DELETE FROM genres;',
  );
}

/** Re-exported so callers never need to know the DTO/row distinction. */
export type { MovieSummary };
