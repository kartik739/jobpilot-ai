/**
 * Analytics API routes
 *
 * GET /api/analytics/summary        — KPI summary (total apps, rates, pending)
 * GET /api/analytics/sources        — application counts by source platform
 * GET /api/analytics/stack          — application counts by tech stack / skill
 * GET /api/analytics/keywords       — keyword effectiveness
 * GET /api/analytics/resume-versions — resume version performance
 * GET /api/analytics/weekly-trend   — last 12 weeks application counts
 *
 * All endpoints accept a `?days=30` query param (default 30, max 365).
 * All endpoints require authentication.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.5, 20.6, 20.8
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth.js';
import { analyticsAgent } from '../../agents/analytics.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/**
 * Parse the `days` query parameter, clamping to [1, 365].
 */
function parseDays(query: Record<string, string | undefined>): number {
  const raw = parseInt(query['days'] ?? String(DEFAULT_DAYS), 10);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_DAYS;
  return Math.min(raw, MAX_DAYS);
}

/**
 * Build a { startDate, endDate } period from the `days` param.
 */
function buildPeriodFromDays(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 86_400_000);
  return { startDate, endDate };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/analytics/summary ─────────────────────────────────────────────
  app.get(
    '/api/analytics/summary',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const days = parseDays(request.query as Record<string, string | undefined>);
      const period = buildPeriodFromDays(days);
      const summary = await analyticsAgent.getApplicationSummary(userId, period);
      return reply.status(200).send(summary);
    },
  );

  // ── GET /api/analytics/sources ─────────────────────────────────────────────
  app.get(
    '/api/analytics/sources',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const sources = await analyticsAgent.getSourcePerformance(userId);
      return reply.status(200).send({ sources });
    },
  );

  // ── GET /api/analytics/stack ───────────────────────────────────────────────
  app.get(
    '/api/analytics/stack',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const stack = await analyticsAgent.getStackPerformance(userId);
      return reply.status(200).send({ stack });
    },
  );

  // ── GET /api/analytics/keywords ────────────────────────────────────────────
  app.get(
    '/api/analytics/keywords',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const keywords = await analyticsAgent.getKeywordEffectiveness(userId);
      return reply.status(200).send({ keywords });
    },
  );

  // ── GET /api/analytics/resume-versions ────────────────────────────────────
  app.get(
    '/api/analytics/resume-versions',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const resumeVersions = await analyticsAgent.getResumeVersionPerformance(userId);
      return reply.status(200).send({ resumeVersions });
    },
  );

  // ── GET /api/analytics/weekly-trend ───────────────────────────────────────
  app.get(
    '/api/analytics/weekly-trend',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const trend = await analyticsAgent.getWeeklyTrend(userId);
      return reply.status(200).send({ trend });
    },
  );
}
