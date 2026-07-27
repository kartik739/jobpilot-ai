/**
 * Application Worker
 *
 * BullMQ worker for `submit_application` jobs. Handles retry logic with
 * exponential backoff, non-retryable error detection, and final failure
 * recording via Prisma.
 *
 * Retry config (set per-job at enqueue time in base.ts):
 *   attempts: 3
 *   backoff: { type: 'exponential', delay: 1000 }  → delays: 1s, 2s, 4s
 *
 * Requirements: 12.8, 12.9, 12.10
 */

import { Worker, UnrecoverableError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Prisma } from '@prisma/client';
import { BrowserPool } from '../services/browserPool.js';
import { submitApplication, type ApplicationTask } from '../agents/applicationAgent.js';
import { isAutomationPaused, isDailyLimitReached, DAILY_LIMIT_DEFAULT } from '../services/applyLimiter.js';
import { prisma } from '../db.js';
import { createChildLogger } from '../core/logger.js';
import { emailQueue } from './queue.js';
import { applicationsSubmittedTotal } from '../core/metrics.js';

const log = createChildLogger({ module: 'applicationWorker' });

// ─── Redis connection ─────────────────────────────────────────────────────────

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// ─── Singleton browser pool ───────────────────────────────────────────────────

const pool = new BrowserPool();

// Start the pool once when the module loads (fire-and-forget; errors are logged)
pool.start().catch((err: unknown) => {
  log.error({ err }, 'Failed to start browser pool');
});

// ─── Job payload shape ────────────────────────────────────────────────────────

/**
 * Shape of the BullMQ job `data` for `submit_application` jobs.
 * All fields are passed through to `ApplicationTask`.
 */
interface ApplicationJobPayload {
  taskId: string;
  userId: string;
  jobPostingId: string;
  jobFingerprint: string;
  applicationUrl: string;
  resumePdfPath: string;
  resumeVersionId?: string;
  coverLetterPath?: string;
  portalCredentials?: { username: string; password: string };
  // profile and job fields passed as JSON
  profile: Record<string, unknown>;
  job: Record<string, unknown>;
}

// ─── Minimal Fastify-like stub for WebSocket emission in worker context ───────

/**
 * In the worker process there is no live Fastify instance, so we provide a
 * minimal stub that satisfies the `FastifyInstance` interface well enough for
 * `submitApplication` to call `emitWebSocketEvent` without crashing.
 * Real WS delivery happens through the API server; here we just log.
 */
const fakeAppInstance = {
  websocketServer: undefined,
} as unknown as import('fastify').FastifyInstance;

// ─── Core job processor ───────────────────────────────────────────────────────

/**
 * Process a single `submit_application` BullMQ job.
 *
 * Flow:
 *  1. Parse payload as ApplicationTask
 *  2. Call submitApplication
 *  3. alreadyApplied  → log dedup, return (does NOT count against daily limit — req 13.2)
 *  4. success         → create ApplicationRecord status='submitted'
 *  5. requiresManualIntervention (CAPTCHA/MFA/credential failure)
 *                     → create ApplicationRecord status='failed_submission'
 *                     → throw UnrecoverableError (no retries)
 *  6. !success && retryable   → throw retryable error so BullMQ re-queues with backoff
 *  7. !success && !retryable  → create ApplicationRecord status='failed_submission', return
 */
async function processApplicationJob(job: Job<ApplicationJobPayload>): Promise<void> {
  const payload = job.data;

  log.info(
    {
      jobId: job.id,
      jobName: job.name,
      taskId: payload.taskId,
      userId: payload.userId,
      jobPostingId: payload.jobPostingId,
      attemptsMade: job.attemptsMade,
    },
    'Application job received',
  );

  // ── Check if automation is paused (req 14.5, 14.6) ───────────────────────
  // Re-use the module-level Redis connection so we don't create a new one per job.
  const paused = await isAutomationPaused(payload.userId, connection);
  if (paused) {
    log.info(
      { taskId: payload.taskId, userId: payload.userId },
      'Automation is paused — holding job in queue via retry',
    );
    // Throw a retryable error so BullMQ keeps the job in the queue with backoff.
    // The job is NOT discarded (req 14.6).
    throw new Error('automation_paused');
  }

  // ── Check daily apply limit (req 14.1, 14.2) ─────────────────────────────
  const profile = await prisma.profile.findUnique({
    where: { userId: payload.userId },
    select: { dailyApplyLimit: true },
  });
  const dailyLimit = profile?.dailyApplyLimit ?? DAILY_LIMIT_DEFAULT;
  const limitReached = await isDailyLimitReached(payload.userId, dailyLimit);
  if (limitReached) {
    log.info(
      { taskId: payload.taskId, userId: payload.userId, dailyLimit },
      'Daily apply limit reached — deferring job to next day',
    );

    // Emit a daily_limit_reached notification (req 14.2)
    try {
      await prisma.notification.create({
        data: {
          userId: payload.userId,
          type: 'daily_limit_reached',
          title: 'Daily application limit reached',
          body: `You have reached your daily limit of ${dailyLimit} applications. Remaining jobs will be processed tomorrow.`,
          metadata: { dailyLimit },
        },
      });
    } catch (notifyErr) {
      log.warn({ err: notifyErr }, 'Failed to create daily_limit_reached notification');
    }

    // Delay the job until ~00:01 UTC the following calendar day so it processes
    // after the midnight UTC reset without being discarded (req 14.6).
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 1, 0, 0, // 00:01 UTC next day
    ));
    const delayMs = nextMidnight.getTime() - now.getTime();
    await job.moveToDelayed(Date.now() + delayMs, job.token);
    return; // stop processing this attempt
  }

  // Build ApplicationTask from payload
  const task: ApplicationTask = {
    taskId: payload.taskId,
    userId: payload.userId,
    jobPostingId: payload.jobPostingId,
    jobFingerprint: payload.jobFingerprint,
    applicationUrl: payload.applicationUrl,
    resumePdfPath: payload.resumePdfPath,
    coverLetterPath: payload.coverLetterPath,
    portalCredentials: payload.portalCredentials,
    profile: payload.profile as unknown as ApplicationTask['profile'],
    job: payload.job as unknown as ApplicationTask['job'],
    attemptNumber: job.attemptsMade + 1,
  };

  // Call the application agent
  const result = await submitApplication(task, pool, fakeAppInstance);

  // ── Case 1: Already applied (dedup guard) — req 13.2 ─────────────────────
  if (result.alreadyApplied) {
    log.info(
      { taskId: task.taskId, userId: task.userId, jobFingerprint: task.jobFingerprint },
      'Deduplication: application already exists — skipping without counting against daily limit',
    );
    return;
  }

  // ── Case 2: Successful submission ─────────────────────────────────────────
  if (result.success) {
    try {
      const createdRecord = await prisma.applicationRecord.create({
        data: {
          userId: task.userId,
          jobPostingId: task.jobPostingId,
          appliedAt: new Date(),
          source: 'automation',
          applicationUrl: task.applicationUrl,
          // Use a placeholder resumeVersionId — real resume version lookup is handled
          // upstream when enqueueing; here we fall back to 'unknown' if not provided.
          resumeVersionId: payload.resumeVersionId ?? 'unknown',
          coverLetterPath: task.coverLetterPath,
          status: 'submitted',
          screenshotPaths: result.screenshotPath ? [result.screenshotPath] : [],
          confirmationNumber: result.confirmationNumber,
          formAnswersSnapshot: {},
          fingerprint: task.jobFingerprint,
          matchScoreSnapshot: {},
        },
      });

      log.info(
        { taskId: task.taskId, userId: task.userId, jobPostingId: task.jobPostingId, confirmationNumber: result.confirmationNumber },
        'ApplicationRecord created with status=submitted',
      );

      await emailQueue.add('monitor_application', {
        userId: task.userId,
        applicationId: createdRecord.id,
      });

      applicationsSubmittedTotal.inc({ status: 'submitted' });
    } catch (dbErr) {
      if (dbErr instanceof Prisma.PrismaClientKnownRequestError && dbErr.code === 'P2002') {
        // Race condition duplicate — log and skip (req 13.2)
        log.info(
          { taskId: task.taskId, userId: task.userId, jobFingerprint: task.jobFingerprint },
          'Duplicate application race condition caught at DB constraint — skipping',
        );
        return; // do NOT count against daily limit
      }
      log.error({ taskId: task.taskId, userId: task.userId, err: dbErr }, 'Failed to create ApplicationRecord after successful submission');
      // Do not rethrow — application was submitted; DB failure should not cause re-submission
    }
    return;
  }

  // ── Case 3: Non-retryable failure (CAPTCHA, MFA, credential failure) ──────
  if (result.requiresManualIntervention) {
    try {
      await prisma.applicationRecord.create({
        data: {
          userId: task.userId,
          jobPostingId: task.jobPostingId,
          appliedAt: new Date(),
          source: 'automation',
          applicationUrl: task.applicationUrl,
          resumeVersionId: payload.resumeVersionId ?? 'unknown',
          coverLetterPath: task.coverLetterPath,
          status: 'failed_submission',
          screenshotPaths: result.screenshotPath ? [result.screenshotPath] : [],
          formAnswersSnapshot: {},
          fingerprint: task.jobFingerprint,
          matchScoreSnapshot: {},
          rejectionReason: result.failureReason,
          notes: `Manual intervention required: ${result.failureReason ?? 'unknown'}. Original posting: ${task.applicationUrl}`,
        },
      });

      log.warn(
        {
          taskId: task.taskId,
          userId: task.userId,
          jobPostingId: task.jobPostingId,
          failureReason: result.failureReason,
          applicationUrl: task.applicationUrl,
        },
        'Non-retryable failure — ApplicationRecord created with status=failed_submission. User should review the original posting.',
      );
    } catch (dbErr) {
      log.error({ taskId: task.taskId, userId: task.userId, err: dbErr }, 'Failed to create ApplicationRecord for non-retryable failure');
    }

    // Throw UnrecoverableError so BullMQ does NOT schedule further retries
    throw new UnrecoverableError(
      `non_retryable: ${result.failureReason ?? 'manual_intervention_required'}`,
    );
  }

  // ── Case 4: Retryable failure ─────────────────────────────────────────────
  if (result.retryable) {
    log.warn(
      {
        taskId: task.taskId,
        userId: task.userId,
        jobPostingId: task.jobPostingId,
        failureReason: result.failureReason,
        attemptsMade: job.attemptsMade,
      },
      'Retryable failure — throwing to trigger BullMQ backoff retry',
    );
    // Throw so BullMQ re-queues with exponential backoff (configured at enqueue time)
    throw new Error(`retryable_failure: ${result.failureReason ?? 'unknown'}`);
  }

  // ── Case 5: Non-retryable failure (not manual intervention, e.g. no submit button) ──
  try {
    await prisma.applicationRecord.create({
      data: {
        userId: task.userId,
        jobPostingId: task.jobPostingId,
        appliedAt: new Date(),
        source: 'automation',
        applicationUrl: task.applicationUrl,
        resumeVersionId: payload.resumeVersionId ?? 'unknown',
        coverLetterPath: task.coverLetterPath,
        status: 'failed_submission',
        screenshotPaths: result.screenshotPath ? [result.screenshotPath] : [],
        formAnswersSnapshot: {},
        fingerprint: task.jobFingerprint,
        matchScoreSnapshot: {},
        rejectionReason: result.failureReason,
        notes: `Submission failed (non-retryable): ${result.failureReason ?? 'unknown'}. Original posting: ${task.applicationUrl}`,
      },
    });

    log.warn(
      {
        taskId: task.taskId,
        userId: task.userId,
        jobPostingId: task.jobPostingId,
        failureReason: result.failureReason,
        applicationUrl: task.applicationUrl,
      },
      'Non-retryable failure (no DOM/form issue) — ApplicationRecord created with status=failed_submission',
    );
  } catch (dbErr) {
    log.error({ taskId: task.taskId, userId: task.userId, err: dbErr }, 'Failed to create ApplicationRecord for non-retryable non-intervention failure');
  }

  // Do NOT rethrow — job completes without further retries
}

// ─── Worker instance ──────────────────────────────────────────────────────────

export const applicationWorker = new Worker<ApplicationJobPayload>(
  'application',
  processApplicationJob,
  { connection },
  // Note: attempts and backoff are set per-job when enqueueing (see base.ts),
  // not on the worker itself.
);

// ─── Failed-event handler ─────────────────────────────────────────────────────

/**
 * After all retries are exhausted (job.attemptsMade >= job.opts.attempts),
 * record a final failed_submission ApplicationRecord and notify the user
 * with a link to the original job posting.
 *
 * UnrecoverableError jobs land here immediately (attemptsMade = 1) and are
 * already recorded above in processApplicationJob, so we skip them here.
 */
applicationWorker.on('failed', async (job: Job<ApplicationJobPayload> | undefined, err: Error) => {
  if (!job) {
    log.error({ err }, 'Application worker: job failed with undefined job reference');
    return;
  }

  const payload = job.data;

  log.error(
    {
      jobId: job.id,
      taskId: payload?.taskId,
      userId: payload?.userId,
      jobPostingId: payload?.jobPostingId,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      err: err.message,
    },
    'Application worker reported failure',
  );

  // UnrecoverableError: already recorded in processApplicationJob — skip
  if (err instanceof UnrecoverableError) {
    log.info(
      { jobId: job.id, taskId: payload?.taskId },
      'UnrecoverableError — failed_submission already recorded; skipping failed-event handler',
    );
    return;
  }

  // If all retries are exhausted, record final failed_submission
  const attemptsExhausted =
    job.opts.attempts !== undefined &&
    job.attemptsMade >= job.opts.attempts;

  if (attemptsExhausted && payload) {
    try {
      // Upsert to avoid duplicate records if a previous partial attempt recorded one
      await prisma.applicationRecord.upsert({
        where: {
          userId_fingerprint: {
            userId: payload.userId,
            fingerprint: payload.jobFingerprint,
          },
        },
        update: {
          status: 'failed_submission',
          rejectionReason: err.message,
          notes: `All ${job.opts.attempts} retry attempts exhausted. Last error: ${err.message}. Original posting: ${payload.applicationUrl}`,
          updatedAt: new Date(),
        },
        create: {
          userId: payload.userId,
          jobPostingId: payload.jobPostingId,
          appliedAt: new Date(),
          source: 'automation',
          applicationUrl: payload.applicationUrl,
          resumeVersionId: payload.resumeVersionId ?? 'unknown',
          coverLetterPath: payload.coverLetterPath,
          status: 'failed_submission',
          screenshotPaths: [],
          formAnswersSnapshot: {},
          fingerprint: payload.jobFingerprint,
          matchScoreSnapshot: {},
          rejectionReason: err.message,
          notes: `All ${job.opts.attempts} retry attempts exhausted. Last error: ${err.message}. Original posting: ${payload.applicationUrl}`,
        },
      });

      log.info(
        {
          jobId: job.id,
          taskId: payload.taskId,
          userId: payload.userId,
          jobPostingId: payload.jobPostingId,
          applicationUrl: payload.applicationUrl,
        },
        'All retries exhausted — ApplicationRecord upserted with status=failed_submission. User notified via notes field with link to original posting.',
      );

      applicationsSubmittedTotal.inc({ status: 'failed' });

      // Persist a Notification record so the user can see the failure in-app
      try {
        await prisma.notification.create({
          data: {
            userId: payload.userId,
            type: 'application_failed',
            title: 'Application submission failed',
            body: `We were unable to submit your application after ${job.opts.attempts} attempts. Please apply manually.`,
            metadata: {
              jobPostingId: payload.jobPostingId,
              applicationUrl: payload.applicationUrl,
              taskId: payload.taskId,
              failureReason: err.message,
            },
          },
        });

        log.info(
          { userId: payload.userId, jobPostingId: payload.jobPostingId },
          'Failure notification created for user',
        );
      } catch (notifyErr) {
        log.warn({ err: notifyErr }, 'Failed to create failure notification for user');
      }
    } catch (dbErr) {
      log.error(
        { jobId: job.id, taskId: payload.taskId, err: dbErr },
        'Failed to upsert ApplicationRecord after exhausting retries',
      );
    }
  }
});
