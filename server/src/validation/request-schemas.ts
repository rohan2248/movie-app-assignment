import { z } from 'zod';

import { SORT_KEYS } from '@shared/api-types';

/**
 * Inbound request validation.
 *
 * The policy throughout is **clamp, don't reject**: a `page=99999` or
 * `genres=28,28,35,...` is a client bug or a curious reviewer, not an attack,
 * and returning a usable page beats a 400. Only genuinely unusable input (a
 * non-numeric id, a 500-character query) is rejected. Every clamp is echoed
 * back in `meta.applied`, so the client can always see what was actually used.
 */

/** TMDB refuses pages past 500; clamping here means the client never sees that. */
export const MAX_PAGE = 500;
export const MAX_QUERY_LENGTH = 120;
export const MAX_GENRES = 5;

const movieSummarySchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  releaseYear: z.number().int().nullable(),
  posterUrl: z.string().nullable(),
  rating: z.number().nullable(),
  voteCount: z.number().int().nonnegative(),
  genreIds: z.array(z.number().int()),
  popularity: z.number().nullable(),
});

export const movieListQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .max(MAX_QUERY_LENGTH)
    .transform((value) => value.replace(/\s+/g, ' '))
    .optional()
    .transform((value) => (value ? value : null)),

  genres: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [];
      const ids = value
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isInteger(id) && id > 0);
      // Sorted + de-duplicated so the cache key is canonical: "35,28" and
      // "28,35" must be one cache entry on both client and server.
      return [...new Set(ids)].sort((a, b) => a - b).slice(0, MAX_GENRES);
    }),

  sort: z
    .enum(SORT_KEYS as unknown as [string, ...string[]])
    .optional()
    .transform((value) => (value ?? 'popularity') as (typeof SORT_KEYS)[number]),

  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((value) => Math.min(Math.max(value, 1), MAX_PAGE))
    .optional()
    .transform((value) => value ?? 1),

  minRating: z.coerce
    .number()
    .catch(0)
    .transform((value) => Math.min(Math.max(value, 0), 10))
    .optional(),

  year: z.coerce
    .number()
    .int()
    .catch(0)
    .transform((value) => (value >= 1870 && value <= new Date().getFullYear() + 10 ? value : undefined))
    .optional(),
});

export type MovieListQuery = z.output<typeof movieListQuerySchema>;

export const movieIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const wishlistAddSchema = z.object({
  movieId: z.number().int().positive(),
  /** Optional: lets the server snapshot without an upstream call. */
  movie: movieSummarySchema.optional(),
});

export const wishlistMovieIdParamSchema = z.object({
  movieId: z.coerce.number().int().positive(),
});

export const wishlistSyncSchema = z.object({
  ops: z
    .array(
      z.object({
        op: z.enum(['add', 'remove']),
        movieId: z.number().int().positive(),
        movie: movieSummarySchema.optional(),
        at: z.string().datetime().or(z.string().min(1)),
      }),
    )
    .max(200),
});

export const faultSchema = z.object({
  mode: z.enum(['off', 'slow', 'fail', 'rate-limit', 'malformed', 'empty']),
  latencyMs: z.number().int().min(0).max(30_000).optional(),
  failRate: z.number().min(0).max(1).optional(),
});

export const cacheClearSchema = z.object({
  namespace: z.string().min(1).optional(),
});

export const breakerSchema = z.object({
  action: z.enum(['open', 'close']),
});
