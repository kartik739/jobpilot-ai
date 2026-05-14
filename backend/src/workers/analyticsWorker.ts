import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function processAnalyticsJob(job: Job): Promise<void> {
  logger.info({ jobId: job.id, jobName: job.name, data: job.data }, 'Analytics job received');

  try {
    // Stub — full implementation comes in later tasks
    logger.info({ jobId: job.id, jobName: job.name }, 'Analytics job completed');
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err }, 'Analytics job failed');
    throw err;
  }
}

export const analyticsWorker = new Worker('analytics', processAnalyticsJob, { connection });

analyticsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Analytics worker reported failure');
});
