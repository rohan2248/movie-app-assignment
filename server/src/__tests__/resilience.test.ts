import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InflightRegistry } from '../resilience/inflight';
import { RateLimitExceededError, RateLimiter } from '../resilience/rate-limiter';
import { DeadlineError, TimeoutError, isRetryableError, retry } from '../resilience/retry';

/** Retry, single-flight coalescing, and the outbound rate limiter. */

describe('retry policy', () => {
  it('retries transport faults and timeouts', () => {
    assert.equal(isRetryableError(new TimeoutError(100)), true);
    assert.equal(isRetryableError(new TypeError('fetch failed')), true);
    assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
    assert.equal(isRetryableError({ status: 503 }), true);
    assert.equal(isRetryableError({ status: 429 }), true);
  });

  it('does not retry what cannot succeed on a retry', () => {
    // Retrying these only multiplies latency before showing the same error.
    assert.equal(isRetryableError({ status: 401 }), false);
    assert.equal(isRetryableError({ status: 404 }), false);
    assert.equal(isRetryableError({ status: 422 }), false);
    assert.equal(isRetryableError(new DeadlineError(1000)), false);
  });
});

describe('retry', () => {
  const noSleep = async () => {};

  it('returns the first successful result without retrying', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        return 'ok';
      },
      { sleep: noSleep },
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retries a retryable failure and then succeeds', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('boom'), { status: 503 });
        return 'recovered';
      },
      { sleep: noSleep },
    );

    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  it('gives up after the attempt budget', async () => {
    let calls = 0;
    await assert.rejects(
      retry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('always'), { status: 500 });
        },
        { attempts: 3, sleep: noSleep },
      ),
    );

    assert.equal(calls, 3, '1 initial + 2 retries');
  });

  it('fails immediately on a non-retryable error', async () => {
    let calls = 0;
    await assert.rejects(
      retry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('unauthorised'), { status: 401 });
        },
        { sleep: noSleep },
      ),
    );

    assert.equal(calls, 1, 'must not retry a credential error');
  });

  it('applies exponential backoff with jitter inside the expected band', async () => {
    const delays: number[] = [];
    // random() = 1 puts jitter at its positive extreme: delay = base * 1.2.
    await assert.rejects(
      retry(
        async () => {
          throw Object.assign(new Error('x'), { status: 500 });
        },
        {
          attempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 10_000,
          jitterRatio: 0.2,
          random: () => 1,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    );

    // Exponential: 100, 200, 400 — each +20% jitter.
    assert.deepEqual(delays, [120, 240, 480]);
  });

  it('times out a single attempt and retries it', async () => {
    let calls = 0;
    const result = await retry(
      async (_attempt, signal) => {
        calls += 1;
        if (calls === 1) {
          // Never resolves; only the per-attempt timeout can end this.
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        return 'second attempt';
      },
      { timeoutMs: 30, sleep: noSleep },
    );

    assert.equal(result, 'second attempt');
    assert.equal(calls, 2);
  });

  it('stops at the overall deadline even with attempts remaining', async () => {
    let calls = 0;
    await assert.rejects(
      retry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('x'), { status: 500 });
        },
        {
          attempts: 10,
          baseDelayMs: 50,
          deadlineMs: 120,
          // A real clock here, so the deadline is genuinely wall-clock bound.
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
      ),
      (error: unknown) => error instanceof DeadlineError || (error as { status?: number })?.status === 500,
    );

    assert.ok(calls < 10, `should not exhaust all attempts; made ${calls}`);
  });
});

describe('in-flight coalescing', () => {
  it('collapses concurrent identical work into one call', async () => {
    const registry = new InflightRegistry<number>();
    let executions = 0;

    const work = async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 42;
    };

    // Five simultaneous callers asking for the same key.
    const results = await Promise.all([
      registry.run('same', work),
      registry.run('same', work),
      registry.run('same', work),
      registry.run('same', work),
      registry.run('same', work),
    ]);

    assert.deepEqual(results, [42, 42, 42, 42, 42]);
    assert.equal(executions, 1, 'one upstream call for five callers');
  });

  it('keeps different keys independent', async () => {
    const registry = new InflightRegistry<string>();
    let executions = 0;

    const work = (value: string) => async () => {
      executions += 1;
      return value;
    };

    const [a, b] = await Promise.all([
      registry.run('a', work('a')),
      registry.run('b', work('b')),
    ]);

    assert.equal(a, 'a');
    assert.equal(b, 'b');
    assert.equal(executions, 2);
  });

  it('releases the key after completion so later calls re-execute', async () => {
    const registry = new InflightRegistry<number>();
    let executions = 0;
    const work = async () => {
      executions += 1;
      return 1;
    };

    await registry.run('k', work);
    assert.equal(registry.size, 0, 'must not leak entries');

    await registry.run('k', work);
    assert.equal(executions, 2);
  });

  it('propagates a rejection to every joined caller and clears the key', async () => {
    const registry = new InflightRegistry<number>();
    let executions = 0;

    const failing = async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('upstream down');
    };

    const results = await Promise.allSettled([
      registry.run('f', failing),
      registry.run('f', failing),
    ]);

    assert.equal(executions, 1);
    assert.equal(results[0]?.status, 'rejected');
    assert.equal(results[1]?.status, 'rejected');
    assert.equal(registry.size, 0);
  });
});

describe('outbound rate limiter', () => {
  it('allows an initial burst up to capacity', async () => {
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 1000 });

    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }

    assert.ok(limiter.snapshot().tokens <= 1);
  });

  it('queues beyond capacity and drains as tokens refill', async () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 100, maxWaitMs: 2_000 });

    const started = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => limiter.acquire()));

    // 4 of the 6 had to wait for refill at 100/s -> at least ~40ms.
    assert.ok(Date.now() - started >= 20, 'later callers should have waited for tokens');
  });

  it('sheds load rather than queueing without bound', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillPerSecond: 0.001, // effectively never refills during the test
      maxQueueDepth: 2,
      maxWaitMs: 50,
    });

    await limiter.acquire(); // consumes the only token

    const settled = await Promise.allSettled([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(), // beyond maxQueueDepth -> immediate rejection
    ]);

    const rejected = settled.filter((result) => result.status === 'rejected');
    assert.ok(rejected.length >= 1, 'queue depth must be enforced');
    assert.ok(
      rejected.some((result) =>
        result.status === 'rejected' && result.reason instanceof RateLimitExceededError,
      ),
    );
  });

  it('drains the bucket when the upstream says 429, to prevent a stampede', async () => {
    const limiter = new RateLimiter({ capacity: 10, refillPerSecond: 10 });

    assert.ok(limiter.snapshot().tokens > 0);

    limiter.applyUpstreamCooldown(500);
    const snapshot = limiter.snapshot();

    // Both matter: without draining the tokens, every accrued token would fire
    // the instant the cooldown lifted and earn a second 429 immediately.
    assert.equal(snapshot.tokens, 0, 'tokens must be drained');
    assert.ok(snapshot.cooldownMsRemaining > 0, 'cooldown must be recorded');
  });
});
