/**
 * Integration test: concurrent BullMQ-style workers sharing a single
 * TokenBucketRateLimiter backed by an in-memory mock Redis.
 *
 * **Validates: Requirements 31.5**
 *
 * Three workers fire acquire() calls concurrently against the same limiter.
 * The test asserts that, in any sliding window of `1/refillRate` seconds,
 * the aggregate number of granted tokens never exceeds `maxTokens`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../../src/services/rateLimiter.js';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// In-memory token bucket — faithfully mirrors the Lua script in rateLimiter.ts
// ---------------------------------------------------------------------------

type BucketEntry = { tokens: number; last_refill: number };
const bucketState = new Map<string, BucketEntry>();

/**
 * Build a mock ioredis client whose `eval` executes the same token-bucket
 * algorithm as the Lua script inside TokenBucketRateLimiter, but entirely
 * in-memory and synchronously (resolved via a microtask).
 *
 * Signature that matches how `tryAcquire` calls it:
 *   redis.eval(script, 1, key, maxTokens, refillRate, nowSeconds)
 */
function createMockRedis(maxTokens: number, refillRate: number): Redis {
  const mock = {
    eval: vi.fn(
      async (
        _script: string,
        _numKeys: number,
        key: string,
        _capacity: number,
        _refillRate: number,
        now: number,
      ): Promise<number> => {
        const capacity = maxTokens;
        const rate = refillRate;

        const existing = bucketState.get(key) ?? { tokens: capacity, last_refill: now };
        const elapsed = Math.max(0, now - existing.last_refill);
        let tokens = Math.min(capacity, existing.tokens + elapsed * rate);

        if (tokens >= 1) {
          tokens -= 1;
          bucketState.set(key, { tokens, last_refill: now });
          return 1;
        } else {
          bucketState.set(key, { tokens, last_refill: now });
          return 0;
        }
      },
    ),
  } as unknown as Redis;

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenBucketRateLimiter – concurrent workers (Req 31.5)', () => {
  const MAX_TOKENS = 5;
  // 100 tokens/sec → window = 10 ms — keeps the test fast
  const REFILL_RATE = 100;
  const WINDOW_SECONDS = 1 / REFILL_RATE; // 0.01 s = 10 ms
  const PLATFORM = 'test-platform';

  let limiter: TokenBucketRateLimiter;

  beforeEach(() => {
    bucketState.clear();
    const redis = createMockRedis(MAX_TOKENS, REFILL_RATE);
    limiter = new TokenBucketRateLimiter(PLATFORM, MAX_TOKENS, REFILL_RATE, redis);
  });

  // ── helper ──────────────────────────────────────────────────────────────

  /**
   * Run `count` acquire() calls concurrently.
   * Returns an array of timestamps (in seconds) at which each token was granted.
   */
  async function runWorker(count: number): Promise<number[]> {
    const granted: number[] = [];
    const calls = Array.from({ length: count }, async () => {
      await limiter.acquire();
      granted.push(Date.now() / 1000);
    });
    await Promise.all(calls);
    return granted;
  }

  // ── core assertion helper ────────────────────────────────────────────────

  /**
   * Given an array of grant timestamps (seconds), assert that no sliding
   * window of `windowSeconds` duration contains more than `maxAllowed` events.
   */
  function assertNoWindowExceedsLimit(
    timestamps: number[],
    windowSeconds: number,
    maxAllowed: number,
  ): void {
    const sorted = [...timestamps].sort((a, b) => a - b);

    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i]! + windowSeconds;
      const countInWindow = sorted.filter((t) => t >= sorted[i]! && t <= windowEnd).length;

      expect(
        countInWindow,
        `Expected at most ${maxAllowed} tokens in any ${windowSeconds * 1000} ms window ` +
          `but found ${countInWindow} (window starting at index ${i})`,
      ).toBeLessThanOrEqual(maxAllowed);
    }
  }

  // ── tests ────────────────────────────────────────────────────────────────

  it('grants no more than maxTokens tokens in the initial burst (single worker)', async () => {
    // Fire maxTokens + 2 concurrent requests — only maxTokens can be served immediately.
    const REQUESTS = MAX_TOKENS + 2;
    const t0 = Date.now() / 1000;

    const granted: number[] = [];
    const calls = Array.from({ length: REQUESTS }, async () => {
      await limiter.acquire();
      granted.push(Date.now() / 1000);
    });
    await Promise.all(calls);

    // How many were resolved in the very first window?
    const inFirstWindow = granted.filter((t) => t - t0 < WINDOW_SECONDS).length;
    expect(inFirstWindow).toBeLessThanOrEqual(MAX_TOKENS);
  }, 10_000);

  it('3 concurrent workers: aggregate tokens in any window never exceed maxTokens', async () => {
    const REQUESTS_PER_WORKER = 4; // 3 × 4 = 12 total; only 5 burst + refill allowed

    // Launch 3 workers simultaneously
    const [g1, g2, g3] = await Promise.all([
      runWorker(REQUESTS_PER_WORKER),
      runWorker(REQUESTS_PER_WORKER),
      runWorker(REQUESTS_PER_WORKER),
    ]);

    const allGranted = [...g1, ...g2, ...g3];

    // Aggregate across all workers: no window should exceed the limit
    assertNoWindowExceedsLimit(allGranted, WINDOW_SECONDS, MAX_TOKENS);
  }, 15_000);

  it('tryAcquire returns false when the bucket is empty', async () => {
    // Drain the bucket completely
    const drainResults: boolean[] = [];
    for (let i = 0; i < MAX_TOKENS; i++) {
      drainResults.push(await limiter.tryAcquire());
    }
    expect(drainResults.every(Boolean)).toBe(true);

    // Next call should return false (bucket empty)
    const result = await limiter.tryAcquire();
    expect(result).toBe(false);
  });

  it('bucket refills over time and allows more tokens after waiting', async () => {
    // Drain the bucket
    for (let i = 0; i < MAX_TOKENS; i++) {
      await limiter.tryAcquire();
    }

    // Immediately, bucket should be empty
    expect(await limiter.tryAcquire()).toBe(false);

    // After 1/refillRate seconds, at least 1 token should have refilled
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(1000 / REFILL_RATE) + 5));

    expect(await limiter.tryAcquire()).toBe(true);
  }, 10_000);

  it('multiple workers for the same platform share the same bucket', async () => {
    // Create two separate limiter instances pointing at the same platform key
    const redis = createMockRedis(MAX_TOKENS, REFILL_RATE);
    const limiterA = new TokenBucketRateLimiter(PLATFORM, MAX_TOKENS, REFILL_RATE, redis);
    const limiterB = new TokenBucketRateLimiter(PLATFORM, MAX_TOKENS, REFILL_RATE, redis);

    // Drain via limiterA
    for (let i = 0; i < MAX_TOKENS; i++) {
      await limiterA.tryAcquire();
    }

    // limiterB should see an empty bucket (same Redis key)
    const result = await limiterB.tryAcquire();
    expect(result).toBe(false);
  });
});
