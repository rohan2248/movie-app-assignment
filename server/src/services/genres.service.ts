import type { Genre } from '@shared/api-types';

import * as queries from '../db/queries';
import { logger } from '../logger';
import * as cache from '../resilience/cache';
import { InflightRegistry } from '../resilience/inflight';
import { tmdbGenreSchema, tmdbGenreListSchema } from '../tmdb/tmdb-schemas';
import { buildGenreListRequest } from '../tmdb/tmdb-params';
import { tmdbGet } from '../tmdb/tmdb-client';

/**
 * The genre list: effectively static, and needed to render the browse filters.
 *
 * It gets three layers of fallback because a failure here would break
 * *discovery itself*, which is the app's primary surface — much worse than a
 * single failed movie page:
 *   1. cache (24h fresh / 30d stale)
 *   2. the SQLite `genres` table, populated on every successful fetch
 *   3. a hardcoded list
 *
 * So the filter chips render even on a first run with no API key at all.
 */

const POLICY: cache.CachePolicy = {
  namespace: 'genres',
  freshMs: 24 * 60 * 60 * 1000,
  staleMs: 30 * 24 * 60 * 60 * 1000,
};

const inflight = new InflightRegistry<Genre[]>();

/**
 * TMDB's movie genre list, current as of writing. Last-resort fallback only.
 * Stale names are a cosmetic problem; an empty filter bar is a broken feature.
 */
const FALLBACK_GENRES: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' },
];

export type GenreResult = {
  items: Genre[];
  source: 'live' | 'cache' | 'stale-cache';
  degraded: boolean;
};

function parseGenres(raw: unknown): Genre[] {
  const envelope = tmdbGenreListSchema.safeParse(raw);
  if (!envelope.success) return [];

  const genres: Genre[] = [];
  for (const entry of envelope.data.genres) {
    const parsed = tmdbGenreSchema.safeParse(entry);
    if (parsed.success) genres.push({ id: parsed.data.id, name: parsed.data.name });
  }
  return genres;
}

export async function getGenres(): Promise<GenreResult> {
  const key = cache.cacheKey(POLICY.namespace, { v: 1 });

  const hit = cache.get<Genre[]>(key);
  if (hit.state === 'fresh') {
    return { items: hit.value, source: 'cache', degraded: false };
  }

  try {
    const items = await inflight.run(key, async () => {
      const request = buildGenreListRequest();
      const raw = await tmdbGet(request.path, request.params);
      const parsed = parseGenres(raw);

      if (parsed.length === 0) throw new Error('Upstream returned no usable genres');

      cache.set(key, POLICY, parsed);
      // Mirror into SQLite so genre *names* can be resolved for movie details
      // later without another upstream call.
      queries.replaceGenres(parsed);
      return parsed;
    });

    return { items, source: 'live', degraded: false };
  } catch (error) {
    logger.warn('Genre fetch failed; falling back', { error: String(error) });

    // Any cached copy, however old.
    const stale = cache.get<Genre[]>(key, { includeExpired: true });
    if (stale.state !== 'miss' && stale.value.length > 0) {
      return { items: stale.value, source: 'stale-cache', degraded: true };
    }

    const persisted = queries.listGenres();
    if (persisted.length > 0) {
      return { items: persisted, source: 'stale-cache', degraded: true };
    }

    return { items: FALLBACK_GENRES, source: 'stale-cache', degraded: true };
  }
}

/** Genre id -> name, for resolving names on movie details. */
export async function getGenreMap(): Promise<Map<number, string>> {
  try {
    const { items } = await getGenres();
    return new Map(items.map((genre) => [genre.id, genre.name]));
  } catch {
    return new Map(FALLBACK_GENRES.map((genre) => [genre.id, genre.name]));
  }
}

export { FALLBACK_GENRES };
