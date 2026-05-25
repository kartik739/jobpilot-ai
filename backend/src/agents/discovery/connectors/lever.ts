/**
 * Lever Job Discovery Connector
 *
 * Fetches job postings from Lever's public postings API for one or more
 * company slugs.
 *
 * API endpoint: GET https://api.lever.co/v0/postings/{company}
 *
 * Requirements: 3.2, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'LeverConnector' });

const LEVER_BASE_URL = 'https://api.lever.co/v0/postings';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface LeverJobCategories {
  location?: string;
  team?: string;
  commitment?: string;
  [key: string]: unknown;
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories: LeverJobCategories;
  /** Unix timestamp in milliseconds */
  createdAt: number;
  [key: string]: unknown;
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class LeverConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'lever' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 10,
    refillRate: 2,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param companies - One or more Lever company slugs to query.
   * @param redis     - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(
    private readonly companies: string[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'lever',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from all configured Lever companies.
   *
   * Iterates each company slug, fetches all postings, and yields them one by one.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    for (const company of this.companies) {
      const url = `${LEVER_BASE_URL}/${company}`;
      const companyLog = log.child({ company });

      companyLog.info({ url }, 'Fetching Lever postings');

      // Acquire rate-limit token if Redis is available.
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      let response: Response;
      try {
        response = await fetch(url);
      } catch (err) {
        companyLog.error({ err }, 'Network error fetching Lever postings — skipping');
        continue;
      }

      if (!response.ok) {
        companyLog.error(
          { status: response.status, statusText: response.statusText },
          'Non-2xx response from Lever — skipping company',
        );
        continue;
      }

      let data: LeverJob[];
      try {
        data = (await response.json()) as LeverJob[];
      } catch (err) {
        companyLog.error({ err }, 'Failed to parse Lever response JSON — skipping');
        continue;
      }

      const jobs = Array.isArray(data) ? data : [];
      companyLog.info({ count: jobs.length }, 'Fetched Lever postings');

      for (const job of jobs) {
        yield {
          sourceUrl: job.hostedUrl,
          rawJson: job as unknown as Record<string, unknown>,
          platform: 'lever',
          discoveredAt: new Date(),
        };
      }
    }
  }
}
