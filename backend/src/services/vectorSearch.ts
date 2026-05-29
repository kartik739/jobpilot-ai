/**
 * Vector Search Service
 *
 * Provides pgvector-based semantic search over `job_postings` using the
 * cosine distance operator (`<=>`).  All query parameters are passed via
 * Prisma's tagged-template `$queryRaw` to prevent SQL injection — values
 * are never interpolated into SQL strings directly.
 *
 * Requirements: 8.8, 27.1, 27.4, 33.2
 */

import { prisma } from '../db.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ service: 'vectorSearch' });

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * Minimal shape returned for each matched job posting.
 * This mirrors the `JobPosting` Prisma model fields that callers need
 * for scoring and display, without pulling unnecessary data.
 */
export interface JobPosting {
  id: string;
  fingerprint: string;
  sourceUrl: string;
  platform: string;
  company: string;
  title: string;
  requiredSkills: string[];
  preferredSkills: string[];
  yearsExperienceMin: number | null;
  yearsExperienceMax: number | null;
  location: string[];
  isRemote: boolean;
  isHybrid: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  employmentType: string | null;
  visaRequirements: string[];
  applicationDeadline: Date | null;
  applicationUrl: string;
  discoveredAt: Date;
  parsedAt: Date | null;
  status: string;
}

// ─── Internal row type (snake_case from raw SQL) ──────────────────────────────

interface JobPostingRow {
  id: string;
  fingerprint: string;
  source_url: string;
  platform: string;
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
  discovered_at: Date;
  parsed_at: Date | null;
  status: string;
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function rowToJobPosting(row: JobPostingRow): JobPosting {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    sourceUrl: row.source_url,
    platform: row.platform,
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
    discoveredAt: row.discovered_at,
    parsedAt: row.parsed_at,
    status: row.status,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the top `limit` job postings semantically closest to the given
 * profile embedding using pgvector cosine distance.
 *
 * Only job postings that have a stored embedding are considered (i.e., rows
 * where `embedding IS NOT NULL`).  Results are ordered ascending by cosine
 * distance (closest first).
 *
 * Query parameters are passed via Prisma's tagged-template `$queryRaw` —
 * values are never concatenated or interpolated into SQL strings directly,
 * preventing SQL injection.
 *
 * @param profileEmbedding  A 384-dimensional float vector representing the
 *                          user's profile (skills + target roles).
 * @param limit             Maximum number of candidates to return.
 *                          Defaults to 200.
 * @returns                 Ordered array of job postings (closest first).
 *
 * Requirements: 8.8, 27.1, 27.4, 33.2
 */
export async function getTopCandidates(
  profileEmbedding: number[],
  limit = 200,
): Promise<JobPosting[]> {
  if (profileEmbedding.length === 0) {
    log.warn('getTopCandidates called with empty embedding — returning []');
    return [];
  }

  // Build a Postgres vector literal from the number array.
  // e.g.  [0.123, -0.456, ...]
  // This is the *value* substituted into the parameterised query as a typed
  // cast, not raw string interpolation of user-controlled data.
  const vectorLiteral = `[${profileEmbedding.join(',')}]`;

  log.debug(
    { dimensions: profileEmbedding.length, limit },
    'Executing pgvector cosine similarity query',
  );

  // Prisma tagged-template $queryRaw treats each ${expr} as a bind parameter.
  // The vector literal and limit are passed as parameters, never spliced
  // directly into the SQL string.
  const rows = await prisma.$queryRaw<JobPostingRow[]>`
    SELECT
      id,
      fingerprint,
      source_url,
      platform,
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
      discovered_at,
      parsed_at,
      status
    FROM job_postings
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `;

  log.debug({ returned: rows.length }, 'pgvector query complete');

  return rows.map(rowToJobPosting);
}
