/**
 * Token Bucket Rate Limiter backed by Redis.
 *
 * Uses an atomic Lua script to ensure that concurrent workers sharing the same
 * Redis instance never exceed the configured maximum request rate for a platform.
 * The bucket state is stored under the key `rate_limit:{platform}` so all workers
 * (running in separate processes) see the same shared counter.
 *
 * Requirements: 31.1, 31.2, 31.5
 */

import type { Redis } from 'ioredis';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ service: 'TokenBucketRateLimiter' });

/**
 * Atomic Lua script executed inside Redis.
 *
 * Why Lua? "Check available tokens → take one" must be a single indivisible
 * operation. Without atomicity, two workers could both observe "1 token
 * available" and both decrement it, driving the count below zero.
 *
 * KEYS[1]  - Redis hash key, e.g. `rate_limit:linkedin`
 * ARGV[1]  - capacity  (max tokens, integer)
 * ARGV[2]  - refillRate (tokens per second, float)
 * ARGV[3]  - now        (current Unix time in seconds, float)
 *
 * Returns:
 *   1  – token successfully acquired
 *   0  – bucket empty; caller should wait and retry
 */
const TAKE_TOKEN_SCRIPT = `
local key         = KEYS[1]
local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now         = tonumber(ARGV[3])

local bucket      = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- Refill proportionally to elapsed time, capped at capacity
local elapsed = math.max(0, now - last_refill)
tokens = math.min(capacity, tokens + elapsed * refill_rate)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return 1
else
  -- Persist the (possibly partial) refill so the next call doesn't lose it
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return 0
end
`;

export class TokenBucketRateLimiter {
  private readonly key: string;

  /**
   * @param platform   Platform identifier — becomes part of the Redis key.
   *                   e.g. `"linkedin"` → key `rate_limit:linkedin`
   * @param maxTokens  Maximum number of tokens the bucket can hold (burst capacity).
   * @param refillRate Tokens added per second (e.g. `0.05` for 3 tokens/minute).
   * @param redis      ioredis client instance shared with the caller.
   */
  constructor(
    private readonly platform: string,
    private readonly maxTokens: number,
    private readonly refillRate: number,
    private readonly redis: Redis,
  ) {
    this.key = `rate_limit:${platform}`;
  }

  /**
   * Acquire a single token.
   *
   * Blocks asynchronously (via a sleep-poll loop) until a token becomes
   * available. Never throws due to rate-limiting — callers will simply wait.
   *
   * Requirements: 31.1, 31.5
   */
  async acquire(): Promise<void> {
    while (true) {
      const result = await this.tryAcquire();
      if (result) return;

      // Calculate how long until the next token is available and wait.
      // At refillRate tokens/sec, the shortest possible wait is 1/refillRate ms.
      const waitMs = Math.ceil(1000 / this.refillRate);
      log.debug(
        { platform: this.platform, waitMs },
        'Rate limit active — waiting for token',
      );
      await sleep(waitMs);
    }
  }

  /**
   * Attempt to acquire a token without waiting.
   *
   * @returns `true` if a token was taken, `false` if the bucket was empty.
   *
   * Requirements: 31.2 (atomic shared state via Redis Lua script)
   */
  async tryAcquire(): Promise<boolean> {
    const result = (await this.redis.eval(
      TAKE_TOKEN_SCRIPT,
      1,                    // number of KEYS
      this.key,             // KEYS[1]
      this.maxTokens,       // ARGV[1]
      this.refillRate,      // ARGV[2]
      Date.now() / 1000,    // ARGV[3] — seconds since epoch (float)
    )) as number;

    return result === 1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
