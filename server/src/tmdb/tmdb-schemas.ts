import { z } from 'zod';

/**
 * Schemas for TMDB's responses.
 *
 * The governing principle is **be maximally forgiving of the upstream**, then
 * normalise into our own strict DTO. Two rules follow:
 *
 * 1. *Only `id` is genuinely required.* Everything else is optional and
 *    nullable, and the objects are loose, so a field TMDB adds or stops
 *    sending can never break a response.
 * 2. *The envelope is parsed separately from the items.* Each result element is
 *    validated on its own, so one malformed row is dropped and counted rather
 *    than blanking an entire page.
 *
 * This is why `strict: true` in the DTO is safe: everything uncertain is
 * squeezed out here.
 */

/** A number that may arrive as a numeric string, or as junk we should ignore. */
const looseNumber = z.preprocess((value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}, z.number().optional());

const looseInt = z.preprocess((value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}, z.number().int().optional());

const looseString = z.preprocess(
  (value) => (typeof value === 'string' ? value : undefined),
  z.string().optional(),
);

/** Tolerates `null`, a non-array, or an array with non-numeric members. */
const looseIntArray = z.preprocess((value) => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry));
}, z.array(z.number().int()));

/**
 * The one hard requirement. Without a stable id we cannot key, cache, wishlist
 * or de-duplicate an item, so an item lacking one is genuinely unusable.
 */
const requiredId = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}, z.number().int().positive());

export const tmdbMovieItemSchema = z.looseObject({
  id: requiredId,
  title: looseString,
  original_title: looseString,
  overview: looseString,
  poster_path: looseString.nullable().optional(),
  backdrop_path: looseString.nullable().optional(),
  release_date: looseString,
  vote_average: looseNumber,
  vote_count: looseInt,
  genre_ids: looseIntArray.optional(),
  popularity: looseNumber,
  original_language: looseString,
});

export type TmdbMovieItem = z.output<typeof tmdbMovieItemSchema>;

export const tmdbGenreSchema = z.looseObject({
  id: requiredId,
  name: z.string().trim().min(1),
});

/** One cast entry from `append_to_response=credits`. Order drives "top billed". */
export const tmdbCastMemberSchema = z.looseObject({
  id: requiredId,
  name: z.string().trim().min(1),
  character: looseString.nullable().optional(),
  profile_path: looseString.nullable().optional(),
  order: looseInt,
});

/** One crew entry. `job` is how a director/writer is identified. */
export const tmdbCrewMemberSchema = z.looseObject({
  id: requiredId,
  name: z.string().trim().min(1),
  job: looseString,
  department: looseString,
});

export const tmdbCreditsSchema = z.looseObject({
  cast: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())).optional(),
  crew: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())).optional(),
});

/** One video entry from `append_to_response=videos`. Only YouTube trailers are used. */
export const tmdbVideoSchema = z.looseObject({
  key: z.string().trim().min(1),
  site: looseString,
  type: looseString,
  name: looseString,
  official: z.boolean().optional(),
});

export const tmdbVideosSchema = z.looseObject({
  results: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())).optional(),
});

export const tmdbMovieDetailSchema = tmdbMovieItemSchema.extend({
  runtime: looseInt.nullable().optional(),
  tagline: looseString,
  status: looseString,
  // Partial entries are filtered out in the mapper rather than rejected here.
  genres: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())).optional(),
  credits: tmdbCreditsSchema.optional(),
  videos: tmdbVideosSchema.optional(),
});

export type TmdbMovieDetail = z.output<typeof tmdbMovieDetailSchema>;

/**
 * The list envelope. `results` is intentionally `unknown[]`: items are parsed
 * individually by the caller so failures can be counted and survived.
 */
export const tmdbListEnvelopeSchema = z.looseObject({
  page: looseInt.optional(),
  results: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())),
  total_pages: looseInt.optional(),
  total_results: looseInt.optional(),
});

export type TmdbListEnvelope = z.output<typeof tmdbListEnvelopeSchema>;

export const tmdbGenreListSchema = z.looseObject({
  genres: z.preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown())),
});

/** TMDB's own error envelope, used to produce a better message than "503". */
export const tmdbErrorSchema = z.looseObject({
  status_message: looseString,
  status_code: looseInt.optional(),
  success: z.boolean().optional(),
});
