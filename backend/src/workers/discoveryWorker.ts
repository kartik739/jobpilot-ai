import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function processDiscoveryJob(job: Job): Promise<void> {
  logger.info({ jobId: job.id, jobName: job.name, data: job.data }, 'Discovery job received');

  try {
    // Stub — full implementation comes in later tasks
    logger.info({ jobId: job.id, jobName: job.name }, 'Discovery job completed');
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err }, 'Discovery job failed');
    throw err;
  }
}

export const discoveryWorker = new Worker('discovery', processDiscoveryJob, { connection });

discoveryWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Discovery worker reported failure');
});
