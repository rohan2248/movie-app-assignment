import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MovieDetail } from '@shared/api-types';

import { withDetailDefaults } from '../services/dto';

/**
 * `withDetailDefaults` exists because the cache (7-day stale window) and the
 * `movies` DB snapshot can both outlive a deploy, so a value written before a
 * field like `cast` existed can come back with that key genuinely absent —
 * not `null` — despite the shared contract's "every field is always present"
 * rule. This reproduces exactly that: a legacy object cast to `MovieDetail`
 * (as `cache.get<MovieDetail>` and `getMovieSnapshot` do) with the new keys
 * missing entirely.
 */
describe('withDetailDefaults', () => {
  it('backfills fields absent from a pre-cast/crew/trailer cached value', () => {
    const legacy = {
      id: 1,
      title: 'Old Cache Entry',
      releaseYear: 1999,
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
      tmdbUrl: 'https://www.themoviedb.org/movie/1',
      // cast, director, writers, trailer deliberately absent
    } as unknown as MovieDetail;

    const result = withDetailDefaults(legacy);
    assert.deepEqual(result.cast, []);
    assert.equal(result.director, null);
    assert.deepEqual(result.writers, []);
    assert.equal(result.trailer, null);
  });

  it('leaves a fully-shaped value untouched', () => {
    const full: MovieDetail = {
      id: 1,
      title: 'Fresh',
      releaseYear: 2020,
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
      tmdbUrl: 'https://www.themoviedb.org/movie/1',
      cast: [{ id: 5, name: 'Actor', character: 'Role', profileUrl: null }],
      director: 'A Director',
      writers: ['A Writer'],
      trailer: { key: 'abc', name: 'Trailer' },
    };

    assert.deepEqual(withDetailDefaults(full), full);
  });
});
