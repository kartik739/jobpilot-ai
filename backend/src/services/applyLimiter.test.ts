/**
 * Unit tests for src/services/applyLimiter.ts
 *
 * Covers:
 *   - isDailyLimitReached: false when count < limit, true when count >= limit
 *   - isDailyLimitReached: only counts today's applications (UTC boundary)
 *   - validateDailyLimit: rejects < 1, > 50, and non-integers; accepts 1, 10, 50
 *   - pauseAutomation / resumeAutomation / isAutomationPaused: Redis key semantics
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.5, 14.6, 14.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';

// ─── Stub out db.ts before importing the service ────────────────────────────
// vi.mock is hoisted to the top of the file, so we use vi.hoisted() to
// create the mock function before the factory executes.

const { mockCount } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCount: vi.fn<(...args: any[]) => Promise<number>>(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    applicationRecord: {
      count: mockCount,
    },
  },
}));

// Stub logger so tests produce no output
vi.mock('../core/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  isDailyLimitReached,
  getTodayApplicationCount,
  validateDailyLimit,
  pauseAutomation,
  resumeAutomation,
  isAutomationPaused,
  DAILY_LIMIT_MIN,
  DAILY_LIMIT_MAX,
  DAILY_LIMIT_DEFAULT,
} from './applyLimiter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockRedis(initialState: Record<string, string> = {}): Redis {
  const store = new Map<string, string>(Object.entries(initialState));
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
  } as unknown as Redis;
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('DAILY_LIMIT_MIN is 1', () => expect(DAILY_LIMIT_MIN).toBe(1));
  it('DAILY_LIMIT_MAX is 50', () => expect(DAILY_LIMIT_MAX).toBe(50));
  it('DAILY_LIMIT_DEFAULT is 10', () => expect(DAILY_LIMIT_DEFAULT).toBe(10));
});

// ─── isDailyLimitReached ──────────────────────────────────────────────────────

describe('isDailyLimitReached (Req 14.1, 14.2)', () => {
  beforeEach(() => {
    mockCount.mockReset();
  });

  it('returns false when today count is below the limit', async () => {
    mockCount.mockResolvedValue(5);
    const result = await isDailyLimitReached('user-1', 10);
    expect(result).toBe(false);
  });

  it('returns true when today count equals the limit', async () => {
    mockCount.mockResolvedValue(10);
    const result = await isDailyLimitReached('user-1', 10);
    expect(result).toBe(true);
  });

  it('returns true when today count exceeds the limit', async () => {
    mockCount.mockResolvedValue(12);
    const result = await isDailyLimitReached('user-1', 10);
    expect(result).toBe(true);
  });

  it('returns false when count is 0 and limit is 1', async () => {
    mockCount.mockResolvedValue(0);
    const result = await isDailyLimitReached('user-1', 1);
    expect(result).toBe(false);
  });

  it('returns true when count equals the minimum limit (1)', async () => {
    mockCount.mockResolvedValue(1);
    const result = await isDailyLimitReached('user-1', 1);
    expect(result).toBe(true);
  });

  it('queries Prisma with a UTC today start boundary', async () => {
    mockCount.mockResolvedValue(0);
    await isDailyLimitReached('user-abc', 10);

    expect(mockCount).toHaveBeenCalledOnce();
    const [callArg] = mockCount.mock.calls[0]!;
    const { where } = callArg as { where: { userId: string; appliedAt: { gte: Date; lte: Date } } };

    // Verify userId is forwarded
    expect(where.userId).toBe('user-abc');

    // gte must be start of today (UTC midnight)
    const gte = where.appliedAt.gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getUTCHours()).toBe(0);
    expect(gte.getUTCMinutes()).toBe(0);
    expect(gte.getUTCSeconds()).toBe(0);
    expect(gte.getUTCMilliseconds()).toBe(0);

    // lte must be end of today (UTC 23:59:59.999)
    const lte = where.appliedAt.lte;
    expect(lte).toBeInstanceOf(Date);
    expect(lte.getUTCHours()).toBe(23);
    expect(lte.getUTCMinutes()).toBe(59);
    expect(lte.getUTCSeconds()).toBe(59);
    expect(lte.getUTCMilliseconds()).toBe(999);
  });

  it('does not count applications from yesterday (UTC boundary reset)', async () => {
    // Simulate that Prisma correctly returns 0 for yesterday's applications
    // by verifying the gte boundary excludes previous-day records.
    mockCount.mockResolvedValue(0); // yesterday's apps would not be in this count

    const result = await isDailyLimitReached('user-1', 10);
    expect(result).toBe(false);

    // Confirm the query uses a same-day UTC gte boundary (not yesterday)
    const [callArg] = mockCount.mock.calls[0]!;
    const { where } = callArg as { where: { appliedAt: { gte: Date } } };
    const gte = where.appliedAt.gte;

    const now = new Date();
    const todayUTCStart = new Date(now);
    todayUTCStart.setUTCHours(0, 0, 0, 0);

    // The boundary date must be today's UTC midnight, not yesterday's
    expect(gte.toUTCString()).toBe(todayUTCStart.toUTCString());
  });

  it('clamps supplied limit to valid range before comparing', async () => {
    // Limit supplied as 0 (below minimum) should be clamped to 1
    mockCount.mockResolvedValue(1);
    const result = await isDailyLimitReached('user-1', 0);
    // count(1) >= clamped limit(1) → true
    expect(result).toBe(true);
  });
});

// ─── getTodayApplicationCount ─────────────────────────────────────────────────

describe('getTodayApplicationCount (Req 14.1)', () => {
  beforeEach(() => {
    mockCount.mockReset();
  });

  it('returns the count from Prisma', async () => {
    mockCount.mockResolvedValue(7);
    const count = await getTodayApplicationCount('user-1');
    expect(count).toBe(7);
  });

  it('queries with userId and a UTC today start boundary', async () => {
    mockCount.mockResolvedValue(3);
    await getTodayApplicationCount('user-xyz');

    const [callArg] = mockCount.mock.calls[0]!;
    const { where } = callArg as { where: { userId: string; appliedAt: { gte: Date } } };
    expect(where.userId).toBe('user-xyz');

    const gte = where.appliedAt.gte;
    expect(gte).toBeInstanceOf(Date);
    expect(gte.getUTCHours()).toBe(0);
    expect(gte.getUTCMinutes()).toBe(0);
    expect(gte.getUTCSeconds()).toBe(0);
  });

  it('returns 0 when no applications today', async () => {
    mockCount.mockResolvedValue(0);
    const count = await getTodayApplicationCount('user-1');
    expect(count).toBe(0);
  });
});

// ─── validateDailyLimit ───────────────────────────────────────────────────────

describe('validateDailyLimit (Req 14.3)', () => {
  it('returns the value for minimum valid limit (1)', () => {
    expect(validateDailyLimit(1)).toBe(1);
  });

  it('returns the value for default limit (10)', () => {
    expect(validateDailyLimit(10)).toBe(10);
  });

  it('returns the value for maximum valid limit (50)', () => {
    expect(validateDailyLimit(50)).toBe(50);
  });

  it('throws for value below minimum (0)', () => {
    expect(() => validateDailyLimit(0)).toThrow();
  });

  it('throws for negative value (-1)', () => {
    expect(() => validateDailyLimit(-1)).toThrow();
  });

  it('throws for value above maximum (51)', () => {
    expect(() => validateDailyLimit(51)).toThrow();
  });

  it('throws for value above maximum (100)', () => {
    expect(() => validateDailyLimit(100)).toThrow();
  });

  it('throws for a non-integer float (5.5)', () => {
    expect(() => validateDailyLimit(5.5)).toThrow();
  });

  it('throws for a non-integer float (10.1)', () => {
    expect(() => validateDailyLimit(10.1)).toThrow();
  });

  it('throws for NaN', () => {
    expect(() => validateDailyLimit(NaN)).toThrow();
  });

  it('error message mentions the valid range', () => {
    expect(() => validateDailyLimit(0)).toThrowError(/1.*50|50.*1/);
  });
});

// ─── pauseAutomation / resumeAutomation / isAutomationPaused ─────────────────

describe('automation pause/resume controls (Req 14.4, 14.5, 14.6, 14.7)', () => {
  it('isAutomationPaused returns false when key is not set', async () => {
    const redis = createMockRedis();
    const paused = await isAutomationPaused('user-1', redis);
    expect(paused).toBe(false);
  });

  it('pauseAutomation sets the Redis key', async () => {
    const redis = createMockRedis();
    await pauseAutomation('user-1', redis);
    expect(redis.set).toHaveBeenCalledWith('automation_paused:user-1', '1');
  });

  it('isAutomationPaused returns true after pauseAutomation', async () => {
    const redis = createMockRedis();
    await pauseAutomation('user-1', redis);
    const paused = await isAutomationPaused('user-1', redis);
    expect(paused).toBe(true);
  });

  it('resumeAutomation deletes the Redis key', async () => {
    const redis = createMockRedis();
    await pauseAutomation('user-1', redis);
    await resumeAutomation('user-1', redis);
    expect(redis.del).toHaveBeenCalledWith('automation_paused:user-1');
  });

  it('isAutomationPaused returns false after resumeAutomation', async () => {
    const redis = createMockRedis();
    await pauseAutomation('user-1', redis);
    await resumeAutomation('user-1', redis);
    const paused = await isAutomationPaused('user-1', redis);
    expect(paused).toBe(false);
  });

  it('resumeAutomation on a non-paused user does not throw', async () => {
    const redis = createMockRedis();
    await expect(resumeAutomation('user-never-paused', redis)).resolves.toBeUndefined();
  });

  it('pause/resume state is isolated per userId', async () => {
    const redis = createMockRedis();
    await pauseAutomation('user-A', redis);

    const pausedA = await isAutomationPaused('user-A', redis);
    const pausedB = await isAutomationPaused('user-B', redis);

    expect(pausedA).toBe(true);
    expect(pausedB).toBe(false);
  });

  it('uses correct Redis key format: automation_paused:{userId}', async () => {
    const redis = createMockRedis();
    await pauseAutomation('abc-123', redis);
    expect(redis.set).toHaveBeenCalledWith('automation_paused:abc-123', '1');

    await isAutomationPaused('abc-123', redis);
    expect(redis.get).toHaveBeenCalledWith('automation_paused:abc-123');

    await resumeAutomation('abc-123', redis);
    expect(redis.del).toHaveBeenCalledWith('automation_paused:abc-123');
  });
});
