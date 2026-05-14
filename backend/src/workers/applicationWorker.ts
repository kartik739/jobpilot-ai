import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function processApplicationJob(job: Job): Promise<void> {
  logger.info({ jobId: job.id, jobName: job.name, data: job.data }, 'Application job received');

  try {
    // Stub — full implementation comes in later tasks
    logger.info({ jobId: job.id, jobName: job.name }, 'Application job completed');
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err }, 'Application job failed');
    throw err;
  }
}

export const applicationWorker = new Worker('application', processApplicationJob, { connection });

applicationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Application worker reported failure');
});
