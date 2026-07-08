/**
 * Manual Job URL Override Routes
 *
 * POST /api/jobs/manual
 *   - Validate URL format (HTTP 400 on invalid)
 *   - Check fingerprint against existing records (return existing match score if duplicate)
 *   - Parse job description via standard pipeline
 *   - Compute and return match score to frontend
 *   - On parsing failure: return 422 with reason description
 *
 * POST /api/jobs/manual/:id/confirm
 *   - Validate user confirmation
 *   - Enqueue job for application via BullMQ applicationQueue
 *   - Return task ID
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { parseJobDescription } from '../../agents/discovery/parser.js';
import { computeFingerprint } from '../../agents/discovery/dedup.js';
import { computeMatchScore } from '../../agents/ranking/scorer.js';
import type { UserProfile } from '../../agents/ranking/scorer.js';
import { applicationQueue } from '../../workers/queue.js';
import type { RawJobPosting } from '../../agents/discovery/types.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

const SubmitManualJobSchema = z.object({
  url: z.string().url({ message: 'Invalid URL format' }),
});

const ConfirmManualJobSchema = z.object({
  confirmed: z.literal(true, { message: 'User must explicitly confirm' }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a UserProfile from the Prisma Profile record for the scorer.
 */
function buildUserProfile(
  profile: {
    workAuthorization: string[];
    requiresSponsorship: boolean;
    skills: Array<{ name: string }>;
    workExperiences: Array<{ startDate: Date; endDate: Date | null; isCurrent: boolean; skills: string[] }>;
    remotePreference: string;
    preferredLocations: string[];
    salaryMin: string | null;
    salaryMax: string | null;
    preferredCompanies: string[];
  },
): UserProfile {
  // Compute total years of experience from work history
  const now = new Date();
  const totalYearsExperience = profile.workExperiences.reduce((sum, exp) => {
    const end = exp.isCurrent ? now : (exp.endDate ?? now);
    const diffMs = end.getTime() - exp.startDate.getTime();
    return sum + diffMs / (1000 * 60 * 60 * 24 * 365.25);
  }, 0);

  // Aggregate all skills (profile skills + work experience skills)
  const allSkills = [
    ...profile.skills.map((s) => s.name),
    ...profile.workExperiences.flatMap((e) => e.skills),
  ];

  // Parse encrypted salary fields as numbers (stored as strings in schema)
  const salaryMin = profile.salaryMin ? parseFloat(profile.salaryMin) : undefined;
  const salaryMax = profile.salaryMax ? parseFloat(profile.salaryMax) : undefined;

  return {
    workAuthorization: profile.workAuthorization,
    requiresSponsorship: profile.requiresSponsorship,
    totalYearsExperience: Math.round(totalYearsExperience * 10) / 10,
    skills: allSkills,
    techStack: allSkills, // use same skills list as tech stack
    preferredLocations: profile.preferredLocations,
    remotePreference: (profile.remotePreference ?? 'flexible') as UserProfile['remotePreference'],
    salaryMin: Number.isNaN(salaryMin) ? undefined : salaryMin,
    salaryMax: Number.isNaN(salaryMax) ? undefined : salaryMax,
    preferredCompanies: profile.preferredCompanies,
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function manualJobRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/jobs/manual ─────────────────────────────────────────────────
  app.post(
    '/api/jobs/manual',
    { preHandler: authenticate },
    async (request, reply) => {
      // 1. Validate request body
      const result = SubmitManualJobSchema.safeParse(request.body);
      if (!result.success) {
        // Req 15.2: HTTP 400 for invalid URL format
        return reply.status(400).send({
          error: 'Invalid URL',
          details: result.error.flatten(),
        });
      }

      const { url } = result.data;
      const userId = request.user.id;

      // 2. Load user profile for scoring
      const profile = await prisma.profile.findUnique({
        where: { userId },
        include: {
          skills: true,
          workExperiences: true,
        },
      });

      if (!profile) {
        return reply.status(422).send({
          error: 'User profile not found. Please complete your profile before submitting jobs.',
        });
      }

      // 3. Compute fingerprint using only the URL (title/company unknown yet)
      //    We'll use empty strings for title/company since we haven't parsed yet.
      //    After parsing we recompute with actual values.
      const urlOnlyFingerprint = computeFingerprint('', '', url);

      // 4. Check for existing job posting by URL-only fingerprint OR by sourceUrl
      //    (Req 15.6: return existing match score if duplicate)
      const existingByUrl = await prisma.jobPosting.findFirst({
        where: { sourceUrl: url },
        include: {
          matches: {
            where: { userId },
            take: 1,
          },
        },
      });

      if (existingByUrl) {
        const existingMatch = existingByUrl.matches[0];
        if (existingMatch) {
          // Req 15.6: return existing match score without re-parsing
          return reply.status(200).send({
            jobPostingId: existingByUrl.id,
            duplicate: true,
            matchScore: {
              overall: existingMatch.overall,
              skillMatch: existingMatch.skillMatch,
              experienceMatch: existingMatch.experienceMatch,
              locationMatch: existingMatch.locationMatch,
              salaryMatch: existingMatch.salaryMatch,
              technologyMatch: existingMatch.technologyMatch,
              workAuthMatch: existingMatch.workAuthMatch,
              successProbability: existingMatch.successProbability,
              disqualifiers: existingMatch.disqualifiers as string[],
            },
            job: {
              id: existingByUrl.id,
              title: existingByUrl.title,
              company: existingByUrl.company,
              location: existingByUrl.location,
              isRemote: existingByUrl.isRemote,
              isHybrid: existingByUrl.isHybrid,
              description: existingByUrl.description,
              descriptionHtml: existingByUrl.descriptionHtml,
              requiredSkills: existingByUrl.requiredSkills,
              preferredSkills: existingByUrl.preferredSkills,
              yearsExperienceMin: existingByUrl.yearsExperienceMin,
              yearsExperienceMax: existingByUrl.yearsExperienceMax,
              salaryMin: existingByUrl.salaryMin,
              salaryMax: existingByUrl.salaryMax,
              currency: existingByUrl.currency,
              employmentType: existingByUrl.employmentType,
              applicationUrl: existingByUrl.applicationUrl,
            },
          });
        }
      }

      // 5. Fetch and parse the job description (Req 15.3)
      let htmlContent: string | undefined;
      try {
        const fetchResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; JobPilot/1.0)',
          },
          signal: AbortSignal.timeout(15_000),
        });

        if (!fetchResponse.ok) {
          return reply.status(422).send({
            error: `Failed to fetch job page: HTTP ${fetchResponse.status} ${fetchResponse.statusText}`,
            reason: 'fetch_failed',
          });
        }

        htmlContent = await fetchResponse.text();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(422).send({
          error: `Failed to fetch job page: ${message}`,
          reason: 'fetch_failed',
        });
      }

      const raw: RawJobPosting = {
        sourceUrl: url,
        platform: 'custom_url',
        discoveredAt: new Date(),
        rawJson: { url },
        rawHtml: htmlContent,
      };

      // 6. Parse job description via standard pipeline (Req 15.3)
      let parsed;
      try {
        parsed = await parseJobDescription(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Req 15.7: return 422 with reason on parsing failure
        return reply.status(422).send({
          error: `Job parsing failed: ${message}`,
          reason: 'parse_error',
        });
      }

      if (!parsed) {
        // Req 15.7: fewer than 3 extractable fields
        return reply.status(422).send({
          error:
            'Could not extract sufficient structured data from the job page. The page may require login or use a format our parser does not support.',
          reason: 'insufficient_data',
        });
      }

      // 7. Compute real fingerprint now that we have title + company
      const fingerprint = computeFingerprint(
        parsed.title ?? '',
        parsed.company ?? '',
        url,
      );

      // 8. Upsert JobPosting record
      const jobPosting = await prisma.jobPosting.upsert({
        where: { fingerprint },
        update: {}, // don't re-overwrite existing data
        create: {
          sourceUrl: url,
          platform: 'custom_url',
          fingerprint,
          company: parsed.company ?? 'Unknown',
          title: parsed.title ?? 'Unknown Position',
          description: (parsed.rawHtml ?? JSON.stringify(parsed.rawJson)).slice(0, 5000),
          descriptionHtml: parsed.rawHtml?.slice(0, 20000) ?? null,
          requiredSkills: parsed.requiredSkills ?? [],
          preferredSkills: parsed.preferredSkills ?? [],
          yearsExperienceMin: parsed.yearsExperienceMin ?? null,
          yearsExperienceMax: parsed.yearsExperienceMax ?? null,
          location: parsed.location ?? [],
          isRemote: parsed.isRemote ?? false,
          isHybrid: parsed.isHybrid ?? false,
          salaryMin: parsed.salaryMin ?? null,
          salaryMax: parsed.salaryMax ?? null,
          currency: parsed.currency ?? null,
          employmentType: parsed.employmentType ?? null,
          visaRequirements: parsed.visaRequirements ?? [],
          applicationDeadline: parsed.applicationDeadline ?? null,
          applicationUrl: parsed.applicationUrl ?? url,
          rawData: { url, parsedAt: new Date().toISOString() },
          status: parsed.status,
          discoveredAt: new Date(),
          parsedAt: new Date(),
        },
      });

      // 9. Compute match score (Req 15.4)
      const userProfile = buildUserProfile(profile);
      const matchScore = await computeMatchScore(parsed, userProfile);

      // 10. Upsert JobMatch record for this user
      await prisma.jobMatch.upsert({
        where: {
          userId_jobPostingId: { userId, jobPostingId: jobPosting.id },
        },
        update: {
          overall: matchScore.overall,
          skillMatch: matchScore.skillMatch,
          experienceMatch: matchScore.experienceMatch,
          locationMatch: matchScore.locationMatch,
          salaryMatch: matchScore.salaryMatch,
          technologyMatch: matchScore.technologyMatch,
          workAuthMatch: matchScore.workAuthMatch,
          successProbability: matchScore.successProbability,
          disqualifiers: matchScore.disqualifiers,
        },
        create: {
          userId,
          jobPostingId: jobPosting.id,
          overall: matchScore.overall,
          skillMatch: matchScore.skillMatch,
          experienceMatch: matchScore.experienceMatch,
          locationMatch: matchScore.locationMatch,
          salaryMatch: matchScore.salaryMatch,
          technologyMatch: matchScore.technologyMatch,
          workAuthMatch: matchScore.workAuthMatch,
          successProbability: matchScore.successProbability,
          disqualifiers: matchScore.disqualifiers,
        },
      });

      // 11. Return parsed job preview + match score to the frontend
      return reply.status(200).send({
        jobPostingId: jobPosting.id,
        duplicate: false,
        matchScore: {
          overall: matchScore.overall,
          skillMatch: matchScore.skillMatch,
          experienceMatch: matchScore.experienceMatch,
          locationMatch: matchScore.locationMatch,
          salaryMatch: matchScore.salaryMatch,
          technologyMatch: matchScore.technologyMatch,
          workAuthMatch: matchScore.workAuthMatch,
          successProbability: matchScore.successProbability,
          disqualifiers: matchScore.disqualifiers,
        },
        job: {
          id: jobPosting.id,
          title: jobPosting.title,
          company: jobPosting.company,
          location: jobPosting.location,
          isRemote: jobPosting.isRemote,
          isHybrid: jobPosting.isHybrid,
          description: jobPosting.description,
          descriptionHtml: jobPosting.descriptionHtml,
          requiredSkills: jobPosting.requiredSkills,
          preferredSkills: jobPosting.preferredSkills,
          yearsExperienceMin: jobPosting.yearsExperienceMin,
          yearsExperienceMax: jobPosting.yearsExperienceMax,
          salaryMin: jobPosting.salaryMin,
          salaryMax: jobPosting.salaryMax,
          currency: jobPosting.currency,
          employmentType: jobPosting.employmentType,
          applicationUrl: jobPosting.applicationUrl,
        },
      });
    },
  );

  // ── POST /api/jobs/manual/:id/confirm ─────────────────────────────────────
  app.post(
    '/api/jobs/manual/:id/confirm',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user.id;

      // 1. Validate confirmation payload (Req 15.5)
      const result = ConfirmManualJobSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(422).send({
          error: 'Confirmation required',
          details: result.error.flatten(),
        });
      }

      // 2. Verify the job posting exists
      const jobPosting = await prisma.jobPosting.findUnique({
        where: { id },
      });

      if (!jobPosting) {
        return reply.status(404).send({ error: 'Job posting not found' });
      }

      // 3. Verify the user has a match score for this job
      const jobMatch = await prisma.jobMatch.findUnique({
        where: { userId_jobPostingId: { userId, jobPostingId: id } },
      });

      if (!jobMatch) {
        return reply.status(404).send({
          error: 'Match score not found. Please submit the job URL first.',
        });
      }

      // 4. Create an AgentTask record for audit/tracking
      const agentTask = await prisma.agentTask.create({
        data: {
          type: 'manual_application',
          userId,
          payload: {
            jobPostingId: id,
            sourceUrl: jobPosting.sourceUrl,
            applicationUrl: jobPosting.applicationUrl,
            matchScore: jobMatch.overall,
          },
          priority: 'normal',
          status: 'queued',
        },
      });

      // 5. Enqueue job for application via BullMQ applicationQueue (Req 15.5)
      await applicationQueue.add(
        'manual_application',
        {
          taskId: agentTask.id,
          userId,
          jobPostingId: id,
          sourceUrl: jobPosting.sourceUrl,
          applicationUrl: jobPosting.applicationUrl,
          matchScore: jobMatch.overall,
        },
        {
          jobId: agentTask.id,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );

      // 6. Return task ID (Req 15.5)
      return reply.status(202).send({
        taskId: agentTask.id,
        status: 'queued',
        message: 'Job queued for application.',
      });
    },
  );
}
