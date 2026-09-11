import {
  queryOptions,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type { MovieListResponse, MovieSummary } from '@shared/api-types';
import { useMemo } from 'react';

import { fetchMovieDetail } from '@/api/movies';
import { movieKeys } from '@/api/query-keys';

/** Matches the server's 30 min fresh window closely enough without outliving it. */
const DETAIL_STALE_MS = 5 * 60_000;

function detailQuery(id: number) {
  return queryOptions({
    queryKey: movieKeys.detail(id),
    queryFn: ({ signal }) => fetchMovieDetail(id, signal),
    staleTime: DETAIL_STALE_MS,
  });
}

/** Route params are untrusted strings: "abc", "-1" and "1e3" all mean "no such movie". */
export function parseMovieId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,9}$/.test(value)) return null;
  const id = Number(value);
  return id > 0 ? id : null;
}

/**
 * Called on `onPressIn`, so the request is already in flight during the
 * ~100 ms between touch-down and the push. A no-op while the entry is fresh.
 */
export function prefetchMovieDetail(client: QueryClient, id: number) {
  void client.prefetchQuery(detailQuery(id));
}

/** Finds a movie in any loaded Discover list, whatever its filters. */
function findCachedSummary(client: QueryClient, id: number): MovieSummary | null {
  const lists = client.getQueriesData<InfiniteData<MovieListResponse>>({
    queryKey: movieKeys.lists(),
  });
  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      const hit = page.items.find((movie) => movie.id === id);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The detail query plus the grid's copy of the same movie.
 *
 * `summary` is what makes the screen instant: title, poster, year and rating
 * are already in the list cache, so they render on the same frame the push
 * starts, and only overview/runtime/genres wait for the network. It is kept
 * separate from `placeholderData` on purpose — a summary is not a detail, and
 * pretending otherwise would mean faking `overview: null` ("no overview")
 * where the truth is "not loaded yet".
 */
export function useMovieDetail(id: number | null) {
  const client = useQueryClient();
  const query = useQuery({ ...detailQuery(id ?? 0), enabled: id !== null });
  const summary = useMemo(() => (id === null ? null : findCachedSummary(client, id)), [client, id]);

  return {
    query,
    movie: query.data?.movie ?? null,
    meta: query.data?.meta ?? null,
    summary,
  };
}
