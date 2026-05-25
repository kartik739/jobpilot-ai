/**
 * RemoteOK Job Discovery Connector
 *
 * Fetches job postings from RemoteOK's public JSON API.
 * The API returns an array where index 0 is a metadata object — it is skipped.
 *
 * API endpoint: GET https://remoteok.com/api
 *
 * Requirements: 3.8, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'RemoteOKConnector' });

const REMOTEOK_API_URL = 'https://remoteok.com/api';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface RemoteOKJob {
  id: string;
  url: string;
  position: string;
  company: string;
  location?: string;
  tags?: string[];
  date: string;
  [key: string]: unknown;
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class RemoteOKConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'remoteok' as const;

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
        'remoteok',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from RemoteOK.
   *
   * Skips index 0 of the response (metadata object).
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    log.info({ url: REMOTEOK_API_URL }, 'Fetching RemoteOK jobs');

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let response: Response;
    try {
      response = await fetch(REMOTEOK_API_URL, {
        headers: { 'User-Agent': 'jobpilot-ai/1.0' },
      });
    } catch (err) {
      log.error({ err }, 'Network error fetching RemoteOK jobs — skipping');
      return;
    }

    if (!response.ok) {
      log.error(
        { status: response.status, statusText: response.statusText },
        'Non-2xx response from RemoteOK — skipping',
      );
      return;
    }

    let data: unknown[];
    try {
      data = (await response.json()) as unknown[];
    } catch (err) {
      log.error({ err }, 'Failed to parse RemoteOK response JSON — skipping');
      return;
    }

    // Index 0 is a metadata/legal notice object, not a job — skip it.
    const jobs = (Array.isArray(data) ? data.slice(1) : []) as RemoteOKJob[];
    log.info({ count: jobs.length }, 'Fetched RemoteOK jobs');

    for (const job of jobs) {
      yield {
        sourceUrl: job.url,
        rawJson: job as unknown as Record<string, unknown>,
        platform: 'remoteok',
        discoveredAt: new Date(),
      };
    }
  }
}
