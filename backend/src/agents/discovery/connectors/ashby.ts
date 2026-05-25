/**
 * Ashby Job Discovery Connector
 *
 * Fetches job postings from Ashby's public job board API for one or more
 * board IDs.
 *
 * API endpoint: GET https://api.ashbyhq.com/posting-api/job-board/{boardId}
 *
 * Requirements: 3.3, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'AshbyConnector' });

const ASHBY_BASE_URL = 'https://api.ashbyhq.com/posting-api/job-board';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface AshbyJobPosting {
  id: string;
  title: string;
  jobPostingUrl: string;
  locationName: string;
  publishedAt: string;
  [key: string]: unknown;
}

interface AshbyBoardResponse {
  jobPostings: AshbyJobPosting[];
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class AshbyConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'ashby' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 10,
    refillRate: 2,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param boardIds - One or more Ashby board IDs to query.
   * @param redis    - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(
    private readonly boardIds: string[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'ashby',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from all configured Ashby boards.
   *
   * Iterates each board ID, fetches all job postings, and yields them one by one.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    for (const boardId of this.boardIds) {
      const url = `${ASHBY_BASE_URL}/${boardId}`;
      const boardLog = log.child({ boardId });

      boardLog.info({ url }, 'Fetching Ashby board');

      // Acquire rate-limit token if Redis is available.
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      let response: Response;
      try {
        response = await fetch(url);
      } catch (err) {
        boardLog.error({ err }, 'Network error fetching Ashby board — skipping');
        continue;
      }

      if (!response.ok) {
        boardLog.error(
          { status: response.status, statusText: response.statusText },
          'Non-2xx response from Ashby — skipping board',
        );
        continue;
      }

      let data: AshbyBoardResponse;
      try {
        data = (await response.json()) as AshbyBoardResponse;
      } catch (err) {
        boardLog.error({ err }, 'Failed to parse Ashby response JSON — skipping');
        continue;
      }

      const postings = data.jobPostings ?? [];
      boardLog.info({ count: postings.length }, 'Fetched Ashby job postings');

      for (const posting of postings) {
        yield {
          sourceUrl: posting.jobPostingUrl,
          rawJson: posting as unknown as Record<string, unknown>,
          platform: 'ashby',
          discoveredAt: new Date(),
        };
      }
    }
  }
}
