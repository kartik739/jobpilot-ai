/**
 * Ranking Worker
 *
 * BullMQ Worker that processes `rank_jobs` jobs.
 *
 * Per job run:
 *  1. Load the user's profile + skills from Prisma.
 *  2. Generate a profile embedding from skills + target roles.
 *  3. Retrieve top 200 job posting candidates via pgvector cosine similarity.
 *  4. Fetch already-applied job fingerprints for the user.
 *  5. Filter out already-applied postings.
 *  6. Compute `computeMatchScore()` for each candidate.
 *  7. Filter out hard disqualifiers (overall === 0).
 *  8. Sort descending by overall score.
 *  9. Upsert `JobMatch` records via Prisma.
 *
 * Requirements: 8.8, 13.3
 */

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../db.js';
import { logger } from '../core/logger.js';
import { decrypt } from '../core/encryption.js';
import { generateEmbedding } from '../services/embeddings.js';
import {
  computeMatchScore,
  type UserProfile,
  type HolisticScoreFn,
} from '../agents/ranking/scorer.js';
import type { ParsedJobPosting } from '../agents/discovery/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOP_CANDIDATES_LIMIT = 200;

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Job payload shape for `rank_jobs` queue entries.
 */
export interface RankJobsPayload {
  userId: string;
}

/**
 * Row returned by the pgvector similarity query.
 */
interface JobPostingRow {
  id: string;
  fingerprint: string;
  company: string;
  title: string;
  required_skills: string[];
  preferred_skills: string[];
  years_experience_min: number | null;
  years_experience_max: number | null;
  location: string[];
  is_remote: boolean;
  is_hybrid: boolean;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  employment_type: string | null;
  visa_requirements: string[];
  application_deadline: Date | null;
  application_url: string;
  source_url: string;
  discovered_at: Date;
  parsed_at: Date | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely decrypt a nullable encrypted string field.
 * Returns `undefined` if the value is null/undefined or decryption fails.
 */
function safeDecryptNumber(encrypted: string | null | undefined): number | undefined {
  if (!encrypted) return undefined;
  try {
    const decrypted = decrypt(encrypted);
    const n = Number(decrypted);
    return isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
}

/**
 * Compute total years of experience from work experience records.
 * Sums up all non-overlapping durations; treats `isCurrent` as ending today.
 */
function computeTotalYearsExperience(
  workExperiences: Array<{
    startDate: Date;
    endDate: Date | null;
    isCurrent: boolean;
  }>,
): number {
  const now = new Date();
  let totalMs = 0;

  for (const we of workExperiences) {
    const end = we.isCurrent ? now : (we.endDate ?? now);
    const durationMs = end.getTime() - we.startDate.getTime();
    if (durationMs > 0) {
      totalMs += durationMs;
    }
  }

  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return totalMs / msPerYear;
}

/**
 * Map a pgvector query row to a `ParsedJobPosting` for the scorer.
 */
function rowToJobPosting(row: JobPostingRow): ParsedJobPosting {
  return {
    sourceUrl: row.source_url,
    platform: 'greenhouse', // placeholder — scorer doesn't use platform
    discoveredAt: row.discovered_at,
    parsedAt: row.parsed_at ?? row.discovered_at,
    company: row.company,
    title: row.title,
    requiredSkills: row.required_skills ?? [],
    preferredSkills: row.preferred_skills ?? [],
    yearsExperienceMin: row.years_experience_min,
    yearsExperienceMax: row.years_experience_max,
    location: row.location ?? [],
    isRemote: row.is_remote,
    isHybrid: row.is_hybrid,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    currency: row.currency,
    employmentType: row.employment_type,
    visaRequirements: row.visa_requirements ?? [],
    applicationDeadline: row.application_deadline,
    applicationUrl: row.application_url,
    rawJson: {},
    rawHtml: null,
    status: 'parsed',
  };
}

/**
 * Retrieve top N job posting candidates via pgvector cosine similarity.
 *
 * Uses parameterized $queryRaw to avoid SQL injection.
 * Only fetches postings that have an embedding (status != 'new').
 */
async function getTopCandidates(
  embeddingVector: number[],
  limit: number,
): Promise<JobPostingRow[]> {
  // Format embedding as a Postgres vector literal: '[0.1,0.2,...]'
  const vectorLiteral = `[${embeddingVector.join(',')}]`;

  const rows = await prisma.$queryRaw<JobPostingRow[]>`
    SELECT
      id,
      fingerprint,
      company,
      title,
      required_skills,
      preferred_skills,
      years_experience_min,
      years_experience_max,
      location,
      is_remote,
      is_hybrid,
      salary_min,
      salary_max,
      currency,
      employment_type,
      visa_requirements,
      application_deadline,
      application_url,
      source_url,
      discovered_at,
      parsed_at
    FROM job_postings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;

  return rows;
}

// ─── Main processor ───────────────────────────────────────────────────────────

async function processRankingJob(
  job: Job,
  holisticFn?: HolisticScoreFn,
): Promise<void> {
  const { userId } = job.data as RankJobsPayload;
  const jobLog = logger.child({ jobId: job.id, jobName: job.name, userId });

  jobLog.info('Ranking job received');

  if (!userId) {
    jobLog.error('Ranking job missing userId — aborting');
    throw new Error('Ranking job missing required field: userId');
  }

  // ── Load profile + skills + work experience ───────────────────────────────
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      skills: true,
      workExperiences: {
        select: {
          startDate: true,
          endDate: true,
          isCurrent: true,
        },
      },
    },
  });

  if (!profile) {
    jobLog.warn('No profile found for user — aborting ranking');
    return;
  }

  jobLog.info({ skillCount: profile.skills.length }, 'Profile loaded');

  // ── Construct UserProfile for scorer ─────────────────────────────────────
  const skillNames = profile.skills.map((s) => s.name);
  const techSkills = profile.skills
    .filter((s) => s.category === 'technology' || s.category === 'tech')
    .map((s) => s.name);

  const totalYearsExperience = computeTotalYearsExperience(profile.workExperiences);

  // Decrypt salary fields gracefully
  const salaryMin = safeDecryptNumber(profile.salaryMin);
  const salaryMax = safeDecryptNumber(profile.salaryMax);

  const userProfile: UserProfile = {
    workAuthorization: profile.workAuthorization,
    requiresSponsorship: profile.requiresSponsorship,
    totalYearsExperience,
    skills: skillNames,
    techStack: techSkills.length > 0 ? techSkills : skillNames,
    preferredLocations: profile.preferredLocations,
    remotePreference: profile.remotePreference as UserProfile['remotePreference'],
    salaryMin,
    salaryMax,
    preferredCompanies: profile.preferredCompanies,
  };

  // ── Generate profile embedding ─────────────────────────────────────────────
  // Concatenate skills + target roles to build a representative text
  const profileText = [
    ...profile.targetRoles,
    ...skillNames,
  ]
    .filter(Boolean)
    .join(', ');

  let profileEmbedding: number[];
  try {
    profileEmbedding = await generateEmbedding(
      profileText || profile.fullName,
    );
  } catch (err) {
    jobLog.error({ err }, 'Failed to generate profile embedding — aborting ranking');
    return;
  }

  jobLog.info({ dimensions: profileEmbedding.length }, 'Profile embedding generated');

  // ── Fetch top 200 candidates via pgvector ─────────────────────────────────
  let candidates: JobPostingRow[];
  try {
    candidates = await getTopCandidates(profileEmbedding, TOP_CANDIDATES_LIMIT);
  } catch (err) {
    jobLog.error({ err }, 'Failed to retrieve vector candidates — aborting ranking');
    return;
  }

  jobLog.info({ candidateCount: candidates.length }, 'Vector candidates retrieved');

  if (candidates.length === 0) {
    jobLog.info('No candidates found — ranking complete (nothing to do)');
    return;
  }

  // ── Fetch already-applied job fingerprints for this user ──────────────────
  const appliedRecords = await prisma.applicationRecord.findMany({
    where: { userId },
    select: { fingerprint: true },
  });
  const appliedFingerprints = new Set(appliedRecords.map((r) => r.fingerprint));

  jobLog.info(
    { appliedCount: appliedFingerprints.size },
    'Loaded already-applied fingerprints',
  );

  // ── Filter out already-applied postings ───────────────────────────────────
  const unapplied = candidates.filter(
    (c) => !appliedFingerprints.has(c.fingerprint),
  );

  jobLog.info(
    { unapplied: unapplied.length, filtered: candidates.length - unapplied.length },
    'Filtered already-applied postings',
  );

  // ── Compute match scores ──────────────────────────────────────────────────
  const defaultHolistic: HolisticScoreFn = async () => 50;
  const scoreFn = holisticFn ?? defaultHolistic;

  const scored: Array<{ id: string; score: ReturnType<typeof computeMatchScore> extends Promise<infer T> ? T : never; posting: JobPostingRow }> = [];

  for (const candidate of unapplied) {
    try {
      const jobPosting = rowToJobPosting(candidate);
      const score = await computeMatchScore(jobPosting, userProfile, scoreFn);

      scored.push({
        id: candidate.id,
        score,
        posting: candidate,
      });
    } catch (err) {
      jobLog.warn(
        { err, candidateId: candidate.id },
        'Failed to compute match score for candidate — skipping',
      );
    }
  }

  jobLog.info({ scoredCount: scored.length }, 'Match scores computed');

  // ── Filter hard disqualifiers (overall === 0) ─────────────────────────────
  const qualified = scored.filter((s) => s.score.overall > 0);

  jobLog.info(
    {
      qualified: qualified.length,
      disqualified: scored.length - qualified.length,
    },
    'Filtered hard disqualifiers',
  );

  // ── Sort descending by overall score ──────────────────────────────────────
  qualified.sort((a, b) => b.score.overall - a.score.overall);

  // ── Upsert JobMatch records ───────────────────────────────────────────────
  let upserted = 0;
  let failed = 0;

  for (const { id: jobPostingId, score } of qualified) {
    try {
      await prisma.jobMatch.upsert({
        where: {
          userId_jobPostingId: { userId, jobPostingId },
        },
        update: {
          overall: score.overall,
          skillMatch: score.skillMatch,
          experienceMatch: score.experienceMatch,
          locationMatch: score.locationMatch,
          salaryMatch: score.salaryMatch,
          technologyMatch: score.technologyMatch,
          workAuthMatch: score.workAuthMatch,
          successProbability: score.successProbability,
          disqualifiers: score.disqualifiers,
        },
        create: {
          userId,
          jobPostingId,
          overall: score.overall,
          skillMatch: score.skillMatch,
          experienceMatch: score.experienceMatch,
          locationMatch: score.locationMatch,
          salaryMatch: score.salaryMatch,
          technologyMatch: score.technologyMatch,
          workAuthMatch: score.workAuthMatch,
          successProbability: score.successProbability,
          disqualifiers: score.disqualifiers,
        },
      });
      upserted++;
    } catch (err) {
      jobLog.warn(
        { err, jobPostingId },
        'Failed to upsert JobMatch record — skipping',
      );
      failed++;
    }
  }

  jobLog.info(
    { upserted, failed, total: qualified.length },
    'Ranking job completed',
  );
}

// ─── Worker factory ───────────────────────────────────────────────────────────

/**
 * Create a ranking worker with an optional injectable holistic score function.
 *
 * @param holisticFn - Optional LLM holistic scorer. Defaults to returning 50.
 * @returns          - A BullMQ Worker instance processing `rank_jobs` jobs.
 */
export function createRankingWorker(holisticFn?: HolisticScoreFn): Worker {
  const worker = new Worker(
    'ranking',
    (job: Job) => processRankingJob(job, holisticFn),
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Ranking worker reported failure');
  });

  return worker;
}

// ─── Default worker export ────────────────────────────────────────────────────

export const rankingWorker = createRankingWorker();
