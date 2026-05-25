/**
 * Workday Job Discovery Connector
 *
 * Fetches job postings from Workday tenant-specific job boards via the
 * Workday CXS (Candidate Experience) JSON API.
 *
 * Each company has its own Workday tenant URL. This connector accepts a list
 * of tenant + board name pairs and queries each one.
 *
 * API endpoint: POST https://{tenant}.wd1.myworkdayjobs.com/wday/cxs/{tenant}/{boardName}/jobs
 *
 * Requirements: 3.4, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'WorkdayConnector' });

const WORKDAY_BASE_DOMAIN = 'wd1.myworkdayjobs.com';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface WorkdayJob {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  [key: string]: unknown;
}

interface WorkdayResponse {
  jobPostings: WorkdayJob[];
  total: number;
}

// ─── Connector ───────────────────────────────────────────────────────────────

export interface WorkdayTenant {
  /** Workday tenant subdomain, e.g. "amazon". */
  tenant: string;
  /** Job board name registered in Workday, e.g. "External_Career_Site". */
  boardName: string;
}

export class WorkdayConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'workday' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 5,
    refillRate: 0.5,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param tenants - One or more Workday tenant + board name pairs to query.
   * @param redis   - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(
    private readonly tenants: WorkdayTenant[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'workday',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from all configured Workday tenant boards.
   *
   * Issues a POST request to each tenant's CXS endpoint with a JSON body
   * that can include a search text derived from preferences.targetRoles.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    const searchText = preferences.targetRoles[0] ?? '';

    for (const { tenant, boardName } of this.tenants) {
      const url = `https://${tenant}.${WORKDAY_BASE_DOMAIN}/wday/cxs/${tenant}/${boardName}/jobs`;
      const tenantLog = log.child({ tenant, boardName });

      tenantLog.info({ url }, 'Fetching Workday jobs');

      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      const requestBody = JSON.stringify({
        appliedFacets: {},
        limit: 20,
        offset: 0,
        searchText,
      });

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        });
      } catch (err) {
        tenantLog.error({ err }, 'Network error fetching Workday jobs — skipping');
        continue;
      }

      if (!response.ok) {
        tenantLog.error(
          { status: response.status, statusText: response.statusText },
          'Non-2xx response from Workday — skipping tenant',
        );
        continue;
      }

      let data: WorkdayResponse;
      try {
        data = (await response.json()) as WorkdayResponse;
      } catch (err) {
        tenantLog.error({ err }, 'Failed to parse Workday response JSON — skipping');
        continue;
      }

      const jobs = data.jobPostings ?? [];
      tenantLog.info({ count: jobs.length, total: data.total }, 'Fetched Workday jobs');

      for (const job of jobs) {
        yield {
          sourceUrl: `https://${tenant}.${WORKDAY_BASE_DOMAIN}${job.externalPath}`,
          rawJson: job as unknown as Record<string, unknown>,
          platform: 'workday',
          discoveredAt: new Date(),
        };
      }
    }
  }
}
