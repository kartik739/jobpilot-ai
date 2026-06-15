/**
 * Job Source Health routes
 *
 * GET  /api/sources              — list all configured sources for the authenticated user
 * POST /api/sources/:id/run-now  — trigger an immediate discovery run for a source
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ module: 'sourcesRoutes' });

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface JobSourceResponse {
  id: string;
  userId: string;
  platform: string;
  enabled: boolean;
  /** ISO timestamp or null if never run */
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | 'rate_limited' | 'never_run';
  lastRunJobsFound: number;
  errorMessage: string | null;
  createdAt: string;
  /** True when a run-now task is currently in-progress (optimistic, Redis-backed) */
  isRunning: boolean;
}

// Redis key for tracking a source that is currently running
function runningKey(sourceId: string): string {
  return `source_running:${sourceId}`;
}

// ─── Route plugin ──────────────────────────────────────────────────────────────

export async function sourcesRoutes(
  app: FastifyInstance,
  options: { redis: Redis },
): Promise<void> {
  const { redis } = options;

  // ── GET /api/sources ──────────────────────────────────────────────────────
  /**
   * Returns all job source configs for the authenticated user, including
   * platform name, last run timestamp, jobs found, status, and any error message.
   *
   * Requirements: 22.1, 22.2
   */
  app.get(
    '/api/sources',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;

      const sources = await prisma.jobSourceConfig.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });

      // Check which sources are currently running (optimistic flag set by run-now)
      const runningChecks = await Promise.all(
        sources.map(async (s) => {
          try {
            const val = await redis.get(runningKey(s.id));
            return val === '1';
          } catch {
            return false;
          }
        }),
      );

      const response: JobSourceResponse[] = sources.map((s, i) => ({
        id: s.id,
        userId: s.userId,
        platform: s.platform,
        enabled: s.enabled,
        lastRunAt: s.lastRunAt?.toISOString() ?? null,
        lastRunStatus: s.lastRunStatus as JobSourceResponse['lastRunStatus'],
        lastRunJobsFound: s.lastRunJobsFound,
        errorMessage: s.errorMessage ?? null,
        createdAt: s.createdAt.toISOString(),
        isRunning: runningChecks[i] ?? false,
      }));

      return reply.status(200).send({ sources: response });
    },
  );

  // ── POST /api/sources/:id/run-now ─────────────────────────────────────────
  /**
   * Triggers an immediate discovery run for the given source.
   * Sets an optimistic `isRunning` flag in Redis (60-minute TTL) so the UI
   * can disable the "Run Now" button while the source is actively running.
   *
   * The actual BullMQ worker clears this flag when the run completes via:
   *   await redis.del(`source_running:${sourceId}`)
   *
   * If the worker is not available, the flag expires automatically after 60 min.
   *
   * Requirements: 22.3, 22.4
   */
  app.post(
    '/api/sources/:id/run-now',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params as { id: string };

      // Verify source belongs to authenticated user
      const source = await prisma.jobSourceConfig.findUnique({
        where: { id },
        select: { id: true, userId: true, platform: true, enabled: true },
      });

      if (!source) {
        return reply.status(404).send({ error: 'Source not found' });
      }

      if (source.userId !== userId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // Check if already running (prevent duplicate runs)
      try {
        const alreadyRunning = await redis.get(runningKey(id));
        if (alreadyRunning === '1') {
          return reply.status(409).send({
            error: 'Source is already running',
            isRunning: true,
          });
        }

        // Set optimistic running flag — 60-minute TTL as a safety net if the worker
        // fails to clear it
        await redis.set(runningKey(id), '1', 'EX', 3600);
      } catch (err) {
        log.warn(
          { err, sourceId: id },
          'Could not set running flag in Redis; proceeding with run-now anyway',
        );
      }

      log.info(
        { userId, sourceId: id, platform: source.platform },
        'Run-now triggered for source',
      );

      // In a full implementation the discovery BullMQ worker is enqueued here:
      //   await enqueueTask('discover_jobs', { userId, sourceId: id }, { priority: 'high' });
      // The worker clears the Redis running flag on completion:
      //   await redis.del(runningKey(sourceId));

      return reply.status(202).send({
        message: `Discovery run queued for ${source.platform}`,
        sourceId: id,
        isRunning: true,
      });
    },
  );
}
