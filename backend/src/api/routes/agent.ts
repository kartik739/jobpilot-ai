import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { authenticate } from '../../core/auth.js';
import {
  pauseAutomation,
  resumeAutomation,
  isAutomationPaused,
  getTodayApplicationCount,
  DAILY_LIMIT_DEFAULT,
} from '../../services/applyLimiter.js';
import { prisma } from '../../db.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ module: 'agentRoutes' });

/**
 * Agent control routes: pause/resume automation and status.
 * Requirements: 14.4, 14.5, 14.6, 14.7
 */
export async function agentRoutes(
  app: FastifyInstance,
  options: { redis: Redis },
): Promise<void> {
  const { redis } = options;

  /**
   * POST /api/agent/pause
   * Pause automation for the authenticated user.
   * Queued jobs remain in BullMQ queue but are not processed while paused.
   * Requirements: 14.4, 14.5, 14.6
   */
  app.post(
    '/api/agent/pause',
    { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.id;

      try {
        await pauseAutomation(userId, redis);
        log.info({ userId }, 'Automation paused via API');

        return reply.code(200).send({
          paused: true,
          message:
            'Automation paused. Queued applications will be held and processed when you resume.',
        });
      } catch (err) {
        log.error({ userId, err }, 'Failed to pause automation');
        return reply.code(500).send({ error: 'Failed to pause automation' });
      }
    },
  );

  /**
   * POST /api/agent/resume
   * Resume automation for the authenticated user.
   * Returns remaining daily quota so the caller knows how many jobs will process.
   * Requirements: 14.4, 14.7
   */
  app.post(
    '/api/agent/resume',
    { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.id;

      try {
        await resumeAutomation(userId, redis);

        const [todayCount, profile] = await Promise.all([
          getTodayApplicationCount(userId),
          prisma.profile.findUnique({
            where: { userId },
            select: { dailyApplyLimit: true },
          }),
        ]);

        const limit = profile?.dailyApplyLimit ?? DAILY_LIMIT_DEFAULT;
        const remaining = Math.max(0, limit - todayCount);

        log.info({ userId, todayCount, remaining }, 'Automation resumed via API');

        return reply.code(200).send({
          paused: false,
          message: 'Automation resumed.',
          todayApplicationCount: todayCount,
          dailyLimit: limit,
          remainingToday: remaining,
        });
      } catch (err) {
        log.error({ userId, err }, 'Failed to resume automation');
        return reply.code(500).send({ error: 'Failed to resume automation' });
      }
    },
  );

  /**
   * GET /api/agent/status
   * Get the current automation status for the authenticated user.
   */
  app.get(
    '/api/agent/status',
    { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.id;

      try {
        const [paused, todayCount, profile] = await Promise.all([
          isAutomationPaused(userId, redis),
          getTodayApplicationCount(userId),
          prisma.profile.findUnique({
            where: { userId },
            select: { dailyApplyLimit: true },
          }),
        ]);

        const limit = profile?.dailyApplyLimit ?? DAILY_LIMIT_DEFAULT;
        const remaining = Math.max(0, limit - todayCount);

        return reply.code(200).send({
          paused,
          todayApplicationCount: todayCount,
          dailyLimit: limit,
          remainingToday: remaining,
          limitReached: remaining === 0,
        });
      } catch (err) {
        log.error({ userId, err }, 'Failed to get agent status');
        return reply.code(500).send({ error: 'Failed to get agent status' });
      }
    },
  );
}
