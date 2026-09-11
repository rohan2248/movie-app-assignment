import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { MovieDetail } from '@shared/api-types';

/**
 * The database schema — the single source of truth for the DB deliverable.
 *
 * All timestamps are epoch milliseconds stored as INTEGER. Chosen over SQLite's
 * TEXT dates so ordering and range pruning are plain integer comparisons, and
 * over Drizzle's `{ mode: 'timestamp' }` so what is stored is obvious to anyone
 * opening the file in a sqlite3 shell during a review.
 *
 * Note: Drizzle's SQLite builder has no `WITHOUT ROWID` support, so the three
 * composite/text-PK tables below forgo that storage optimisation. At this scale
 * it is irrelevant, and keeping the schema in one typed file is worth more.
 */

/* ------------------------------------------------------------------ devices */

/**
 * An anonymous device is our unit of identity. There is no auth: the app
 * generates an opaque id on first launch and sends it as `x-device-id`.
 * Documented in the README as an explicit assumption.
 */
export const devices = sqliteTable('devices', {
  deviceId: text('device_id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  platform: text('platform'),
});

/* ------------------------------------------------------------------- movies */

/**
 * A denormalized snapshot of every movie we have ever needed to remember.
 *
 * This is what makes the wishlist survive TMDB being down: a wishlist row
 * cannot exist without a movies row (enforced by the foreign key below), so
 * the wishlist screen always has something real to render.
 */
export const movies = sqliteTable(
  'movies',
  {
    /** The TMDB id. Not autoincrement — we adopt the upstream identifier. */
    id: integer('id').primaryKey(),
    title: text('title').notNull(),
    releaseYear: integer('release_year'),
    releaseDate: text('release_date'),
    posterUrl: text('poster_url'),
    backdropUrl: text('backdrop_url'),
    rating: real('rating'),
    voteCount: integer('vote_count').notNull().default(0),
    overview: text('overview'),
    runtimeMinutes: integer('runtime_minutes'),
    genreIds: text('genre_ids', { mode: 'json' })
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'`),
    popularity: real('popularity'),

    /**
     * The full DTO, exactly as served to the client.
     *
     * Deliberately duplicates the columns above: the columns exist for
     * indexing, ordering and human inspection, while this lets us reconstruct a
     * response with no field-by-field mapping and stay forward-compatible as
     * the DTO grows. `$type<MovieDetail>()` ties it to the shared contract, so
     * the round-trip through SQLite is type-checked rather than cast.
     */
    payloadJson: text('payload_json', { mode: 'json' }).$type<MovieDetail>().notNull(),

    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('idx_movies_updated_at').on(t.updatedAt)],
);

/* ----------------------------------------------------------------- wishlist */

export const wishlist = sqliteTable(
  'wishlist',
  {
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.deviceId, { onDelete: 'cascade' }),
    /** The FK is the feature: no wishlist row without a renderable snapshot. */
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.movieId] }),
    /**
     * Serves the only read this table has: "this device's wishlist, newest
     * first". Drizzle indexes take no ASC/DESC directive, but `.on()` accepts
     * SQL (IndexColumn = SQLiteColumn | SQL), so the ordering is expressed here.
     */
    index('idx_wishlist_device_added').on(t.deviceId, sql`${t.addedAt} DESC`),
  ],
);

/* --------------------------------------------------------------- http_cache */

/**
 * The persistent (L2) half of the response cache.
 *
 * Living in SQLite rather than only in memory is what lets a restarted server
 * still answer instantly from cache, and gives stale-if-error a floor to fall
 * back to after a cold start.
 */
export const httpCache = sqliteTable(
  'http_cache',
  {
    /** A readable canonical key, not a hash, so the cache is inspectable. */
    cacheKey: text('cache_key').primaryKey(),
    namespace: text('namespace').notNull(),
    valueJson: text('value_json').notNull(),
    storedAt: integer('stored_at').notNull(),
    /** Serve without revalidating until this instant. */
    freshUntil: integer('fresh_until').notNull(),
    /** Serve stale (and revalidate in the background) until this instant. */
    staleUntil: integer('stale_until').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [
    index('idx_http_cache_stale_until').on(t.staleUntil),
    index('idx_http_cache_namespace').on(t.namespace),
  ],
);

/* ------------------------------------------------------------------- genres */

/** Mirrors TMDB's genre list so names can be resolved with no upstream call. */
export const genres = sqliteTable('genres', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/* -------------------------------------------------------------------- types */

export type DeviceRow = typeof devices.$inferSelect;
export type MovieRow = typeof movies.$inferSelect;
export type NewMovieRow = typeof movies.$inferInsert;
export type WishlistRow = typeof wishlist.$inferSelect;
export type HttpCacheRow = typeof httpCache.$inferSelect;
export type GenreRow = typeof genres.$inferSelect;
