import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Cache behaviour, exercised against a real SQLite file.
 *
 * Deliberately not mocked: the L1/L2 split is the whole point of this module,
 * and the property that matters most — that a cached response survives a
 * process restart — is only meaningful against actual storage.
 *
 * `env.ts` reads process.env at module load, so DATABASE_PATH must be set
 * before these modules are imported. Hence the dynamic imports.
 */

const tempDir = mkdtempSync(path.join(tmpdir(), 'movieapp-cache-test-'));
process.env.DATABASE_PATH = path.join(tempDir, 'test.db');
process.env.LOG_LEVEL = 'error';

const cache = await import('../resilience/cache');
const queries = await import('../db/queries');
const { runMigrations } = await import('../db/migrate');
const { closeDb } = await import('../db/client');
const { metrics, resetMetrics } = await import('../resilience/metrics');

const policy = (freshMs: number, staleMs: number) => ({
  namespace: 'test',
  freshMs,
  staleMs,
});

before(() => {
  runMigrations();
});

after(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('cache key derivation', () => {
  it('is order-independent, so equivalent requests share one entry', () => {
    const a = cache.cacheKey('movies:list', { sort: 'popularity', page: 1 });
    const b = cache.cacheKey('movies:list', { page: 1, sort: 'popularity' });
    assert.equal(a, b);
  });

  it('sorts genre ids so chip order cannot fragment the cache', () => {
    const a = cache.cacheKey('movies:list', { genres: [35, 28] });
    const b = cache.cacheKey('movies:list', { genres: [28, 35] });
    assert.equal(a, b);
    assert.match(a, /genres=28,35/);
  });

  it('drops empty values rather than encoding them', () => {
    const key = cache.cacheKey('movies:list', { q: '', page: 2, year: null });
    assert.equal(key, 'movies:list|page=2');
  });

  it('stays human-readable for inspection during a demo', () => {
    const key = cache.cacheKey('movies:list', { mode: 'discover', page: 1, sort: 'rating' });
    assert.equal(key, 'movies:list|mode=discover|page=1|sort=rating');
  });
});

describe('freshness classification', () => {
  it('reports a just-written entry as fresh', () => {
    const key = `fresh-${Date.now()}`;
    cache.set(key, policy(60_000, 60_000), { value: 1 });

    const hit = cache.get<{ value: number }>(key);
    assert.equal(hit.state, 'fresh');
    assert.deepEqual(hit.value, { value: 1 });
  });

  it('reports an entry past its fresh window as stale, and still returns it', () => {
    const key = `stale-${Date.now()}`;
    // Already out of its fresh window, but inside the stale grace period.
    cache.set(key, policy(0, 60_000), { value: 2 });

    const hit = cache.get<{ value: number }>(key);
    assert.equal(hit.state, 'stale');
    assert.deepEqual(hit.value, { value: 2 }, 'stale data is still served');
  });

  it('reports an entry past its stale window as a miss', () => {
    const key = `expired-${Date.now()}`;
    cache.set(key, policy(0, 0), { value: 3 });

    assert.equal(cache.get(key).state, 'miss');
  });

  it('returns a fully expired entry when explicitly asked (stale-if-error)', () => {
    const key = `expired-forced-${Date.now()}`;
    cache.set(key, policy(0, 0), { value: 4 });

    // This is the path taken when the upstream fails: anything beats an error.
    const hit = cache.get<{ value: number }>(key, { includeExpired: true });
    assert.equal(hit.state, 'stale');
    assert.deepEqual(hit.value, { value: 4 });
  });

  it('is a miss for a key never written', () => {
    const hit = cache.get('never-written');
    assert.equal(hit.state, 'miss');
    assert.equal(hit.value, null);
  });
});

describe('L2 durability', () => {
  it('survives an L1 wipe, which is what makes a restart fast', () => {
    const key = `durable-${Date.now()}`;
    cache.set(key, policy(60_000, 60_000), { value: 'from-disk' });

    // Simulates a process restart: the in-memory tier is gone, SQLite is not.
    const clearedFromL1 = cache.clearL1ForTests();
    assert.ok(clearedFromL1 >= 1);

    const hit = cache.get<{ value: string }>(key);
    assert.equal(hit.state, 'fresh', 'must be rehydrated from SQLite');
    assert.deepEqual(hit.value, { value: 'from-disk' });
  });

  it('discards a corrupt row instead of throwing', () => {
    const key = `corrupt-${Date.now()}`;
    const storedAt = Date.now();

    queries.writeCache({
      cacheKey: key,
      namespace: 'test',
      valueJson: '{not valid json',
      storedAt,
      freshUntil: storedAt + 60_000,
      staleUntil: storedAt + 120_000,
    });

    assert.equal(cache.get(key).state, 'miss');
  });
});

describe('GC vs stale-if-error', () => {
  /**
   * Regression test for a real bug found while exercising the failure paths.
   *
   * The GC used to delete rows as soon as `stale_until` passed, but
   * stale-if-error deliberately reads rows *past* that point. The GC ran on
   * boot and removed exactly the data the last-resort fallback needed, turning
   * a degraded-but-working response into a 503.
   */
  it('keeps expired entries available as an emergency fallback', () => {
    const key = `gc-keep-${Date.now()}`;
    cache.set(key, policy(0, 0), { value: 'emergency' });

    // A GC sweep at the current time must not remove it.
    queries.pruneExpiredCache(Date.now());

    const hit = cache.get<{ value: string }>(key, { includeExpired: true });
    assert.equal(hit.state, 'stale', 'GC must not destroy the stale-if-error floor');
    assert.deepEqual(hit.value, { value: 'emergency' });
  });

  it('still deletes entries older than the retention window', () => {
    const key = `gc-drop-${Date.now()}`;
    cache.set(key, policy(0, 0), { value: 'ancient' });
    cache.clearL1ForTests();

    // Sweep as if far in the future: past stale_until AND past retention.
    const wellBeyond = Date.now() + queries.STALE_IF_ERROR_RETENTION_MS + 60_000;
    queries.pruneExpiredCache(wellBeyond);

    assert.equal(
      cache.get(key, { includeExpired: true }).state,
      'miss',
      'the table must still be bounded',
    );
  });
});

describe('clearing', () => {
  it('clears only the requested namespace', () => {
    const keep = cache.cacheKey('keep', { id: 1 });
    const drop = cache.cacheKey('drop', { id: 1 });

    cache.set(keep, { namespace: 'keep', freshMs: 60_000, staleMs: 0 }, 'a');
    cache.set(drop, { namespace: 'drop', freshMs: 60_000, staleMs: 0 }, 'b');

    cache.clear('drop');

    assert.equal(cache.get(keep).state, 'fresh');
    assert.equal(cache.get(drop).state, 'miss');
  });
});

describe('metrics', () => {
  it('counts hits and misses so the Status screen can prove caching works', () => {
    resetMetrics();
    const key = `metrics-${Date.now()}`;

    cache.get(key); // miss
    cache.set(key, policy(60_000, 0), 'x');
    cache.get(key); // hit
    cache.get(key); // hit

    assert.equal(metrics.cacheMisses, 1);
    assert.equal(metrics.cacheHits, 2);
  });
});
