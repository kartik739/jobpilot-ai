import { Redis } from 'ioredis';
import { prisma } from '../db.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'applyLimiter' });

export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 50;
export const DAILY_LIMIT_DEFAULT = 10;

const PAUSE_KEY_PREFIX = 'automation_paused';

/**
 * Check if the user has reached their daily apply limit.
 * Returns true if the limit has been reached and no more applications should be queued today.
 *
 * Requirements: 14.1, 14.2
 */
export async function isDailyLimitReached(
  userId: string,
  dailyApplyLimit: number,
): Promise<boolean> {
  const limit = Math.max(DAILY_LIMIT_MIN, Math.min(DAILY_LIMIT_MAX, dailyApplyLimit));

  // Count applications submitted today (midnight UTC boundary)
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const count = await prisma.applicationRecord.count({
    where: {
      userId,
      appliedAt: { gte: todayStart, lte: todayEnd },
      status: { not: 'failed_submission' }, // don't count failed attempts
    },
  });

  const reached = count >= limit;
  if (reached) {
    log.info({ userId, count, limit }, 'Daily apply limit reached');
  }
  return reached;
}

/**
 * Get the count of applications submitted today for a user.
 * Requirements: 14.1
 */
export async function getTodayApplicationCount(userId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  return prisma.applicationRecord.count({
    where: {
      userId,
      appliedAt: { gte: todayStart },
      status: { not: 'failed_submission' },
    },
  });
}

/**
 * Validate a daily apply limit value — must be an integer in [1, 50].
 * Throws if out of range; returns the validated value on success.
 * Requirements: 14.3
 */
export function validateDailyLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < DAILY_LIMIT_MIN || limit > DAILY_LIMIT_MAX) {
    throw new Error(
      `Daily apply limit must be an integer between ${DAILY_LIMIT_MIN} and ${DAILY_LIMIT_MAX}`,
    );
  }
  return limit;
}

/**
 * Pause automation for a user by setting a Redis key.
 * Queued jobs remain in BullMQ queue but will not be processed while paused.
 * Requirements: 14.4, 14.5, 14.6
 */
export async function pauseAutomation(userId: string, redis: Redis): Promise<void> {
  await redis.set(`${PAUSE_KEY_PREFIX}:${userId}`, '1');
  log.info({ userId }, 'Automation paused for user');
}

/**
 * Resume automation for a user by deleting the pause Redis key.
 * Requirements: 14.4, 14.7
 */
export async function resumeAutomation(userId: string, redis: Redis): Promise<void> {
  await redis.del(`${PAUSE_KEY_PREFIX}:${userId}`);
  log.info({ userId }, 'Automation resumed for user');
}

/**
 * Check if automation is currently paused for a user.
 * Requirements: 14.5
 */
export async function isAutomationPaused(userId: string, redis: Redis): Promise<boolean> {
  const val = await redis.get(`${PAUSE_KEY_PREFIX}:${userId}`);
  return val !== null;
}
