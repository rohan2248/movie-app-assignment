/**
 * Outbound token-bucket limiter: protects *TMDB* from us.
 *
 * Distinct from the inbound limiter in http/middleware.ts, which protects us
 * from a client. The two have unrelated failure modes and separate budgets.
 *
 * A bucket rather than a fixed window because bursts are the normal shape of
 * this traffic: a user opens the app and six posters prefetch at once. A bucket
 * absorbs that and then enforces the average rate, where a fixed window would
 * either reject the burst or allow double the rate across a boundary.
 */

export class RateLimitExceededError extends Error {
  readonly code = 'RATE_LIMIT_QUEUE_FULL';
  constructor(readonly retryAfterMs: number) {
    super('Outbound rate limit queue is full');
    this.name = 'RateLimitExceededError';
  }
}

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  enqueuedAt: number;
  timer: NodeJS.Timeout | null;
};

export type RateLimiterOptions = {
  /** Burst size. */
  capacity?: number;
  refillPerSecond?: number;
  /** Reject rather than queue beyond this depth. */
  maxQueueDepth?: number;
  /** Longest a caller will wait for a token before giving up. */
  maxWaitMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export class RateLimiter {
  private tokens: number;
  private lastRefillAt: number;
  private queue: Waiter[] = [];
  /** Set from an upstream 429's Retry-After; overrides normal refill. */
  private cooldownUntil = 0;
  private draining = false;

  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly maxQueueDepth: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearTimer: (timer: NodeJS.Timeout) => void;

  constructor(options: RateLimiterOptions = {}) {
    this.capacity = options.capacity ?? 20;
    this.refillPerSecond = options.refillPerSecond ?? 20;
    this.maxQueueDepth = options.maxQueueDepth ?? 100;
    this.maxWaitMs = options.maxWaitMs ?? 3_000;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));

    this.tokens = this.capacity;
    this.lastRefillAt = this.now();
  }

  private refill(): void {
    const current = this.now();

    if (current < this.cooldownUntil) {
      // Under an upstream-instructed cooldown, nothing accrues.
      this.lastRefillAt = current;
      return;
    }

    const elapsedSeconds = (current - this.lastRefillAt) / 1000;
    if (elapsedSeconds <= 0) return;

    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillAt = current;
  }

  /** Resolves when a token is available; rejects if the queue or wait is exceeded. */
  acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1 && this.queue.length === 0 && this.now() >= this.cooldownUntil) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    if (this.queue.length >= this.maxQueueDepth) {
      // Shedding load beats an unbounded queue: a caller waiting 30s for a
      // poster has already failed from the user's point of view.
      return Promise.reject(new RateLimitExceededError(this.estimatedWaitMs()));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        enqueuedAt: this.now(),
        timer: null,
      };

      waiter.timer = this.setTimer(() => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new RateLimitExceededError(this.estimatedWaitMs()));
      }, this.maxWaitMs);

      this.queue.push(waiter);
      this.scheduleDrain();
    });
  }

  private estimatedWaitMs(): number {
    const cooldownRemaining = Math.max(0, this.cooldownUntil - this.now());
    const queueWait = (this.queue.length / this.refillPerSecond) * 1000;
    return Math.max(cooldownRemaining, Math.round(queueWait), 100);
  }

  private scheduleDrain(): void {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;

    const step = () => {
      this.draining = false;
      this.refill();

      while (this.queue.length > 0 && this.tokens >= 1 && this.now() >= this.cooldownUntil) {
        const waiter = this.queue.shift();
        if (!waiter) break;
        if (waiter.timer) this.clearTimer(waiter.timer);
        this.tokens -= 1;
        waiter.resolve();
      }

      if (this.queue.length > 0) {
        const cooldownRemaining = Math.max(0, this.cooldownUntil - this.now());
        const tokenWait = Math.ceil((1 / this.refillPerSecond) * 1000);
        this.draining = true;
        const timer = this.setTimer(step, Math.max(cooldownRemaining, tokenWait, 5));
        // Never hold the process open just to drain a queue.
        timer.unref?.();
      }
    };

    const timer = this.setTimer(step, 5);
    timer.unref?.();
  }

  /**
   * Honour an upstream 429.
   *
   * Draining the bucket as well as setting the cooldown is the important part:
   * otherwise the moment the cooldown lifts, every accrued token fires at once
   * and earns a second 429 immediately.
   */
  applyUpstreamCooldown(retryAfterMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + retryAfterMs);
    this.tokens = 0;
    this.lastRefillAt = this.now();
    this.scheduleDrain();
  }

  snapshot(): {
    tokens: number;
    queueDepth: number;
    cooldownMsRemaining: number;
  } {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      queueDepth: this.queue.length,
      cooldownMsRemaining: Math.max(0, this.cooldownUntil - this.now()),
    };
  }
}
