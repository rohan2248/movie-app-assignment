import { metrics } from './metrics';

/**
 * In-flight request coalescing (single-flight).
 *
 * Answers the assignment's "the user performs multiple searches or changes
 * filters quickly" from the server side. The client debounces, which stops most
 * duplicate work — but debouncing cannot help when *different* clients ask for
 * the same thing, or when two taps land inside the same round trip. Keying
 * concurrent identical work onto one promise handles both.
 *
 * Deliberately not a cache: entries live only for the duration of the call. The
 * cache layer sits above this and handles repeat requests over time.
 */
export class InflightRegistry<T> {
  private readonly pending = new Map<string, Promise<T>>();

  /**
   * Runs `fn` under `key`, or joins the existing call if one is in flight.
   *
   * Note both callers share one promise, so a rejection reaches all of them —
   * which is correct: they asked for the same thing and it failed.
   */
  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      metrics.coalescedCalls += 1;
      return existing;
    }

    // Start, then register. The `finally` must not run before `set`, so the
    // promise is created and stored in the same synchronous tick.
    const promise = (async () => fn())().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.pending.size;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }
}
