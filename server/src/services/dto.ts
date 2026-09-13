import type {
  MovieDetail,
  MovieSummary,
  ResponseMeta,
  SortKey,
} from '@shared/api-types';

/** Helpers for moving between the two shapes of the movie DTO. */

export const TMDB_WEB_BASE = 'https://www.themoviedb.org/movie';

export function toMovieSummary(movie: MovieDetail | MovieSummary): MovieSummary {
  return {
    id: movie.id,
    title: movie.title,
    releaseYear: movie.releaseYear,
    posterUrl: movie.posterUrl,
    rating: movie.rating,
    voteCount: movie.voteCount,
    genreIds: movie.genreIds,
    popularity: movie.popularity,
  };
}

/**
 * Widens a summary into a storable detail.
 *
 * Needed because the client may post the summary it already has when
 * wishlisting, which lets us persist a renderable snapshot without an upstream
 * round-trip. The detail-only fields are honestly `null` rather than invented;
 * a later detail fetch upserts over this row and fills them in.
 */
export function summaryToDetail(summary: MovieSummary): MovieDetail {
  return {
    ...summary,
    overview: null,
    backdropUrl: null,
    releaseDate: summary.releaseYear ? `${summary.releaseYear}-01-01` : null,
    runtimeMinutes: null,
    genres: [],
    tagline: null,
    status: null,
    originalLanguage: null,
    tmdbUrl: `${TMDB_WEB_BASE}/${summary.id}`,
    cast: [],
    director: null,
    writers: [],
    trailer: null,
  };
}

/**
 * Backfills detail-only fields that didn't exist yet when a value was written.
 *
 * The cache (L1 memory + L2 SQLite) and the `movies` snapshot table can both
 * outlive a deploy — 7-day stale windows and indefinite DB rows are the whole
 * point of the resilience design. Without this, a `MovieDetail` written before
 * a field like `cast` existed would come back with that key simply absent
 * (not `null`) despite the shared contract's "every field is always present"
 * rule, and crash the client. New optional-looking fields must be added here
 * too, alongside the type.
 */
export function withDetailDefaults(movie: MovieDetail): MovieDetail {
  return {
    ...movie,
    cast: movie.cast ?? [],
    director: movie.director ?? null,
    writers: movie.writers ?? [],
    trailer: movie.trailer ?? null,
  };
}

/**
 * Last-resort snapshot, used only when a movie is wishlisted by id alone while
 * TMDB is unreachable and we have never seen it. Storing this beats rejecting
 * the write: the user's intent is preserved and the row self-heals on the next
 * successful detail fetch.
 */
export function placeholderDetail(id: number): MovieDetail {
  return {
    id,
    title: 'Untitled',
    releaseYear: null,
    posterUrl: null,
    rating: null,
    voteCount: 0,
    genreIds: [],
    popularity: null,
    overview: null,
    backdropUrl: null,
    releaseDate: null,
    runtimeMinutes: null,
    genres: [],
    tagline: null,
    status: null,
    originalLanguage: null,
    tmdbUrl: `${TMDB_WEB_BASE}/${id}`,
    cast: [],
    director: null,
    writers: [],
    trailer: null,
  };
}

/**
 * Base response metadata. Endpoints override only the fields they can speak to,
 * so every response carries the same shape and the client never branches on
 * whether `meta` happens to be present.
 */
export function baseMeta(
  requestId: string,
  overrides: Partial<ResponseMeta> = {},
): ResponseMeta {
  return {
    mode: 'discover',
    applied: { query: null, genres: [], sort: 'popularity' as SortKey, page: 1 },
    ignored: [],
    notes: [],
    source: 'live',
    degraded: false,
    upstreamStatus: 'ok',
    staleAt: null,
    droppedItems: 0,
    filteredOut: 0,
    requestId,
    ...overrides,
  };
}
