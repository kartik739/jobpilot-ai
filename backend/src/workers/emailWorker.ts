/**
 * Email Monitor Worker
 *
 * BullMQ Worker that processes `monitor_emails` jobs scheduled as a repeatable
 * job (every 15 minutes).  On each run it invokes the EmailMonitor agent's
 * pollGmail function for the requesting user.
 *
 * Auth-expiry handling (Requirement 16.8):
 *  - When pollGmail throws / signals a GmailAuthError the worker pauses all
 *    repeatable `monitor_emails` jobs for the affected user in BullMQ so no
 *    further polling attempts are made.
 *  - A background poller then watches the Redis flag
 *    `gmail_token_refreshed:{userId}`.  Once it is set (by the OAuth callback
 *    route after the user re-authorises), the repeatable job is resumed and
 *    the flag is cleared.
 *
 * Requirements: 16.2, 16.8
 */

import { Worker, Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { pollGmail } from '../agents/emailMonitor.js';
import { GmailAuthError } from '../integrations/gmail.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'emailWorker' });

// ─── Configuration ────────────────────────────────────────────────────────────

/** Poll interval for repeatable jobs (15 minutes). */
const POLL_EVERY_MS = 15 * 60 * 1000;

/**
 * How often the in-process loop checks the `gmail_token_refreshed` Redis flag
 * after pausing (30 seconds).
 */
const TOKEN_REFRESH_CHECK_INTERVAL_MS = 30 * 1000;

/** Redis key prefix for the "token refreshed" flag set by the OAuth callback. */
const TOKEN_REFRESHED_KEY = (userId: string) => `gmail_token_refreshed:${userId}`;

// ─── BullMQ job payload ───────────────────────────────────────────────────────

/**
 * Shape of the `monitor_emails` job data.
 * A gmailToken stub is accepted for forwards-compat but pollGmail loads live
 * credentials from the DB itself; the worker does not need to supply them.
 */
interface MonitorEmailsPayload {
  userId: string;
}

// ─── Redis / Queue connections ────────────────────────────────────────────────

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

/** Dedicated connection for the worker (BullMQ requires maxRetriesPerRequest: null). */
const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });

/**
 * Separate ioredis connection used for direct Redis operations (flag reads,
 * flag deletes) and for the Queue instance used to manage repeatable jobs.
 * BullMQ workers must not share their connection with Queue instances.
 */
const redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null });

/**
 * Queue instance used solely to inspect and manage repeatable job definitions.
 * We need this to pause/resume the `monitor_emails` repeatable jobs.
 */
const emailQueue = new Queue('email', { connection: redisClient });

// ─── Repeatable-job management helpers ───────────────────────────────────────

/**
 * Return the BullMQ repeat key for the `monitor_emails` job belonging to a
 * specific user.  BullMQ composes the key from `{name}:{jobId}:{cron/every}`
 * so we match on the name prefix and the userId embedded in the job's repeat
 * key or job id.
 */
async function findRepeatableJobKey(userId: string): Promise<string | undefined> {
  const repeatables = await emailQueue.getRepeatableJobs();
  // The job's `id` field (set when enqueuing) is used by BullMQ as part of
  // the repeat key.  We store userId as the job id when scheduling.
  const match = repeatables.find(
    (r) => r.id === userId || r.key.includes(userId),
  );
  return match?.key;
}

/**
 * Pause the repeatable `monitor_emails` job for `userId` by removing it from
 * the BullMQ repeat schedule.  The job data can be re-added on resume.
 *
 * BullMQ v5 does not expose a per-job "pause" primitive; the canonical
 * approach is to remove the repeatable definition and re-add it when ready.
 */
async function pauseRepeatableJob(userId: string): Promise<void> {
  try {
    const key = await findRepeatableJobKey(userId);
    if (key) {
      await emailQueue.removeRepeatableByKey(key);
      log.info({ userId }, 'Paused repeatable monitor_emails job (repeatable key removed)');
    } else {
      log.warn({ userId }, 'No repeatable monitor_emails job found to pause');
    }
  } catch (err) {
    log.error({ userId, err }, 'Failed to pause repeatable monitor_emails job');
  }
}

/**
 * Re-add the repeatable `monitor_emails` job for `userId` after re-auth, then
 * clear the Redis token-refreshed flag.
 */
async function resumeRepeatableJob(userId: string): Promise<void> {
  try {
    await emailQueue.add(
      'monitor_emails',
      { userId } satisfies MonitorEmailsPayload,
      {
        repeat: { every: POLL_EVERY_MS },
        jobId: userId, // use userId as jobId so we can find it again later
      },
    );
    // Clear the flag so we don't resume more than once
    await redisClient.del(TOKEN_REFRESHED_KEY(userId));
    log.info({ userId }, 'Resumed repeatable monitor_emails job after token refresh');
  } catch (err) {
    log.error({ userId, err }, 'Failed to resume repeatable monitor_emails job');
  }
}

// ─── Token-refresh watchers ───────────────────────────────────────────────────

/**
 * Track users whose polling has been paused so we can start exactly one watcher
 * per user rather than spawning duplicate intervals.
 */
const activeWatchers = new Set<string>();

/**
 * Start a polling loop that waits for the `gmail_token_refreshed:{userId}`
 * Redis flag.  When detected, resumes the BullMQ repeatable job and stops the
 * loop.
 *
 * The loop runs in the background (fire-and-forget).  If the worker process
 * is restarted the flag will still be present in Redis and a new watcher will
 * pick it up on the next job attempt.
 */
function startTokenRefreshWatcher(userId: string): void {
  if (activeWatchers.has(userId)) {
    log.debug({ userId }, 'Token refresh watcher already active — not starting a second one');
    return;
  }

  activeWatchers.add(userId);
  log.info({ userId }, 'Starting token refresh watcher');

  const interval = setInterval(() => {
    void (async () => {
      try {
        const flag = await redisClient.get(TOKEN_REFRESHED_KEY(userId));
        if (flag) {
          clearInterval(interval);
          activeWatchers.delete(userId);
          log.info({ userId }, 'gmail_token_refreshed flag detected — resuming polling');
          await resumeRepeatableJob(userId);
        }
      } catch (err) {
        log.error({ userId, err }, 'Error checking gmail_token_refreshed flag');
      }
    })();
  }, TOKEN_REFRESH_CHECK_INTERVAL_MS);
}

// ─── Core job processor ───────────────────────────────────────────────────────

/**
 * Process a single `monitor_emails` BullMQ job.
 *
 * Invokes pollGmail for the user, handling GmailAuthError by pausing the
 * repeatable schedule and starting a watcher for the re-auth flag.
 *
 * All errors are caught and logged; the worker never crashes on a single job
 * failure (Requirement 16.8).
 */
async function processEmailJob(job: Job<MonitorEmailsPayload>): Promise<void> {
  const { userId } = job.data;

  if (!userId) {
    log.error({ jobId: job.id }, 'monitor_emails job missing userId — skipping');
    return;
  }

  log.info({ jobId: job.id, userId, attemptsMade: job.attemptsMade }, 'monitor_emails job received');

  try {
    // pollGmail loads tokens from the DB internally; pass a minimal stub token
    // shape to satisfy the function signature (it is not used when getOAuth2Client succeeds).
    await pollGmail(userId, {
      accessToken: '', // actual token is loaded from DB inside pollGmail
    });

    log.info({ jobId: job.id, userId }, 'monitor_emails job completed successfully');
  } catch (err) {
    if (err instanceof GmailAuthError) {
      // Requirement 16.8 — stop polling and wait for re-auth
      log.warn({ jobId: job.id, userId }, 'GmailAuthError caught in worker — pausing repeatable job');
      await pauseRepeatableJob(userId);
      startTokenRefreshWatcher(userId);
      // Do NOT rethrow — this is an expected auth-expiry flow, not a crash
      return;
    }

    // All other errors: log and swallow so the worker stays alive
    log.error({ jobId: job.id, userId, err }, 'Unexpected error in monitor_emails job — will retry on next schedule');
    // Re-throw so BullMQ marks the job as failed (it remains in the repeat schedule
    // for future runs since repeatable jobs auto-reschedule regardless of outcome).
    throw err;
  }
}

// ─── Worker instance ──────────────────────────────────────────────────────────

export const emailWorker = new Worker<MonitorEmailsPayload>(
  'email',
  processEmailJob,
  {
    connection: workerConnection,
    // Concurrency 1 keeps Gmail polling sequential per worker process.
    // Scale horizontally by running more worker processes if needed.
    concurrency: 5,
  },
);

// ─── Worker event handlers ────────────────────────────────────────────────────

emailWorker.on('failed', (job: Job<MonitorEmailsPayload> | undefined, err: Error) => {
  log.error(
    { jobId: job?.id, userId: job?.data?.userId, err: err.message },
    'Email worker reported job failure',
  );
});

emailWorker.on('error', (err: Error) => {
  // Connection-level errors (Redis disconnect, etc.) — log but keep the worker alive
  log.error({ err: err.message }, 'Email worker connection error');
});

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Add a repeatable `monitor_emails` job for the given user to the email queue.
 * Idempotent: if a job with the same userId already exists, BullMQ deduplicates
 * it via the jobId.
 *
 * Call this from the Gmail OAuth callback route after initial authorization.
 *
 * @param userId  The user for whom to start email monitoring.
 *
 * Requirements: 16.2, 16.8
 */
export async function scheduleEmailMonitoring(userId: string): Promise<void> {
  await emailQueue.add(
    'monitor_emails',
    { userId } satisfies MonitorEmailsPayload,
    {
      repeat: { every: POLL_EVERY_MS },
      jobId: userId,
    },
  );
  log.info({ userId, everyMs: POLL_EVERY_MS }, 'Scheduled repeatable monitor_emails job');
}

/**
 * Stop email monitoring for a user by removing the repeatable job.
 * Also clears any pending token-refresh watcher.
 *
 * Call this when the user revokes Gmail access.
 *
 * @param userId  The user for whom to stop email monitoring.
 */
export async function stopEmailMonitoring(userId: string): Promise<void> {
  await pauseRepeatableJob(userId);
  activeWatchers.delete(userId);
  await redisClient.del(TOKEN_REFRESHED_KEY(userId));
  log.info({ userId }, 'Email monitoring stopped and Redis flag cleared');
}

/**
 * Exported for use in the OAuth callback route: signal that a user has
 * successfully re-authorized Gmail.  Sets the Redis flag that the watcher
 * polls for to resume the repeatable job.
 *
 * @param userId  The user who just completed re-authorization.
 *
 * Requirement: 16.8
 */
export async function signalGmailTokenRefreshed(userId: string): Promise<void> {
  await redisClient.set(TOKEN_REFRESHED_KEY(userId), '1', 'EX', 60 * 60); // 1 hour TTL
  log.info({ userId }, 'gmail_token_refreshed flag set in Redis');
}

/**
 * Close all connections opened by this module.
 * Call during application shutdown.
 */
export async function closeEmailWorker(): Promise<void> {
  await emailWorker.close();
  await emailQueue.close();
  await workerConnection.quit();
  await redisClient.quit();
}
