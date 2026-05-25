/**
 * Greenhouse Job Discovery Connector
 *
 * Fetches job postings from Greenhouse's public Job Board API for one or more
 * board tokens.  Each board token corresponds to a company's Greenhouse board.
 *
 * API endpoint: GET https://api.greenhouse.io/v1/boards/{boardToken}/jobs
 *
 * Requirements: 3.1, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'GreenhouseConnector' });

const GREENHOUSE_BASE_URL = 'https://api.greenhouse.io/v1/boards';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface GreenhouseJobLocation {
  name: string;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: GreenhouseJobLocation;
  updated_at: string;
  [key: string]: unknown;
}

interface GreenhouseBoardResponse {
  jobs: GreenhouseJob[];
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class GreenhouseConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'greenhouse' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 10,
    refillRate: 2,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param boardTokens - One or more Greenhouse board tokens to query.
   * @param redis       - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(
    private readonly boardTokens: string[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'greenhouse',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from all configured Greenhouse boards.
   *
   * Iterates each board token, fetches all jobs, and yields them one by one.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    for (const boardToken of this.boardTokens) {
      const url = `${GREENHOUSE_BASE_URL}/${boardToken}/jobs`;
      const boardLog = log.child({ boardToken });

      boardLog.info({ url }, 'Fetching Greenhouse board');

      // Acquire rate-limit token if Redis is available.
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      let response: Response;
      try {
        response = await fetch(url);
      } catch (err) {
        boardLog.error({ err }, 'Network error fetching Greenhouse board — skipping');
        continue;
      }

      if (!response.ok) {
        boardLog.error(
          { status: response.status, statusText: response.statusText },
          'Non-2xx response from Greenhouse — skipping board',
        );
        continue;
      }

      let data: GreenhouseBoardResponse;
      try {
        data = (await response.json()) as GreenhouseBoardResponse;
      } catch (err) {
        boardLog.error({ err }, 'Failed to parse Greenhouse response JSON — skipping');
        continue;
      }

      const jobs = data.jobs ?? [];
      boardLog.info({ count: jobs.length }, 'Fetched Greenhouse jobs');

      for (const job of jobs) {
        yield {
          sourceUrl: job.absolute_url,
          rawJson: job as unknown as Record<string, unknown>,
          platform: 'greenhouse',
          discoveredAt: new Date(),
        };
      }
    }
  }
}
