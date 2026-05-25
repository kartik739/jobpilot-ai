/**
 * SmartRecruiters Job Discovery Connector
 *
 * Fetches job postings from SmartRecruiters' public API for one or more
 * company slugs.
 *
 * API endpoint: GET https://api.smartrecruiters.com/v1/companies/{company}/postings
 *
 * Requirements: 3.5, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'SmartRecruitersConnector' });

const SMARTRECRUITERS_BASE_URL = 'https://api.smartrecruiters.com/v1/companies';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface SmartRecruitersPosting {
  id: string;
  name: string;
  location: { city?: string; country?: string; region?: string };
  department?: { label: string };
  experienceLevel?: { id: string; label: string };
  typeOfEmployment?: { id: string; label: string };
  ref: string;
  [key: string]: unknown;
}

interface SmartRecruitersResponse {
  totalFound: number;
  content: SmartRecruitersPosting[];
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class SmartRecruitersConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'smartrecruiters' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 10,
    refillRate: 2,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param companies - One or more SmartRecruiters company identifiers to query.
   * @param redis     - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(
    private readonly companies: string[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'smartrecruiters',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from all configured SmartRecruiters companies.
   *
   * Iterates each company, fetches all job postings, and yields them one by one.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    for (const company of this.companies) {
      const url = `${SMARTRECRUITERS_BASE_URL}/${company}/postings`;
      const companyLog = log.child({ company });

      companyLog.info({ url }, 'Fetching SmartRecruiters postings');

      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      let response: Response;
      try {
        response = await fetch(url);
      } catch (err) {
        companyLog.error({ err }, 'Network error fetching SmartRecruiters postings — skipping');
        continue;
      }

      if (!response.ok) {
        companyLog.error(
          { status: response.status, statusText: response.statusText },
          'Non-2xx response from SmartRecruiters — skipping company',
        );
        continue;
      }

      let data: SmartRecruitersResponse;
      try {
        data = (await response.json()) as SmartRecruitersResponse;
      } catch (err) {
        companyLog.error({ err }, 'Failed to parse SmartRecruiters response JSON — skipping');
        continue;
      }

      const postings = data.content ?? [];
      companyLog.info({ count: postings.length, totalFound: data.totalFound }, 'Fetched SmartRecruiters postings');

      for (const posting of postings) {
        yield {
          sourceUrl: posting.ref,
          rawJson: posting as unknown as Record<string, unknown>,
          platform: 'smartrecruiters',
          discoveredAt: new Date(),
        };
      }
    }
  }
}
