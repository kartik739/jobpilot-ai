import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest: null on the ioredis connection
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const discoveryQueue = new Queue('discovery', { connection });
export const applicationQueue = new Queue('application', { connection });
export const emailQueue = new Queue('email', { connection });
export const analyticsQueue = new Queue('analytics', { connection });
export const rankingQueue = new Queue('ranking', { connection });

/**
 * Gracefully close all queue connections.
 * Call this during application shutdown to avoid hanging processes.
 */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    discoveryQueue.close(),
    applicationQueue.close(),
    emailQueue.close(),
    analyticsQueue.close(),
    rankingQueue.close(),
  ]);
  await connection.quit();
}
