import type {
  MovieDetail,
  MovieListResponse,
  MovieSummary,
  ResponseMeta,
} from '@shared/api-types';

import * as queries from '../db/queries';
import { ApiError, notFound } from '../http/errors';
import { logger } from '../logger';
import * as cache from '../resilience/cache';
import { InflightRegistry } from '../resilience/inflight';
import { metrics } from '../resilience/metrics';
import { parseMovieDetail, parseMovieList } from '../tmdb/tmdb-mappers';
import { buildMovieDetailRequest, buildMovieListRequest } from '../tmdb/tmdb-params';
import { tmdbGet } from '../tmdb/tmdb-client';
import { tmdbListEnvelopeSchema } from '../tmdb/tmdb-schemas';
import { MAX_PAGE, type MovieListQuery } from '../validation/request-schemas';
import { baseMeta, withDetailDefaults } from './dto';
import { getGenreMap } from './genres.service';

/**
 * Movie browsing, searching and detail.
 *
 * The caching strategy here is the heart of the assignment's "same information
 * requested repeatedly" and "external service is slow or unavailable"
 * requirements:
 *
 *   fresh  -> serve immediately
 *   stale  -> serve immediately AND revalidate in the background (SWR), so p95
 *             latency stays flat while the data self-heals
 *   miss   -> fetch; on failure serve ANY cached copy, even expired
 *             (stale-if-error), flagged as degraded
 *
 * Only a miss with nothing cached at all can fail.
 */

const LIST_DISCOVER_POLICY: cache.CachePolicy = {
  namespace: 'movies:list:discover',
  freshMs: 5 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
};

/** Searches get a shorter fresh window; the key space is unbounded. */
const LIST_SEARCH_POLICY: cache.CachePolicy = {
  namespace: 'movies:list:search',
  freshMs: 2 * 60 * 1000,
  staleMs: 6 * 60 * 60 * 1000,
};

const DETAIL_POLICY: cache.CachePolicy = {
  namespace: 'movies:detail',
  freshMs: 30 * 60 * 1000,
  staleMs: 7 * 24 * 60 * 60 * 1000,
};

/** Negative caching: stops id-scanning from repeatedly hitting the upstream. */
const DETAIL_404_POLICY: cache.CachePolicy = {
  namespace: 'movies:detail:404',
  freshMs: 5 * 60 * 1000,
  staleMs: 0,
};

type CachedList = {
  items: MovieSummary[];
  page: number;
  nextPage: number | null;
  totalPages: number;
  totalResults: number;
  droppedItems: number;
  filteredOut: number;
};

const listInflight = new InflightRegistry<CachedList>();
const detailInflight = new InflightRegistry<MovieDetail>();

function listCacheKey(query: MovieListQuery): string {
  const isSearch = Boolean(query.query);
  return cache.cacheKey(isSearch ? LIST_SEARCH_POLICY.namespace : LIST_DISCOVER_POLICY.namespace, {
    mode: isSearch ? 'search' : 'discover',
    q: query.query ?? '',
    genres: query.genres,
    sort: query.sort,
    page: query.page,
    minRating: query.minRating ?? '',
    year: query.year ?? '',
  });
}

/**
 * Clamps pagination to what TMDB will actually serve.
 *
 * TMDB caps /discover and /search at page 500 and errors beyond it, while
 * still reporting a much larger `total_pages`. Collapsing all of that into one
 * `nextPage` cursor means the client cannot scroll off the cliff.
 */
function computePagination(
  page: number,
  upstreamTotalPages: number | undefined,
  upstreamTotalResults: number | undefined,
): { nextPage: number | null; totalPages: number; totalResults: number } {
  const rawTotalPages = Number.isFinite(upstreamTotalPages) ? (upstreamTotalPages as number) : 1;
  const totalPages = Math.max(0, Math.min(rawTotalPages, MAX_PAGE));
  const totalResults = Number.isFinite(upstreamTotalResults)
    ? (upstreamTotalResults as number)
    : 0;

  return {
    nextPage: page < totalPages ? page + 1 : null,
    totalPages,
    totalResults,
  };
}

async function fetchList(query: MovieListQuery): Promise<CachedList> {
  const request = buildMovieListRequest(query);
  const raw = await tmdbGet(request.path, request.params);

  const envelope = tmdbListEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new ApiError({
      code: 'UPSTREAM_UNAVAILABLE',
      status: 502,
      message: 'The movie service returned an unreadable response.',
      retryable: true,
    });
  }

  const { items, dropped } = parseMovieList(envelope.data.results);

  // TMDB's search endpoint ignores with_genres, so apply it here as a
  // best-effort page-local filter. Pagination still follows the upstream, so
  // scrolling terminates correctly even though pages may be sparse.
  let filtered = items;
  let filteredOut = 0;
  if (query.query && query.genres.length > 0) {
    filtered = items.filter((item) => item.genreIds.some((id) => query.genres.includes(id)));
    filteredOut = items.length - filtered.length;
  }

  const pagination = computePagination(
    query.page,
    envelope.data.total_pages,
    envelope.data.total_results,
  );

  // Snapshot every movie we serve, so the wishlist and detail screens have
  // local data even if TMDB later goes down.
  void persistSnapshots(filtered);

  return {
    items: filtered,
    page: query.page,
    droppedItems: dropped,
    filteredOut,
    ...pagination,
  };
}

/**
 * Best-effort snapshotting. Never awaited on the response path and never throws:
 * a storage hiccup must not fail a browse request.
 */
async function persistSnapshots(items: MovieSummary[]): Promise<void> {
  if (items.length === 0) return;

  try {
    const genreMap = await getGenreMap();
    const existing = queries.getMovieSnapshots(items.map((item) => item.id));

    for (const item of items) {
      // Don't overwrite a richer detail snapshot with a thinner list one.
      if (existing.get(item.id)?.overview) continue;

      queries.upsertMovie({
        ...item,
        overview: null,
        backdropUrl: null,
        releaseDate: item.releaseYear ? `${item.releaseYear}-01-01` : null,
        runtimeMinutes: null,
        genres: item.genreIds
          .map((id) => ({ id, name: genreMap.get(id) ?? '' }))
          .filter((genre) => genre.name !== ''),
        tagline: null,
        status: null,
        originalLanguage: null,
        tmdbUrl: `https://www.themoviedb.org/movie/${item.id}`,
        cast: [],
        director: null,
        writers: [],
        trailer: null,
      });
    }
  } catch (error) {
    logger.debug('Snapshot persistence skipped', { error: String(error) });
  }
}

export async function getMovieList(
  query: MovieListQuery,
  requestId: string,
): Promise<MovieListResponse> {
  const isSearch = Boolean(query.query);
  const policy = isSearch ? LIST_SEARCH_POLICY : LIST_DISCOVER_POLICY;
  const key = listCacheKey(query);
  const request = buildMovieListRequest(query);

  const metaFor = (
    data: CachedList,
    overrides: Partial<ResponseMeta>,
  ): MovieListResponse => ({
    items: data.items,
    page: data.page,
    nextPage: data.nextPage,
    totalPages: data.totalPages,
    totalResults: data.totalResults,
    meta: baseMeta(requestId, {
      mode: isSearch ? 'search' : 'discover',
      applied: {
        query: query.query,
        genres: query.genres,
        sort: query.sort,
        page: query.page,
      },
      ignored: request.ignored,
      notes: request.notes,
      droppedItems: data.droppedItems,
      filteredOut: data.filteredOut,
      ...overrides,
    }),
  });

  const hit = cache.get<CachedList>(key);

  if (hit.state === 'fresh') {
    return metaFor(hit.value, { source: 'cache' });
  }

  if (hit.state === 'stale') {
    // Stale-while-revalidate: answer now, refresh behind the scenes. Coalesced,
    // so a hundred stale hits trigger one refresh.
    metrics.staleServes += 1;
    void listInflight
      .run(key, () => fetchList(query))
      .then((fresh) => cache.set(key, policy, fresh))
      .catch((error) => logger.debug('Background revalidation failed', { error: String(error) }));

    return metaFor(hit.value, {
      source: 'cache',
      staleAt: new Date(hit.storedAt).toISOString(),
    });
  }

  try {
    const data = await listInflight.run(key, async () => {
      const fresh = await fetchList(query);
      cache.set(key, policy, fresh);
      return fresh;
    });

    return metaFor(data, { source: 'live' });
  } catch (error) {
    // Stale-if-error: any cached copy beats an error screen.
    const expired = cache.get<CachedList>(key, { includeExpired: true });
    if (expired.state !== 'miss') {
      metrics.staleIfErrorServes += 1;
      logger.warn('Serving expired cache after upstream failure', { key });

      return metaFor(expired.value, {
        source: 'stale-cache',
        degraded: true,
        upstreamStatus: upstreamStatusFrom(error),
        staleAt: new Date(expired.storedAt).toISOString(),
        notes: [...request.notes, 'Showing saved results; the movie service is unreachable.'],
      });
    }

    throw error;
  }
}

function upstreamStatusFrom(error: unknown): ResponseMeta['upstreamStatus'] {
  if (error instanceof ApiError) {
    if (error.code === 'UPSTREAM_RATE_LIMITED') return 'rate-limited';
    if (error.code === 'UPSTREAM_MISCONFIGURED') return 'not-configured';
  }
  return 'unavailable';
}

export async function getMovieDetail(
  id: number,
  requestId: string,
): Promise<{ movie: MovieDetail; meta: ResponseMeta }> {
  const key = cache.cacheKey(DETAIL_POLICY.namespace, { id });
  const notFoundKey = cache.cacheKey(DETAIL_404_POLICY.namespace, { id });

  // A known-missing id shouldn't cost an upstream call every time.
  if (cache.get<boolean>(notFoundKey).state === 'fresh') {
    throw notFound(`No movie with id ${id}.`);
  }

  const hit = cache.get<MovieDetail>(key);
  if (hit.state === 'fresh') {
    return { movie: withDetailDefaults(hit.value), meta: baseMeta(requestId, { source: 'cache' }) };
  }

  try {
    const movie = await detailInflight.run(key, async () => {
      const request = buildMovieDetailRequest(id);
      const raw = await tmdbGet(request.path, request.params);

      const genreMap = await getGenreMap();
      const parsed = parseMovieDetail(raw, genreMap);

      if (!parsed) {
        throw new ApiError({
          code: 'UPSTREAM_UNAVAILABLE',
          status: 502,
          message: 'The movie service returned unreadable details.',
          retryable: true,
        });
      }

      cache.set(key, DETAIL_POLICY, parsed);
      // The richest snapshot we will ever have for this movie.
      queries.upsertMovie(parsed);
      return parsed;
    });

    return { movie, meta: baseMeta(requestId, { source: 'live' }) };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      cache.set(notFoundKey, DETAIL_404_POLICY, true);
      throw error;
    }

    // Prefer an expired cache entry, then the DB snapshot. The snapshot is why
    // opening a wishlisted movie works with the upstream completely down.
    const expired = cache.get<MovieDetail>(key, { includeExpired: true });
    if (expired.state !== 'miss') {
      metrics.staleIfErrorServes += 1;
      return {
        movie: withDetailDefaults(expired.value),
        meta: baseMeta(requestId, {
          source: 'stale-cache',
          degraded: true,
          upstreamStatus: upstreamStatusFrom(error),
          staleAt: new Date(expired.storedAt).toISOString(),
          notes: ['Showing saved details; the movie service is unreachable.'],
        }),
      };
    }

    const snapshot = queries.getMovieSnapshot(id);
    if (snapshot) {
      return {
        movie: withDetailDefaults(snapshot),
        meta: baseMeta(requestId, {
          source: 'stale-cache',
          degraded: true,
          upstreamStatus: upstreamStatusFrom(error),
          notes: ['Showing saved details; the movie service is unreachable.'],
        }),
      };
    }

    throw error;
  }
}

/**
 * Used by the wishlist service to snapshot a movie posted by id alone.
 * Returns null rather than throwing: failing to enrich must never fail the save.
 */
export async function resolveDetailForSnapshot(id: number): Promise<MovieDetail | null> {
  try {
    const { movie } = await getMovieDetail(id, 'wishlist-snapshot');
    return movie;
  } catch {
    return null;
  }
}
