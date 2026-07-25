import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../core/logger.js';
import { prisma } from '../db.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// Known analytics event types
const KNOWN_EVENT_TYPES = new Set([
  'job_discovered',
  'application_submitted',
  'email_monitored',
  'cover_letter_generated',
  'resume_optimized',
  'interview_prep_generated',
]);

export interface AnalyticsJobPayload {
  eventType: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

async function processAnalyticsJob(job: Job<AnalyticsJobPayload>): Promise<void> {
  const { eventType, userId, metadata } = job.data;
  const jobLog = logger.child({ jobId: job.id, jobName: job.name, eventType, userId });

  jobLog.info({ metadata }, 'Analytics event received');

  // Handle unknown event types — log warning and complete without throwing (Req 16.4)
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    jobLog.warn({ eventType }, 'Unknown analytics event type — completing without processing');
    return;
  }

  // Persist aggregate: update AgentTask status counter (Req 16.2)
  if (userId) {
    try {
      await prisma.agentTask.updateMany({
        where: {
          type: eventType,
          userId,
          status: { not: 'completed' },
        },
        data: { status: 'completed', completedAt: new Date() },
      });
    } catch (err) {
      // Log but do not rethrow — analytics failure must not crash the worker (Req 16.4)
      jobLog.warn({ err }, 'Failed to update AgentTask aggregate — continuing');
    }
  }

  jobLog.info('Analytics event processed successfully');
}

export const analyticsWorker = new Worker<AnalyticsJobPayload>('analytics', processAnalyticsJob, { connection });

analyticsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Analytics worker reported failure');
});
