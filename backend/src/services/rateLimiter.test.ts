/**
 * Property-based tests for src/services/rateLimiter.ts
 *
 * Property 25: Platform Rate Limit Compliance
 * Validates: Requirements 31.1, 31.2, 31.5
 *
 * For any burst count N (1..100), starting from a full bucket with `maxTokens`
 * tokens, the number of successful `tryAcquire()` calls must never exceed
 * `maxTokens` within the same time window (i.e. with no time passing between
 * calls so no refill occurs).
 *
 * The Redis `eval` call is mocked with an in-memory JS token-bucket simulation
 * that mirrors the Lua script's logic atomically (single-threaded JS event loop
 * guarantees the same atomicity semantics within a process).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TokenBucketRateLimiter } from './rateLimiter.js';
import type { Redis } from 'ioredis';

// ---------------------------------------------------------------------------
// In-memory token bucket mock for ioredis `eval`
// ---------------------------------------------------------------------------

/**
 * Build a mock Redis object whose `eval` method simulates the Lua token-bucket
 * script from rateLimiter.ts in plain JavaScript.
 *
 * State is isolated per Redis key so tests that use different platforms don't
 * interfere with each other.
 *
 * The mock is intentionally simple:
 *   - accepts the same KEYS/ARGV signature as the Lua script
 *   - performs the same refill + take-one logic
 *   - returns 1 (token acquired) or 0 (bucket empty)
 *
 * Because JS is single-threaded there is no need for an explicit mutex; the
 * same atomicity guarantee the Lua script provides inside Redis is preserved.
 */
function createMockRedis(): Redis {
  // Bucket state keyed by Redis key string
  const buckets = new Map<string, { tokens: number; lastRefill: number }>();

  const evalMock = vi.fn(
    (
      _script: string,
      _numKeys: number,
      key: string,
      capacity: string | number,
      refillRate: string | number,
      now: string | number,
    ): Promise<number> => {
      const cap = Number(capacity);
      const rate = Number(refillRate);
      const ts = Number(now);

      let state = buckets.get(key);
      if (!state) {
        // First call: bucket starts full
        state = { tokens: cap, lastRefill: ts };
        buckets.set(key, state);
      }

      // Refill proportionally to elapsed time, capped at capacity
      const elapsed = Math.max(0, ts - state.lastRefill);
      state.tokens = Math.min(cap, state.tokens + elapsed * rate);
      state.lastRefill = ts;

      if (state.tokens >= 1) {
        state.tokens -= 1;
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    },
  );

  return { eval: evalMock } as unknown as Redis;
}

// ---------------------------------------------------------------------------
// Helper: run N sequential tryAcquire() calls and return success count
// ---------------------------------------------------------------------------

async function countSuccessfulAcquisitions(
  limiter: TokenBucketRateLimiter,
  n: number,
): Promise<number> {
  let successes = 0;
  for (let i = 0; i < n; i++) {
    const ok = await limiter.tryAcquire();
    if (ok) successes++;
  }
  return successes;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('TokenBucketRateLimiter — unit tests', () => {
  it('allows exactly maxTokens acquisitions from a full bucket', async () => {
    const redis = createMockRedis();
    const limiter = new TokenBucketRateLimiter('test-platform', 5, 0.1, redis);

    const successes = await countSuccessfulAcquisitions(limiter, 10);
    expect(successes).toBe(5);
  });

  it('returns false immediately when the bucket is empty', async () => {
    const redis = createMockRedis();
    const limiter = new TokenBucketRateLimiter('test-platform', 3, 0.01, redis);

    // Drain the bucket
    await countSuccessfulAcquisitions(limiter, 3);

    // Next attempt must fail
    const result = await limiter.tryAcquire();
    expect(result).toBe(false);
  });

  it('isolates state between different platforms', async () => {
    const redis = createMockRedis();
    const limiterA = new TokenBucketRateLimiter('platform-a', 2, 0.1, redis);
    const limiterB = new TokenBucketRateLimiter('platform-b', 4, 0.1, redis);

    const aSuccesses = await countSuccessfulAcquisitions(limiterA, 10);
    const bSuccesses = await countSuccessfulAcquisitions(limiterB, 10);

    expect(aSuccesses).toBe(2);
    expect(bSuccesses).toBe(4);
  });

  it('never returns more than maxTokens successes regardless of burst size', async () => {
    const maxTokens = 7;
    const redis = createMockRedis();
    const limiter = new TokenBucketRateLimiter(
      'burst-platform',
      maxTokens,
      0.0,  // zero refill rate — no tokens regenerate during the test
      redis,
    );

    const successes = await countSuccessfulAcquisitions(limiter, 100);
    expect(successes).toBeLessThanOrEqual(maxTokens);
  });
});

// ---------------------------------------------------------------------------
// Property 25: Platform Rate Limit Compliance
// **Validates: Requirements 31.1, 31.2, 31.5**
// ---------------------------------------------------------------------------

describe('Property 25: Platform Rate Limit Compliance', () => {
  /**
   * For any burst count N in [1, 100], starting from a full bucket with
   * `maxTokens` tokens and no refill (refillRate = 0), the number of
   * successful tryAcquire() calls must never exceed maxTokens.
   *
   * Validates: Requirements 31.1, 31.2, 31.5
   */
  it('successful acquisitions never exceed maxTokens for any burst size', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Burst count: how many concurrent/sequential requests arrive
        fc.integer({ min: 1, max: 100 }),
        // Max tokens in the bucket (the configured platform limit)
        fc.integer({ min: 1, max: 20 }),
        async (burstCount, maxTokens) => {
          // A fresh isolated Redis mock per property run
          const redis = createMockRedis();

          // Zero refill rate ensures no tokens are added between calls,
          // making this a pure "burst within a single time window" test.
          const limiter = new TokenBucketRateLimiter(
            `platform-${maxTokens}`,
            maxTokens,
            0,   // no refill — freeze the window
            redis,
          );

          const successes = await countSuccessfulAcquisitions(
            limiter,
            burstCount,
          );

          // Core invariant: tokens consumed ≤ tokens available
          return successes <= maxTokens;
        },
      ),
      { numRuns: 200, verbose: true },
    );
  });

  /**
   * Exact acquisition count: when burstCount >= maxTokens the bucket should
   * be fully drained (successes === maxTokens), not partially consumed.
   *
   * Validates: Requirements 31.1 (bucket drains to zero, not below)
   */
  it('drains the bucket to exactly maxTokens when burst exceeds capacity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),  // maxTokens
        fc.integer({ min: 0, max: 50 }),  // extra requests beyond maxTokens
        async (maxTokens, extra) => {
          const redis = createMockRedis();
          const limiter = new TokenBucketRateLimiter(
            `exact-platform`,
            maxTokens,
            0,
            redis,
          );

          const burstCount = maxTokens + extra;
          const successes = await countSuccessfulAcquisitions(
            limiter,
            burstCount,
          );

          // Should drain to exactly maxTokens — no more, no less
          return successes === maxTokens;
        },
      ),
      { numRuns: 200, verbose: true },
    );
  });

  /**
   * Across multiple platforms with different configured limits, the
   * per-platform cap is always respected independently.
   *
   * Validates: Requirements 31.2 (shared-state isolation per platform key)
   */
  it('each platform enforces its own independent rate limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),   // maxTokens for platform A
        fc.integer({ min: 1, max: 10 }),   // maxTokens for platform B
        fc.integer({ min: 1, max: 50 }),   // burst count
        async (maxA, maxB, burst) => {
          // Both limiters share the same Redis mock (as in production where
          // multiple workers share a single Redis instance).
          const redis = createMockRedis();

          const limiterA = new TokenBucketRateLimiter('platform-a', maxA, 0, redis);
          const limiterB = new TokenBucketRateLimiter('platform-b', maxB, 0, redis);

          const [successA, successB] = await Promise.all([
            countSuccessfulAcquisitions(limiterA, burst),
            countSuccessfulAcquisitions(limiterB, burst),
          ]);

          return successA <= maxA && successB <= maxB;
        },
      ),
      { numRuns: 200, verbose: true },
    );
  });
});
