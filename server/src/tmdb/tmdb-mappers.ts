import type { Genre, MovieDetail, MovieSummary } from '@shared/api-types';

import { TMDB_WEB_BASE } from '../services/dto';
import {
  tmdbGenreSchema,
  tmdbMovieDetailSchema,
  tmdbMovieItemSchema,
  type TmdbMovieDetail,
  type TmdbMovieItem,
} from './tmdb-schemas';

/**
 * Normalisation: TMDB's shapes -> our DTO.
 *
 * This is the layer the assignment's "the external API may not be in the format
 * your application needs" is really about. Every rule here exists because the
 * raw value would otherwise produce a visibly broken UI: a "0.0" rating badge,
 * a broken image icon, an "Invalid Date", or a blank card title.
 *
 * Each branch has a matching case in __tests__/mappers.test.ts.
 */

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/** Sizes are a server concern, so changing them never requires an app release. */
export const IMAGE_SIZES = {
  poster: 'w342',
  posterSmall: 'w185',
  backdrop: 'w780',
} as const;

/**
 * TMDB paths always begin with "/". Anything else (an empty string, a bare
 * filename, a full URL) is upstream junk and becomes `null`, which the client
 * renders as a themed placeholder rather than a broken image.
 */
export function imageUrl(path: string | null | undefined, size: string): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (trimmed === '' || !trimmed.startsWith('/')) return null;
  return `${IMAGE_BASE}/${size}${trimmed}`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_FILM_YEAR = 1870; // predates the first films; rejects '0000-00-00'

/** Validates shape *and* plausibility, so '0000-00-00' and '9999-99-99' both fail. */
export function parseReleaseDate(raw: string | null | undefined): {
  date: string | null;
  year: number | null;
} {
  if (typeof raw !== 'string') return { date: null, year: null };

  const match = DATE_PATTERN.exec(raw.trim());
  if (!match) return { date: null, year: null };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxYear = new Date().getFullYear() + 10;

  if (year < MIN_FILM_YEAR || year > maxYear) return { date: null, year: null };
  if (month < 1 || month > 12 || day < 1 || day > 31) return { date: null, year };

  return { date: raw.trim(), year };
}

/**
 * A rating is meaningless without votes.
 *
 * TMDB returns `vote_average: 0` for unrated films, and rendering "0.0" reads
 * as "terrible" rather than "unknown" — so zero votes yields `null` and the UI
 * hides the badge entirely. Out-of-range values are clamped rather than
 * dropped, since the intent is still legible.
 */
export function normalizeRating(
  voteAverage: number | undefined,
  voteCount: number,
): number | null {
  if (voteCount <= 0) return null;
  if (typeof voteAverage !== 'number' || !Number.isFinite(voteAverage)) return null;

  const clamped = Math.min(Math.max(voteAverage, 0), 10);
  return Math.round(clamped * 10) / 10;
}

/** A card with no title is useless, so fall back before ever showing blank. */
export function normalizeTitle(
  title: string | undefined,
  originalTitle: string | undefined,
): string {
  const primary = title?.trim();
  if (primary) return primary;

  const fallback = originalTitle?.trim();
  if (fallback) return fallback;

  return 'Untitled';
}

/** Empty or whitespace-only text becomes `null` so the UI can say "none". */
export function normalizeText(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function toMovieSummary(item: TmdbMovieItem): MovieSummary {
  const voteCount = Math.max(0, item.vote_count ?? 0);
  const { year } = parseReleaseDate(item.release_date);

  return {
    id: item.id,
    title: normalizeTitle(item.title, item.original_title),
    releaseYear: year,
    posterUrl: imageUrl(item.poster_path, IMAGE_SIZES.poster),
    rating: normalizeRating(item.vote_average, voteCount),
    voteCount,
    genreIds: item.genre_ids ?? [],
    popularity: typeof item.popularity === 'number' ? item.popularity : null,
  };
}

/** Keeps only complete `{id, name}` pairs; partial entries are simply absent. */
function normalizeGenres(raw: unknown[] | undefined): Genre[] {
  const resolved: Genre[] = [];

  for (const entry of raw ?? []) {
    const parsed = tmdbGenreSchema.safeParse(entry);
    if (parsed.success) resolved.push({ id: parsed.data.id, name: parsed.data.name });
  }

  return resolved;
}

/**
 * Resolves genre ids through our cached genre list.
 *
 * Needed because TMDB's list endpoints return `genre_ids` while the detail
 * endpoint returns full `genres`. Mapping ids lets a movie built from a list
 * item still show genre names.
 */
export function resolveGenreIds(ids: number[], genreMap: Map<number, string>): Genre[] {
  const resolved: Genre[] = [];
  for (const id of ids) {
    const name = genreMap.get(id);
    if (name) resolved.push({ id, name });
  }
  return resolved;
}

export function toMovieDetail(
  item: TmdbMovieDetail,
  genreMap: Map<number, string> = new Map(),
): MovieDetail {
  const summary = toMovieSummary(item);
  const { date } = parseReleaseDate(item.release_date);

  const fromDetail = normalizeGenres(item.genres);
  // Detail genres are authoritative; fall back to mapping the list-style ids.
  const genres = fromDetail.length > 0 ? fromDetail : resolveGenreIds(summary.genreIds, genreMap);

  // Keep genreIds consistent with whichever genre source won, so the client
  // never sees names and ids disagreeing.
  const genreIds = summary.genreIds.length > 0 ? summary.genreIds : genres.map((genre) => genre.id);

  const runtime = item.runtime;

  return {
    ...summary,
    genreIds,
    overview: normalizeText(item.overview),
    backdropUrl: imageUrl(item.backdrop_path, IMAGE_SIZES.backdrop),
    releaseDate: date,
    // TMDB uses 0 for "unknown runtime", which would render as "0 min".
    runtimeMinutes: typeof runtime === 'number' && runtime > 0 ? runtime : null,
    genres,
    tagline: normalizeText(item.tagline),
    status: normalizeText(item.status),
    originalLanguage: normalizeText(item.original_language),
    tmdbUrl: `${TMDB_WEB_BASE}/${summary.id}`,
  };
}

export type ParsedList = {
  items: MovieSummary[];
  /** Items rejected by per-item validation, surfaced as meta.droppedItems. */
  dropped: number;
};

/**
 * Parses a results array item by item.
 *
 * The whole point: a single unusable row costs one card, not the page. Also
 * de-duplicates by id, because TMDB repeats items across page boundaries when
 * the underlying ordering shifts between requests — which would otherwise
 * trigger React key warnings and duplicate cards in an infinite list.
 */
export function parseMovieList(results: unknown[]): ParsedList {
  const items: MovieSummary[] = [];
  const seen = new Set<number>();
  let dropped = 0;

  for (const raw of results) {
    const parsed = tmdbMovieItemSchema.safeParse(raw);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }

    if (seen.has(parsed.data.id)) {
      dropped += 1;
      continue;
    }

    seen.add(parsed.data.id);
    items.push(toMovieSummary(parsed.data));
  }

  return { items, dropped };
}

export function parseMovieDetail(
  raw: unknown,
  genreMap?: Map<number, string>,
): MovieDetail | null {
  const parsed = tmdbMovieDetailSchema.safeParse(raw);
  if (!parsed.success) return null;
  return toMovieDetail(parsed.data, genreMap);
}
