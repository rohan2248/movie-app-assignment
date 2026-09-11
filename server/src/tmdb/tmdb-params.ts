import type { SortKey } from '@shared/api-types';

import type { MovieListQuery } from '../validation/request-schemas';

/**
 * Translates our query contract into TMDB's.
 *
 * This is where the backend earns its place as more than a proxy. Two of these
 * mappings add constraints TMDB does not apply itself, because the raw result
 * would be poor enough to look like a bug in our app.
 */

/** Below this, `vote_average.desc` surfaces 10/10 films with a handful of votes. */
const MIN_VOTES_FOR_RATING_SORT = 200;

const SORT_MAP: Record<SortKey, string> = {
  popularity: 'popularity.desc',
  rating: 'vote_average.desc',
  release_date: 'primary_release_date.desc',
  title: 'title.asc',
  revenue: 'revenue.desc',
};

const today = () => new Date().toISOString().slice(0, 10);

export type TmdbRequest = {
  path: string;
  params: Record<string, string>;
};

/**
 * TMDB's /search/movie supports neither sorting nor genre filtering, so the
 * caller must know which of the user's choices could not be honoured. Reporting
 * it (rather than silently ignoring it) is what lets the UI disable the sort
 * control with an explanation instead of appearing broken.
 */
export type BuiltRequest = TmdbRequest & {
  ignored: ('sort' | 'genres')[];
  notes: string[];
};

export function buildMovieListRequest(query: MovieListQuery): BuiltRequest {
  const isSearch = Boolean(query.query);

  const params: Record<string, string> = {
    include_adult: 'false',
    language: 'en-US',
    page: String(query.page),
  };

  if (isSearch) {
    params.query = query.query!;

    const ignored: ('sort' | 'genres')[] = [];
    const notes: string[] = [];

    // Only report a filter as ignored if the user actually set one.
    if (query.sort && query.sort !== 'popularity') {
      ignored.push('sort');
      notes.push('Sorting applies while browsing, not while searching.');
    }
    if (query.genres.length > 0) {
      // Applied as a best-effort page-local filter by the caller instead.
      notes.push('Genre filtering is applied to search results where possible.');
    }
    if (query.year) params.primary_release_year = String(query.year);

    return { path: '/search/movie', params, ignored, notes };
  }

  params.sort_by = SORT_MAP[query.sort];

  if (query.genres.length > 0) {
    // '|' is OR, ',' is AND. OR matches how additive chips read to a user:
    // picking Action and Comedy should widen the results, not narrow them to
    // films that are both. Documented in the README as an assumption.
    params.with_genres = query.genres.join('|');
  }

  if (query.sort === 'rating') {
    params['vote_count.gte'] = String(MIN_VOTES_FOR_RATING_SORT);
  }

  if (query.sort === 'release_date') {
    // Without this, "Newest" is dominated by unreleased placeholder entries
    // with no poster and no rating.
    params['primary_release_date.lte'] = today();
  }

  if (query.minRating !== undefined && query.minRating > 0) {
    params['vote_average.gte'] = String(query.minRating);
    // A minimum rating is meaningless without a vote floor, for the same
    // reason as the rating sort above.
    params['vote_count.gte'] = String(
      Math.max(Number(params['vote_count.gte'] ?? 0), MIN_VOTES_FOR_RATING_SORT),
    );
  }

  if (query.year) params.primary_release_year = String(query.year);

  return { path: '/discover/movie', params, ignored: [], notes: [] };
}

export function buildMovieDetailRequest(id: number): TmdbRequest {
  return {
    path: `/movie/${id}`,
    params: { language: 'en-US' },
  };
}

export function buildGenreListRequest(): TmdbRequest {
  return { path: '/genre/movie/list', params: { language: 'en-US' } };
}
