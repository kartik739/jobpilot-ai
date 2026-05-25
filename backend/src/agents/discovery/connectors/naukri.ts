/**
 * Naukri Job Discovery Connector
 *
 * Fetches job postings from Naukri's public search API, queried per role/location
 * combination derived from the user's preferences.
 *
 * API endpoint: GET https://www.naukri.com/jobapi/v3/search
 *   ?noOfResults=20&searchType=adv&keyword={role}&location={location}
 *
 * The API returns JSON with jobs in `data.jobDetails`. If the response shape
 * is unexpected or the API is unavailable, we log the error and yield nothing.
 *
 * Rate limit: maxTokens: 5, refillRate: 0.5 tokens/sec.
 *
 * Requirements: 3.10, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'NaukriConnector' });

const NAUKRI_SEARCH_BASE_URL = 'https://www.naukri.com/jobapi/v3/search';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface NaukriJobDetail {
  jobId: string;
  title: string;
  companyName: string;
  jdURL?: string;
  placeholders?: Array<{ label: string; value: string }>;
  [key: string]: unknown;
}

interface NaukriSearchResponse {
  data?: {
    jobDetails?: NaukriJobDetail[];
  };
  [key: string]: unknown;
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class NaukriConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'naukri' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 5,
    refillRate: 0.5,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param redis - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(redis?: Redis) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'naukri',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from Naukri by querying the search API for each
   * combination of target role and preferred location derived from preferences.
   *
   * HTTP, network, and JSON parse errors are all caught, logged, and skipped
   * so remaining role/location combinations continue to be processed
   * (Requirement 3.11).
   */
  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    const roles = preferences.targetRoles.length > 0 ? preferences.targetRoles : [''];
    const locations = preferences.preferredLocations.length > 0 ? preferences.preferredLocations : [''];

    for (const role of roles) {
      for (const location of locations) {
        const params = new URLSearchParams({
          noOfResults: '20',
          searchType: 'adv',
        });
        if (role) {
          params.set('keyword', role);
          params.set('k', role);
        }
        if (location) {
          params.set('location', location);
          params.set('l', location);
        }

        const url = `${NAUKRI_SEARCH_BASE_URL}?${params.toString()}`;
        const feedLog = log.child({ role, location });

        feedLog.info({ url }, 'Fetching Naukri jobs');

        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        let response: Response;
        try {
          response = await fetch(url, {
            headers: {
              'User-Agent': 'jobpilot-ai/1.0',
              'Accept': 'application/json',
              'Appid': '109',
              'Systemid': 'Naukri',
            },
          });
        } catch (err) {
          feedLog.error({ err }, 'Network error fetching Naukri jobs — skipping');
          continue;
        }

        if (!response.ok) {
          feedLog.error(
            { status: response.status, statusText: response.statusText },
            'Non-2xx response from Naukri — skipping',
          );
          continue;
        }

        let parsed: NaukriSearchResponse;
        try {
          parsed = (await response.json()) as NaukriSearchResponse;
        } catch (err) {
          feedLog.error({ err }, 'Failed to parse Naukri response JSON — skipping');
          continue;
        }

        const jobDetails = parsed?.data?.jobDetails;
        if (!Array.isArray(jobDetails)) {
          feedLog.warn(
            { responseShape: Object.keys(parsed ?? {}) },
            'Naukri response has unexpected shape — no jobDetails array found, skipping',
          );
          continue;
        }

        feedLog.info({ count: jobDetails.length }, 'Fetched Naukri jobs');

        for (const job of jobDetails) {
          // Determine the canonical URL for this posting.
          const sourceUrl = job.jdURL ?? buildFallbackUrl(job);

          // Skip jobs where we cannot construct any meaningful URL.
          if (!sourceUrl) {
            feedLog.warn({ jobId: job.jobId }, 'Naukri job has no usable URL — skipping posting');
            continue;
          }

          yield {
            sourceUrl,
            rawJson: job as unknown as Record<string, unknown>,
            platform: 'naukri',
            discoveredAt: new Date(),
          };
        }
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a best-effort fallback URL for a Naukri job that lacks a `jdURL`.
 *
 * Returns an empty string if neither title nor companyName are available
 * (the caller must skip postings with an empty URL).
 */
function buildFallbackUrl(job: NaukriJobDetail): string {
  const title = job.title?.trim();
  const company = job.companyName?.trim();

  if (!title && !company) return '';

  // Slugify: lowercase, replace spaces/special chars with hyphens.
  const slug = [title, company]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `https://www.naukri.com/job-listings-${slug}`;
}
