export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until enough tokens refill to satisfy this request. */
  retryAfterMs: number;
  /** Whole tokens left in the bucket after this call. */
  remaining: number;
}

interface Bucket {
  tokens: number;
  last: number;
}

/**
 * In-memory token-bucket rate limiter, keyed by an arbitrary string (API key or
 * client IP). Each key gets a bucket of `capacity` tokens that refills at
 * `refillPerMs`; a request costs one token. Bursts up to `capacity` are allowed,
 * with a smooth steady-state of `capacity / (capacity/refillPerMs)` per window.
 *
 * Pure aside from the injected clock, so it unit-tests deterministically. Bounded
 * by `maxKeys`: when full, idle (fully-refilled) buckets are purged first.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 100_000,
  ) {}

  take(key: string, cost = 1): RateLimitResult {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.purgeIdle(t);
      b = { tokens: this.capacity, last: t };
      this.buckets.set(key, b);
    }

    // Lazily refill based on elapsed time, capped at capacity.
    const elapsed = t - b.last;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerMs);
      b.last = t;
    }

    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
    }

    const deficit = cost - b.tokens;
    const retryAfterMs =
      this.refillPerMs > 0 ? Math.ceil(deficit / this.refillPerMs) : Infinity;
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  /** Drop buckets that have fully refilled (i.e. idle callers) to bound memory. */
  private purgeIdle(now: number): void {
    for (const [k, b] of this.buckets) {
      const tokens = Math.min(
        this.capacity,
        b.tokens + (now - b.last) * this.refillPerMs,
      );
      if (tokens >= this.capacity) this.buckets.delete(k);
    }
  }
}
