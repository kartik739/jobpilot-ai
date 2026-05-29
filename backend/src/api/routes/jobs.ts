/**
 * GET /api/jobs — Paginated, ranked job matches for the authenticated user.
 *
 * Query params:
 *   page    (default 1)    — 1-based page number
 *   limit   (default 20)   — results per page
 *   sortBy  (default 'matchScore') — sort field
 *
 * Response: { jobs: JobMatchWithPosting[], total: number, page: number, limit: number }
 *
 * Requirements: 8.1, 8.2
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/jobs ─────────────────────────────────────────────────────────
  app.get(
    '/api/jobs',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;

      // Parse and validate query params
      const query = request.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(query['page'] ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(query['limit'] ?? '20', 10) || 20));
      const skip = (page - 1) * limit;

      // Count total matches for the user
      const total = await prisma.jobMatch.count({
        where: { userId },
      });

      // Fetch paginated job matches joined with job posting data,
      // sorted descending by overall match score
      const matches = await prisma.jobMatch.findMany({
        where: { userId },
        orderBy: { overall: 'desc' },
        skip,
        take: limit,
        include: {
          jobPosting: true,
        },
      });

      // Shape each result to include all MatchScore fields + JobPosting fields
      const jobs = matches.map((m) => ({
        id: m.id,
        jobPostingId: m.jobPostingId,
        // Match score components
        overall: m.overall,
        skillMatch: m.skillMatch,
        experienceMatch: m.experienceMatch,
        locationMatch: m.locationMatch,
        salaryMatch: m.salaryMatch,
        technologyMatch: m.technologyMatch,
        workAuthMatch: m.workAuthMatch,
        successProbability: m.successProbability,
        disqualifiers: m.disqualifiers as string[],
        // Job posting fields
        company: m.jobPosting.company,
        title: m.jobPosting.title,
        description: m.jobPosting.description,
        descriptionHtml: m.jobPosting.descriptionHtml,
        location: m.jobPosting.location,
        isRemote: m.jobPosting.isRemote,
        isHybrid: m.jobPosting.isHybrid,
        requiredSkills: m.jobPosting.requiredSkills,
        preferredSkills: m.jobPosting.preferredSkills,
        yearsExperienceMin: m.jobPosting.yearsExperienceMin,
        yearsExperienceMax: m.jobPosting.yearsExperienceMax,
        salaryMin: m.jobPosting.salaryMin,
        salaryMax: m.jobPosting.salaryMax,
        currency: m.jobPosting.currency,
        employmentType: m.jobPosting.employmentType,
        applicationUrl: m.jobPosting.applicationUrl,
        platform: m.jobPosting.platform,
        fingerprint: m.jobPosting.fingerprint,
        status: m.jobPosting.status,
        discoveredAt: m.jobPosting.discoveredAt,
        createdAt: m.createdAt,
      }));

      return reply.status(200).send({ jobs, total, page, limit });
    },
  );
}
