import type { SortKey } from '@shared/api-types';

export type MovieFilters = {
  query: string;
  genres: number[];
  sort: SortKey;
};

export const DEFAULT_SORT: SortKey = 'popularity';
export const MAX_GENRES = 5;

/**
 * Canonicalized inside the key factory, mirroring the server's cache key, so
 * the two layers agree on what "the same request" means: `Action+Comedy` and
 * `Comedy+Action` are one entry, and so are "  Dune " and "dune".
 */
export function normalizeFilters(filters: MovieFilters): MovieFilters {
  return {
    query: filters.query.trim().replace(/\s+/g, ' ').toLowerCase(),
    genres: [...new Set(filters.genres)].sort((a, b) => a - b).slice(0, MAX_GENRES),
    sort: filters.sort,
  };
}

export const movieKeys = {
  all: ['movies'] as const,
  lists: () => [...movieKeys.all, 'list'] as const,
  list: (filters: MovieFilters) => [...movieKeys.lists(), normalizeFilters(filters)] as const,
  detail: (id: number) => [...movieKeys.all, 'detail', id] as const,
};

export const genreKeys = {
  all: ['genres'] as const,
};

/**
 * Keyed by device id, so a regenerated identity starts from an empty list
 * rather than inheriting the previous one's cache entry.
 */
export const wishlistKeys = {
  all: ['wishlist'] as const,
  list: (deviceId: string) => [...wishlistKeys.all, deviceId] as const,
};
