import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MovieSummary } from '@shared/api-types';

import { fetchGenres, fetchMovieList } from '@/api/movies';
import { genreKeys, movieKeys, type MovieFilters } from '@/api/query-keys';

/**
 * Infinite movie list for one filter combination.
 *
 * Superseded requests are cancelled for free: when the key changes, the old
 * query loses its last observer and React Query aborts its `signal`, which
 * reaches `fetch`. Correctness under races comes from keying, not ordering —
 * a late response lands in its own cache entry and can never overwrite the
 * list currently on screen.
 */
export function useMoviesQuery(filters: MovieFilters) {
  const query = useInfiniteQuery({
    queryKey: movieKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchMovieList(filters, pageParam, signal),
    initialPageParam: 1,
    // The server owns "is there more?" (including TMDB's 500-page ceiling).
    getNextPageParam: (lastPage) => lastPage.nextPage,
    // Keep the old grid on screen while a new sort/genre loads, instead of
    // flashing a skeleton.
    placeholderData: keepPreviousData,
  });

  const pages = query.data?.pages ?? [];

  // TMDB repeats items near page boundaries; the server de-dupes within a
  // page, and this de-dupes across pages so FlashList keys stay unique.
  const seen = new Set<number>();
  const items: MovieSummary[] = [];
  for (const page of pages) {
    for (const movie of page.items) {
      if (!seen.has(movie.id)) {
        seen.add(movie.id);
        items.push(movie);
      }
    }
  }

  return {
    ...query,
    items,
    firstPage: pages[0] ?? null,
    meta: pages.at(-1)?.meta ?? null,
  };
}

export function useGenresQuery() {
  return useQuery({
    queryKey: genreKeys.all,
    queryFn: ({ signal }) => fetchGenres(signal),
    staleTime: 24 * 60 * 60_000,
    select: (response) => response.items,
  });
}
