import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CircuitBreaker } from '../resilience/circuit-breaker';

/**
 * The full closed -> open -> half-open -> closed cycle, driven by a fake clock.
 *
 * A fake clock is the whole reason this is testable: the real breaker waits 15
 * seconds before probing, and no test suite should.
 */

function makeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const options = (now: () => number) => ({
  now,
  consecutiveFailureThreshold: 5,
  failureRateThreshold: 0.5,
  minSamples: 5,
  windowSize: 20,
  openDurationsMs: [15_000, 30_000, 60_000],
});

describe('circuit breaker', () => {
  it('stays closed while calls succeed', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    for (let i = 0; i < 50; i += 1) breaker.onSuccess();

    assert.equal(breaker.snapshot().state, 'closed');
    assert.equal(breaker.canAttempt().allowed, true);
  });

  it('opens after the consecutive-failure threshold', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    for (let i = 0; i < 4; i += 1) breaker.onFailure('HTTP_500');
    assert.equal(breaker.snapshot().state, 'closed', 'four failures must not trip it');

    breaker.onFailure('HTTP_500');
    assert.equal(breaker.snapshot().state, 'open');
  });

  it('opens on a sustained failure rate even without five in a row', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    // Alternating so consecutiveFailures never reaches 5; the rate rule must
    // still catch a half-broken upstream.
    breaker.onFailure('X');
    breaker.onSuccess();
    breaker.onFailure('X');
    breaker.onSuccess();
    breaker.onFailure('X');

    assert.equal(breaker.snapshot().state, 'open');
  });

  it('short-circuits without allowing calls while open', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));
    for (let i = 0; i < 5; i += 1) breaker.onFailure('X');

    const gate = breaker.canAttempt();
    assert.equal(gate.allowed, false);
    assert.ok(gate.retryAfterMs > 0, 'should report how long until the next probe');
  });

  it('admits exactly one probe after the cool-off, then closes on success', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));
    for (let i = 0; i < 5; i += 1) breaker.onFailure('X');

    clock.advance(14_999);
    assert.equal(breaker.canAttempt().allowed, false, 'still open just before the cool-off');

    clock.advance(2);
    assert.equal(breaker.canAttempt().allowed, true, 'first call becomes the probe');
    assert.equal(breaker.snapshot().state, 'half-open');

    // A second concurrent caller must not also probe: a recovering upstream
    // should not be hit by the whole backlog at once.
    assert.equal(breaker.canAttempt().allowed, false, 'only one probe at a time');

    breaker.onSuccess();
    assert.equal(breaker.snapshot().state, 'closed');
    assert.equal(breaker.canAttempt().allowed, true);
  });

  it('re-opens with an escalating cool-off when the probe fails', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));
    for (let i = 0; i < 5; i += 1) breaker.onFailure('X');

    // First cool-off: 15s.
    clock.advance(15_001);
    assert.equal(breaker.canAttempt().allowed, true);
    breaker.onFailure('X');
    assert.equal(breaker.snapshot().state, 'open');

    // Second cool-off is 30s, so 15s is no longer enough.
    clock.advance(15_001);
    assert.equal(breaker.canAttempt().allowed, false, 'cool-off should have escalated to 30s');

    clock.advance(15_001);
    assert.equal(breaker.canAttempt().allowed, true);
    breaker.onFailure('X');

    // Third: 60s.
    clock.advance(30_001);
    assert.equal(breaker.canAttempt().allowed, false, 'cool-off should have escalated to 60s');
    clock.advance(30_001);
    assert.equal(breaker.canAttempt().allowed, true);
  });

  it('resets the escalation ladder after recovery', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    for (let i = 0; i < 5; i += 1) breaker.onFailure('X');
    clock.advance(15_001);
    breaker.canAttempt();
    breaker.onSuccess();

    // Break it again: the cool-off must be back to the first rung, not the
    // second, or a single bad minute would punish the upstream for an hour.
    for (let i = 0; i < 5; i += 1) breaker.onFailure('X');
    clock.advance(15_001);
    assert.equal(breaker.canAttempt().allowed, true);
  });

  it('reports the last error for the Status screen', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    breaker.onFailure('HTTP_503');
    const snapshot = breaker.snapshot();

    assert.equal(snapshot.consecutiveFailures, 1);
    assert.equal(snapshot.lastErrorCode, 'HTTP_503');
    assert.equal(snapshot.lastErrorAt, new Date(clock.now()).toISOString());
  });

  it('supports forced open/close for the demo controls', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker(options(clock.now));

    breaker.forceOpen();
    assert.equal(breaker.snapshot().state, 'open');
    assert.equal(breaker.canAttempt().allowed, false);

    breaker.forceClose();
    assert.equal(breaker.snapshot().state, 'closed');
    assert.equal(breaker.canAttempt().allowed, true);
  });
});
