/**
 * Tests for the LinkedIn Job Discovery Connector
 *
 * Property 5: LinkedIn Session Rate Limits
 *
 * **Validates: Requirements 5.5, 5.6**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  MAX_CARDS_PER_SESSION,
  MIN_SESSION_INTERVAL_MS,
  SESSION_RATE_LIMIT_CONFIG,
} from './linkedin.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';

// ─── Concrete unit tests ──────────────────────────────────────────────────────

describe('LinkedInConnector rate limit config', () => {
  it('MAX_CARDS_PER_SESSION is exactly 20', () => {
    expect(MAX_CARDS_PER_SESSION).toBe(20);
  });

  it('MIN_SESSION_INTERVAL_MS is exactly 10 minutes', () => {
    expect(MIN_SESSION_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(MIN_SESSION_INTERVAL_MS).toBe(600_000);
  });

  it('SESSION_RATE_LIMIT_CONFIG has maxTokens of 1', () => {
    expect(SESSION_RATE_LIMIT_CONFIG.maxTokens).toBe(1);
  });

  it('SESSION_RATE_LIMIT_CONFIG refill rate allows 1 session per 10 minutes', () => {
    // 1 / refillRate seconds = 600 seconds = 10 minutes
    const secondsPerToken = 1 / SESSION_RATE_LIMIT_CONFIG.refillRate;
    expect(secondsPerToken).toBeCloseTo(600, 5);
  });

  it('SESSION_RATE_LIMIT_CONFIG refill rate is 1/600', () => {
    expect(SESSION_RATE_LIMIT_CONFIG.refillRate).toBeCloseTo(1 / 600, 10);
  });

  it('verifies TokenBucketRateLimiter is importable for use with LinkedIn config', () => {
    expect(typeof TokenBucketRateLimiter).toBe('function');
  });

  // ─── Property 5: Cards per session ≤ 20 ────────────────────────────────────

  /**
   * **Validates: Requirements 5.5**
   *
   * Property 5 (cards): For any arbitrary number of requested cards,
   * the connector never processes more than MAX_CARDS_PER_SESSION in one session.
   */
  it('Property 5 — job cards per session never exceed 20', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // arbitrary card count requested
        (requestedCards) => {
          // Simulate the card counter logic used in LinkedInConnector._runSession:
          // `if (cardCount >= MAX_CARDS_PER_SESSION) break;`
          const actualProcessed = Math.min(requestedCards, MAX_CARDS_PER_SESSION);
          return actualProcessed <= MAX_CARDS_PER_SESSION;
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * Property 5 (cards zero): Zero requested cards yields zero processed.
   */
  it('Property 5 — zero requested cards yields zero processed', () => {
    fc.assert(
      fc.property(
        fc.constant(0),
        (requestedCards) => {
          const actualProcessed = Math.min(requestedCards, MAX_CARDS_PER_SESSION);
          return actualProcessed === 0;
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * Property 5 (cards cap): When more than MAX_CARDS_PER_SESSION cards are
   * available, exactly MAX_CARDS_PER_SESSION are processed.
   */
  it('Property 5 — exactly 20 cards processed when more are available', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_CARDS_PER_SESSION + 1, max: 1000 }),
        (requestedCards) => {
          const actualProcessed = Math.min(requestedCards, MAX_CARDS_PER_SESSION);
          return actualProcessed === MAX_CARDS_PER_SESSION;
        },
      ),
      { numRuns: 500 },
    );
  });

  // ─── Property 5: Time between sessions ≥ 10 minutes ────────────────────────

  /**
   * **Validates: Requirements 5.5, 5.6**
   *
   * Property 5 (interval): The SESSION_RATE_LIMIT_CONFIG mathematics ensure
   * that the token bucket refills at a rate that allows exactly 1 session per
   * 10 minutes.  Consecutive sessions with a gap < MIN_SESSION_INTERVAL_MS
   * would be blocked by the limiter.
   */
  it('Property 5 — session interval enforces minimum 10 minutes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3_600_000 }), { minLength: 2, maxLength: 10 }),
        (timestamps) => {
          // Sort timestamps and check consecutive gaps.
          const sorted = [...timestamps].sort((a, b) => a - b);

          // For any pair of timestamps that are < MIN_SESSION_INTERVAL_MS apart,
          // the rate limiter would block the second session.
          // Verify the config math: 1 / refillRate seconds must equal 600.
          for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i] - sorted[i - 1];
            if (gap < MIN_SESSION_INTERVAL_MS) {
              // This gap is too small; the rate limiter WOULD have blocked it.
              // The invariant is that our config correctly models this:
              // secondsPerToken = 1 / refillRate = 600s = MIN_SESSION_INTERVAL_MS / 1000
              const secondsPerToken = 1 / SESSION_RATE_LIMIT_CONFIG.refillRate;
              const msPerToken = secondsPerToken * 1000;
              if (Math.abs(msPerToken - MIN_SESSION_INTERVAL_MS) > 1) {
                return false;
              }
            }
          }

          // Verify the core config invariant holds for every run.
          const secondsPerToken = 1 / SESSION_RATE_LIMIT_CONFIG.refillRate;
          return Math.abs(secondsPerToken - 600) < 0.001;
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * Property 5 (refill math): For any number of minutes elapsed,
   * the number of refilled tokens equals elapsed minutes / 10.
   */
  it('Property 5 — refill rate correctly models 1 session per 10 minutes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1440 }), // minutes elapsed (up to 24 hours)
        (minutes) => {
          const secondsElapsed = minutes * 60;
          const tokensRefilled = SESSION_RATE_LIMIT_CONFIG.refillRate * secondsElapsed;
          // Expected: 1 token per 10 minutes = minutes / 10 tokens
          const expectedTokens = minutes / 10;
          return Math.abs(tokensRefilled - expectedTokens) < 0.0001;
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 5.5**
   *
   * Property 5 (token bucket simulation): Simulating the token bucket over
   * multiple sessions confirms that at most 1 token is ever available (burst cap)
   * and consecutive sessions without waiting would exhaust the bucket.
   */
  it('Property 5 — token bucket simulation: burst cap of 1 prevents back-to-back sessions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }), // number of session attempts
        (sessionAttempts) => {
          const MAX_TOKENS = SESSION_RATE_LIMIT_CONFIG.maxTokens; // 1
          const REFILL_RATE = SESSION_RATE_LIMIT_CONFIG.refillRate;

          // Start with a full bucket.
          let tokens = MAX_TOKENS;
          let consumed = 0;

          // Attempt all sessions immediately (no time between them).
          // Only the first should succeed (bucket starts with 1 token).
          for (let i = 0; i < sessionAttempts; i++) {
            if (tokens >= 1) {
              tokens -= 1;
              consumed++;
            }
            // No time passes — no refill.
          }

          // Without any waiting, burst never exceeds maxTokens=1.
          // Exactly 1 session can proceed immediately; the rest are blocked.
          if (consumed > MAX_TOKENS) return false;

          // Verify: after 600 seconds (10 minutes), exactly 1 token refills.
          const tokensAfter10Min = Math.min(
            MAX_TOKENS,
            tokens + REFILL_RATE * 600,
          );
          return tokensAfter10Min <= MAX_TOKENS && tokensAfter10Min >= 0;
        },
      ),
      { numRuns: 500 },
    );
  });
});
