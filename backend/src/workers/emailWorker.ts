import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

async function processEmailJob(job: Job): Promise<void> {
  logger.info({ jobId: job.id, jobName: job.name, data: job.data }, 'Email job received');

  try {
    // Stub — full implementation comes in later tasks
    logger.info({ jobId: job.id, jobName: job.name }, 'Email job completed');
  } catch (err) {
    logger.error({ jobId: job.id, jobName: job.name, err }, 'Email job failed');
    throw err;
  }
}

export const emailWorker = new Worker('email', processEmailJob, { connection });

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Email worker reported failure');
});
