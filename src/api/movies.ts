import type {
  GenreListResponse,
  MovieDetailResponse,
  MovieListResponse,
} from '@shared/api-types';

import { apiFetch } from '@/api/client';
import { DEFAULT_SORT, normalizeFilters, type MovieFilters } from '@/api/query-keys';

export function fetchMovieList(filters: MovieFilters, page: number, signal?: AbortSignal) {
  const { query, genres, sort } = normalizeFilters(filters);
  return apiFetch<MovieListResponse>('/api/movies', {
    signal,
    query: {
      query: query || undefined,
      genres: genres.length ? genres.join(',') : undefined,
      sort: sort === DEFAULT_SORT ? undefined : sort,
      page,
    },
  });
}

export function fetchMovieDetail(id: number, signal?: AbortSignal) {
  return apiFetch<MovieDetailResponse>(`/api/movies/${id}`, { signal });
}

export function fetchGenres(signal?: AbortSignal) {
  return apiFetch<GenreListResponse>('/api/genres', { signal });
}
