import { SORT_KEYS, type SortKey } from '@shared/api-types';
import { router, useLocalSearchParams } from 'expo-router';

import { DEFAULT_SORT, MAX_GENRES, type MovieFilters } from '@/api/query-keys';

type RawParams = { q?: string | string[]; genres?: string | string[]; sort?: string | string[] };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseGenres(value: string | undefined): number[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, MAX_GENRES);
}

function parseSort(value: string | undefined): SortKey {
  return SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : DEFAULT_SORT;
}

/**
 * Discover's filters live in the route's search params, not in a store.
 *
 * Navigation state already survives tab switches and pushing a detail screen,
 * so filters come back with zero extra code; on web the URL becomes
 * deep-linkable and browser back behaves. Params are strings, so this hook
 * owns parsing ("28,35" ↔ [28, 35]) and validation (unknown sorts fall back).
 *
 * Only the *debounced* search text is written here — raw keystrokes stay in
 * local state, or every keypress would churn navigation state.
 */
export function useDiscoverParams() {
  const raw = useLocalSearchParams<RawParams>();

  const filters: MovieFilters = {
    query: first(raw.q) ?? '',
    genres: parseGenres(first(raw.genres)),
    sort: parseSort(first(raw.sort)),
  };

  function setFilters(patch: Partial<MovieFilters>) {
    const next = { ...filters, ...patch };
    router.setParams({
      q: next.query.trim() || undefined,
      genres: next.genres.length ? next.genres.join(',') : undefined,
      sort: next.sort === DEFAULT_SORT ? undefined : next.sort,
    });
  }

  return { filters, setFilters };
}
