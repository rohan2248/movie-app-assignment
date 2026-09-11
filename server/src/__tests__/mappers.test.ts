import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  imageUrl,
  normalizeRating,
  normalizeText,
  normalizeTitle,
  parseMovieDetail,
  parseMovieList,
  parseReleaseDate,
} from '../tmdb/tmdb-mappers';

/**
 * One test per normalisation rule.
 *
 * These are the assignment's "external service returns incomplete or
 * unexpected information" requirement expressed as assertions: every case here
 * is a real shape TMDB returns that would produce a visibly broken UI if passed
 * through unchanged.
 */

describe('titles', () => {
  it('falls back to the original title when the title is blank', () => {
    assert.equal(normalizeTitle('   ', 'Le Fabuleux Destin'), 'Le Fabuleux Destin');
  });

  it('never returns an empty string', () => {
    assert.equal(normalizeTitle(undefined, undefined), 'Untitled');
    assert.equal(normalizeTitle('', ''), 'Untitled');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizeTitle('  Alien  ', undefined), 'Alien');
  });
});

describe('poster paths', () => {
  it('builds an absolute, pre-sized URL', () => {
    assert.equal(
      imageUrl('/abc.jpg', 'w342'),
      'https://image.tmdb.org/t/p/w342/abc.jpg',
    );
  });

  it('returns null for missing or malformed paths so the UI shows a placeholder', () => {
    // Each of these has been observed from the upstream at some point.
    assert.equal(imageUrl(null, 'w342'), null);
    assert.equal(imageUrl(undefined, 'w342'), null);
    assert.equal(imageUrl('', 'w342'), null);
    assert.equal(imageUrl('   ', 'w342'), null);
    // No leading slash: concatenating would yield a wrong URL, not a 404.
    assert.equal(imageUrl('no-slash.jpg', 'w342'), null);
  });
});

describe('release dates', () => {
  it('accepts a well-formed date', () => {
    assert.deepEqual(parseReleaseDate('1999-10-15'), { date: '1999-10-15', year: 1999 });
  });

  it('rejects the empty and zero dates TMDB actually returns', () => {
    assert.deepEqual(parseReleaseDate(''), { date: null, year: null });
    assert.deepEqual(parseReleaseDate('0000-00-00'), { date: null, year: null });
    assert.deepEqual(parseReleaseDate('not-a-date'), { date: null, year: null });
    assert.deepEqual(parseReleaseDate(undefined), { date: null, year: null });
  });

  it('rejects implausible years rather than rendering them', () => {
    assert.deepEqual(parseReleaseDate('1600-01-01'), { date: null, year: null });
    assert.deepEqual(parseReleaseDate('9999-01-01'), { date: null, year: null });
  });

  it('keeps the year but drops an impossible month/day', () => {
    assert.deepEqual(parseReleaseDate('2001-13-45'), { date: null, year: 2001 });
  });
});

describe('ratings', () => {
  it('is null with zero votes, so the badge is hidden rather than showing 0.0', () => {
    // The single most common source of a misleading UI: TMDB returns
    // vote_average 0 for unrated films, which reads as "terrible".
    assert.equal(normalizeRating(0, 0), null);
    assert.equal(normalizeRating(7.5, 0), null);
  });

  it('rounds to one decimal place', () => {
    assert.equal(normalizeRating(7.25, 100), 7.3);
    assert.equal(normalizeRating(8.44, 100), 8.4);
  });

  it('clamps out-of-range values instead of dropping them', () => {
    assert.equal(normalizeRating(11.4, 10), 10);
    assert.equal(normalizeRating(-3, 10), 0);
  });

  it('is null when the value is absent or not finite', () => {
    assert.equal(normalizeRating(undefined, 10), null);
    assert.equal(normalizeRating(Number.NaN, 10), null);
  });
});

describe('text fields', () => {
  it('maps empty and whitespace-only text to null', () => {
    assert.equal(normalizeText(''), null);
    assert.equal(normalizeText('    '), null);
    assert.equal(normalizeText(null), null);
    assert.equal(normalizeText(undefined), null);
    assert.equal(normalizeText(' hello '), 'hello');
  });
});

describe('parseMovieList', () => {
  it('drops unusable items and keeps the rest of the page', () => {
    // The core guarantee: one bad row costs one card, not the whole page.
    const { items, dropped } = parseMovieList([
      {},
      { id: 'not-a-number', title: 'Bad id' },
      { id: 1, title: 'Good One', vote_count: 10, vote_average: 7 },
      { id: 2, title: 'Good Two', vote_count: 20, vote_average: 8 },
    ]);

    assert.equal(items.length, 2);
    assert.equal(dropped, 2);
    assert.deepEqual(
      items.map((item) => item.id),
      [1, 2],
    );
  });

  it('de-duplicates ids repeated across a page boundary', () => {
    const { items, dropped } = parseMovieList([
      { id: 5, title: 'Dup' },
      { id: 5, title: 'Dup again' },
    ]);

    assert.equal(items.length, 1);
    assert.equal(dropped, 1);
  });

  it('survives a page where every field but id is hostile', () => {
    const { items } = parseMovieList([
      {
        id: 42,
        title: null,
        original_title: null,
        poster_path: null,
        release_date: '',
        vote_average: null,
        vote_count: 0,
        genre_ids: null,
        popularity: 'nonsense',
      },
    ]);

    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: 42,
      title: 'Untitled',
      releaseYear: null,
      posterUrl: null,
      rating: null,
      voteCount: 0,
      genreIds: [],
      popularity: null,
    });
  });

  it('filters non-numeric members out of genre_ids', () => {
    const { items } = parseMovieList([{ id: 7, title: 'X', genre_ids: [18, 'x', 53, null] }]);
    assert.deepEqual(items[0]?.genreIds, [18, 53]);
  });

  it('tolerates results not being an array at all', () => {
    assert.deepEqual(parseMovieList([]), { items: [], dropped: 0 });
  });
});

describe('parseMovieDetail', () => {
  it('normalises runtime 0 to null rather than rendering "0 min"', () => {
    const detail = parseMovieDetail({ id: 1, title: 'A', runtime: 0 });
    assert.equal(detail?.runtimeMinutes, null);
  });

  it('keeps only complete genre pairs and falls back to the id map', () => {
    const detail = parseMovieDetail(
      { id: 1, title: 'A', genres: [{ id: 18 }, { name: 'Drama' }, { id: 53, name: 'Thriller' }] },
      new Map([[53, 'Thriller']]),
    );
    // { id: 18 } and { name: 'Drama' } are both unusable on their own.
    assert.deepEqual(detail?.genres, [{ id: 53, name: 'Thriller' }]);
  });

  it('resolves genre names from ids when the detail has no genres array', () => {
    const detail = parseMovieDetail(
      { id: 1, title: 'A', genre_ids: [28, 12] },
      new Map([
        [28, 'Action'],
        [12, 'Adventure'],
      ]),
    );
    assert.deepEqual(detail?.genres, [
      { id: 28, name: 'Action' },
      { id: 12, name: 'Adventure' },
    ]);
  });

  it('always provides an attribution URL', () => {
    const detail = parseMovieDetail({ id: 550, title: 'Fight Club' });
    assert.equal(detail?.tmdbUrl, 'https://www.themoviedb.org/movie/550');
  });

  it('returns null only when the id itself is unusable', () => {
    assert.equal(parseMovieDetail({ title: 'No id' }), null);
    assert.equal(parseMovieDetail(null), null);
    assert.notEqual(parseMovieDetail({ id: 1 }), null);
  });
});
