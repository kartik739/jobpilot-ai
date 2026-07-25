/**
 * Discovery Worker
 *
 * BullMQ Worker that processes `discover_jobs` jobs.
 *
 * Per job run:
 *  1. Load the user's job preferences from the DB.
 *  2. Load all enabled `JobSourceConfig` records for that user.
 *  3. For each source, build a connector, run discovery, parse, deduplicate,
 *     and upsert new `JobPosting` records.
 *  4. After each source: update `lastRunAt`, `lastRunStatus`, `lastRunJobsFound`,
 *     and `errorMessage` on the `JobSourceConfig` row.
 *  5. On HTTP 429: set status to `rate_limited`, store a 60-minute (or
 *     Retry-After-based) backoff window, and skip that source.
 *
 * Requirements: 22.1, 22.2, 22.3
 */

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma } from '../db.js';
import { logger } from '../core/logger.js';
import { runDiscovery } from '../agents/discovery/orchestrator.js';
import { parseJobDescription } from '../agents/discovery/parser.js';
import { deduplicatePostings, computeFingerprint } from '../agents/discovery/dedup.js';
import type { BaseJobDiscoveryConnector } from '../agents/discovery/base.js';
import type { JobPreferences, SupportedPlatform } from '../agents/discovery/types.js';
import { rankingQueue } from '../workers/queue.js';
import { jobsDiscoveredTotal } from '../core/metrics.js';

// ─── Platform connectors ──────────────────────────────────────────────────────

import { GreenhouseConnector } from '../agents/discovery/connectors/greenhouse.js';
import { LeverConnector } from '../agents/discovery/connectors/lever.js';
import { AshbyConnector } from '../agents/discovery/connectors/ashby.js';
import { WorkdayConnector, type WorkdayTenant } from '../agents/discovery/connectors/workday.js';
import { SmartRecruitersConnector } from '../agents/discovery/connectors/smartrecruiters.js';
import { WellfoundConnector } from '../agents/discovery/connectors/wellfound.js';
import { YCombinatorConnector } from '../agents/discovery/connectors/ycombinator.js';
import { RemoteOKConnector } from '../agents/discovery/connectors/remoteok.js';
import { IndeedConnector } from '../agents/discovery/connectors/indeed.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BACKOFF_MINUTES = 60;

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

// ─── Rate-limit error ─────────────────────────────────────────────────────────

/**
 * Thrown by the connector factory (or by connectors) when a 429 response is
 * detected so the worker can handle it separately from generic errors.
 */
export class RateLimitError extends Error {
  /** Seconds until the source is available again (from Retry-After header). */
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds ?? DEFAULT_BACKOFF_MINUTES * 60;
  }
}

// ─── Connector factory ────────────────────────────────────────────────────────

/**
 * Build a connector instance for a given platform + raw config object.
 *
 * The `config` JSON stored in `JobSourceConfig.config` is platform-specific.
 * Connectors that require list parameters (Greenhouse board tokens, Lever
 * company slugs, …) read them from `config.tokens` / `config.companies` etc.
 *
 * Connectors that do not need extra configuration (RemoteOK, Indeed, …)
 * accept an empty config.
 */
function buildConnector(
  platform: string,
  config: Record<string, unknown>,
  redis: Redis,
): BaseJobDiscoveryConnector | null {
  switch (platform as SupportedPlatform) {
    case 'greenhouse': {
      const tokens = Array.isArray(config['tokens'])
        ? (config['tokens'] as string[])
        : config['boardToken']
        ? [config['boardToken'] as string]
        : [];
      if (tokens.length === 0) return null;
      return new GreenhouseConnector(tokens, redis);
    }

    case 'lever': {
      const companies = Array.isArray(config['companies'])
        ? (config['companies'] as string[])
        : config['company']
        ? [config['company'] as string]
        : [];
      if (companies.length === 0) return null;
      return new LeverConnector(companies, redis);
    }

    case 'ashby': {
      const boardIds = Array.isArray(config['boardIds'])
        ? (config['boardIds'] as string[])
        : config['boardId']
        ? [config['boardId'] as string]
        : [];
      if (boardIds.length === 0) return null;
      return new AshbyConnector(boardIds, redis);
    }

    case 'workday': {
      // config.tenants is an array of { tenant, boardName } objects
      const rawTenants = Array.isArray(config['tenants'])
        ? (config['tenants'] as WorkdayTenant[])
        : config['tenant'] && config['boardName']
        ? [{ tenant: config['tenant'] as string, boardName: config['boardName'] as string }]
        : [];
      if (rawTenants.length === 0) return null;
      return new WorkdayConnector(rawTenants, redis);
    }

    case 'smartrecruiters': {
      const companies = Array.isArray(config['companies'])
        ? (config['companies'] as string[])
        : config['company']
        ? [config['company'] as string]
        : [];
      if (companies.length === 0) return null;
      return new SmartRecruitersConnector(companies, redis);
    }

    case 'wellfound':
      return new WellfoundConnector(redis);

    case 'ycombinator':
      return new YCombinatorConnector(redis);

    case 'remoteok':
      return new RemoteOKConnector(redis);

    case 'indeed':
      return new IndeedConnector(redis);

    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a Profile row to the `JobPreferences` shape consumed by connectors.
 */
function profileToPreferences(
  profile: {
    targetRoles: string[];
    preferredLocations: string[];
    remotePreference: string;
    salaryMin: string | null;
    salaryMax: string | null;
    currency: string;
    employmentTypes: string[];
    excludedCompanies: string[];
    preferredCompanies: string[];
    targetIndustries: string[];
    targetCompanySizes: string[];
  },
): JobPreferences {
  // salaryMin / salaryMax are stored encrypted as strings; parse them safely.
  const parseSalary = (s: string | null): number | undefined => {
    if (!s) return undefined;
    const n = Number(s);
    return isNaN(n) ? undefined : n;
  };

  return {
    targetRoles: profile.targetRoles,
    preferredLocations: profile.preferredLocations,
    remotePreference: profile.remotePreference as JobPreferences['remotePreference'],
    salaryMin: parseSalary(profile.salaryMin),
    salaryMax: parseSalary(profile.salaryMax),
    currency: profile.currency || undefined,
    employmentTypes: profile.employmentTypes,
    excludedCompanies: profile.excludedCompanies,
    preferredCompanies: profile.preferredCompanies,
    targetIndustries: profile.targetIndustries,
    targetCompanySizes: profile.targetCompanySizes,
  };
}

/**
 * Parse a `Retry-After` header value into seconds.
 *
 * Handles both numeric (seconds) and HTTP-date formats.
 * Returns undefined when the header is absent or unparseable.
 */
function parseRetryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after') ?? headers.get('Retry-After');
  if (!retryAfter) return undefined;

  const numeric = Number(retryAfter);
  if (!isNaN(numeric) && numeric > 0) return numeric;

  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delta = Math.ceil((date.getTime() - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }

  return undefined;
}

// ─── Per-source runner ────────────────────────────────────────────────────────

/**
 * Run discovery for a single source and return the number of new jobs stored.
 *
 * Throws `RateLimitError` if the source returns HTTP 429.
 * Re-throws any other unexpected errors so the caller can mark the source
 * as `error`.
 */
async function runSourceDiscovery(
  connector: BaseJobDiscoveryConnector,
  preferences: JobPreferences,
  sourceLog: Logger,
): Promise<number> {
  const rawPostings = [];

  // Collect all raw postings from this source.
  for await (const raw of runDiscovery([connector], preferences, sourceLog)) {
    rawPostings.push(raw);
  }

  sourceLog.info({ count: rawPostings.length }, 'Raw postings collected');

  // Parse postings in parallel (bounded by available memory / LLM capacity).
  const parsedResults = await Promise.all(
    rawPostings.map(raw => parseJobDescription(raw)),
  );

  // Filter out parse failures (null results).
  const parsed = parsedResults.filter((p): p is NonNullable<typeof p> => p !== null);
  sourceLog.info({ parsed: parsed.length, failed: parsedResults.length - parsed.length }, 'Postings parsed');

  // Deduplicate within this batch.
  const unique = deduplicatePostings(parsed);
  sourceLog.info({ unique: unique.length, duplicates: parsed.length - unique.length }, 'Deduplication complete');

  // Upsert into the database.
  let stored = 0;
  for (const posting of unique) {
    const fingerprint = computeFingerprint(
      posting.title ?? '',
      posting.company ?? '',
      posting.sourceUrl,
    );

    try {
      await prisma.jobPosting.upsert({
        where: { fingerprint },
        update: {}, // Do not overwrite existing records
        create: {
          fingerprint,
          sourceUrl: posting.sourceUrl,
          platform: posting.platform,
          company: posting.company ?? 'Unknown',
          title: posting.title ?? 'Untitled',
          description: posting.rawHtml
            ? posting.rawHtml.replace(/<[^>]*>/g, ' ').trim().slice(0, 10_000)
            : JSON.stringify(posting.rawJson).slice(0, 10_000),
          descriptionHtml: posting.rawHtml ?? null,
          requiredSkills: posting.requiredSkills ?? [],
          preferredSkills: posting.preferredSkills ?? [],
          yearsExperienceMin: posting.yearsExperienceMin ?? null,
          yearsExperienceMax: posting.yearsExperienceMax ?? null,
          location: posting.location ?? [],
          isRemote: posting.isRemote ?? false,
          isHybrid: posting.isHybrid ?? false,
          salaryMin: posting.salaryMin ?? null,
          salaryMax: posting.salaryMax ?? null,
          currency: posting.currency ?? null,
          employmentType: posting.employmentType ?? null,
          visaRequirements: posting.visaRequirements ?? [],
          applicationDeadline: posting.applicationDeadline ?? null,
          applicationUrl: posting.applicationUrl ?? posting.sourceUrl,
          discoveredAt: posting.discoveredAt,
          parsedAt: posting.parsedAt,
          rawData: posting.rawJson as Parameters<typeof prisma.jobPosting.create>[0]['data']['rawData'],
          status: posting.status,
        },
      });
      stored++;
      jobsDiscoveredTotal.inc({ platform: posting.platform });
      if (posting.embedding && posting.embedding.length > 0) {
        const vec = `[${posting.embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE job_postings SET embedding = $1::vector WHERE fingerprint = $2`,
          vec,
          fingerprint,
        );
      }
    } catch (err) {
      // Unique constraint violation means the posting already exists (race condition).
      // This is expected in concurrent runs — log and continue.
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        sourceLog.debug({ fingerprint }, 'Duplicate fingerprint on insert — skipping');
      } else {
        sourceLog.error({ err, fingerprint }, 'Failed to upsert job posting');
      }
    }
  }

  sourceLog.info({ stored }, 'Job postings stored');
  return stored;
}

// ─── Main processor ───────────────────────────────────────────────────────────

/**
 * Job payload shape for `discover_jobs` queue entries.
 */
interface DiscoverJobsPayload {
  userId: string;
}

async function processDiscoveryJob(job: Job): Promise<void> {
  const { userId } = job.data as DiscoverJobsPayload;
  const jobLog = logger.child({ jobId: job.id, jobName: job.name, userId });

  jobLog.info('Discovery job received');

  if (!userId) {
    jobLog.error('Discovery job missing userId — aborting');
    throw new Error('Discovery job missing required field: userId');
  }

  // ── Load user profile (for job preferences) ───────────────────────────────
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    jobLog.warn('No profile found for user — aborting discovery');
    return;
  }

  const preferences = profileToPreferences(profile);

  // ── Load enabled job source configs for this user ─────────────────────────
  const sources = await prisma.jobSourceConfig.findMany({
    where: { userId, enabled: true },
  });

  if (sources.length === 0) {
    jobLog.info('No enabled job sources configured for user');
    return;
  }

  jobLog.info({ sourceCount: sources.length }, 'Processing enabled job sources');

  let totalStored = 0;

  // ── Process each source independently ────────────────────────────────────
  for (const source of sources) {
    const sourceLog = jobLog.child({ sourceId: source.id, platform: source.platform }) as unknown as Logger;

    // Skip sources still within their rate-limit backoff window.
    if (source.lastRunStatus === 'rate_limited' && source.lastRunAt) {
      const backoffMs = DEFAULT_BACKOFF_MINUTES * 60 * 1000;
      const elapsed = Date.now() - source.lastRunAt.getTime();
      if (elapsed < backoffMs) {
        const remainingMinutes = Math.ceil((backoffMs - elapsed) / 60_000);
        sourceLog.info(
          { remainingMinutes },
          'Source is in rate-limit backoff window — skipping',
        );
        continue;
      }
    }

    const config = (source.config ?? {}) as Record<string, unknown>;
    const connector = buildConnector(source.platform, config, connection);

    if (!connector) {
      sourceLog.warn('Could not build connector for platform — skipping');
      await prisma.jobSourceConfig.update({
        where: { id: source.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'error',
          lastRunJobsFound: 0,
          errorMessage: `Unsupported platform or missing connector config: ${source.platform}`,
        },
      });
      continue;
    }

    let jobsFound = 0;

    try {
      jobsFound = await runSourceDiscovery(connector, preferences, sourceLog);
      totalStored += jobsFound;

      // ── Success ──────────────────────────────────────────────────────────
      await prisma.jobSourceConfig.update({
        where: { id: source.id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'success',
          lastRunJobsFound: jobsFound,
          errorMessage: null,
        },
      });

      sourceLog.info({ jobsFound }, 'Source discovery completed successfully');
    } catch (err) {
      if (err instanceof RateLimitError) {
        // ── HTTP 429: rate limited ────────────────────────────────────────
        const backoffSeconds = err.retryAfterSeconds;
        const backoffMinutes = Math.ceil(backoffSeconds / 60);

        sourceLog.warn(
          { backoffSeconds, backoffMinutes },
          'Source returned 429 — marking rate_limited',
        );

        await prisma.jobSourceConfig.update({
          where: { id: source.id },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: 'rate_limited',
            lastRunJobsFound: jobsFound,
            errorMessage: `Rate limited. Backoff: ${backoffMinutes} minute(s). Retry after: ${new Date(Date.now() + backoffSeconds * 1000).toISOString()}`,
          },
        });
      } else {
        // ── Generic error ─────────────────────────────────────────────────
        const message = err instanceof Error ? err.message : String(err);

        sourceLog.error({ err }, 'Source discovery failed');

        await prisma.jobSourceConfig.update({
          where: { id: source.id },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: 'error',
            lastRunJobsFound: jobsFound,
            errorMessage: message.slice(0, 1000),
          },
        });
      }
    }
  }

  if (totalStored > 0) {
    await rankingQueue.add('rank_jobs', { userId });
    jobLog.info({ totalStored }, 'Enqueued rank_jobs after discovery');
  }

  jobLog.info('Discovery job completed');
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export const discoveryWorker = new Worker('discovery', processDiscoveryJob, { connection });

discoveryWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Discovery worker reported failure');
});

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { parseRetryAfterSeconds };
