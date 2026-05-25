/**
 * Y Combinator Jobs Discovery Connector
 *
 * Discovers job postings from the "Ask HN: Who is Hiring?" threads via the
 * Algolia HN Search API:
 *   1. Find the most recent "Who is Hiring" story ID.
 *   2. Fetch comments for that story, filtered by the user's target role.
 *
 * API endpoints:
 *   - https://hn.algolia.com/api/v1/search?query=who+is+hiring&tags=ask_hn&hitsPerPage=1
 *   - https://hn.algolia.com/api/v1/search?tags=comment,story_{id}&hitsPerPage=100&query={role}
 *
 * Requirements: 3.7, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'YCombinatorConnector' });

const ALGOLIA_BASE_URL = 'https://hn.algolia.com/api/v1/search';
const HN_ITEM_BASE_URL = 'https://news.ycombinator.com/item';

// ─── Response shapes ─────────────────────────────────────────────────────────

interface AlgoliaHit {
  objectID: string;
  comment_text?: string;
  story_id?: number;
  author: string;
  created_at: string;
  [key: string]: unknown;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class YCombinatorConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'ycombinator' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 10,
    refillRate: 1,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param redis - Optional ioredis client for rate limiting (omit in tests).
   */
  constructor(redis?: Redis) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'ycombinator',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from the most recent YC "Who is Hiring?" thread.
   *
   * Step 1: Find the most recent "Ask HN: Who is Hiring?" story.
   * Step 2: Fetch comments for that story filtered by the user's first target role.
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    // ── Step 1: Find the most recent "Who is Hiring" story ────────────────────
    const searchUrl = `${ALGOLIA_BASE_URL}?query=who+is+hiring&tags=ask_hn&hitsPerPage=1`;
    log.info({ url: searchUrl }, 'Fetching YC "Who is Hiring" story ID');

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let searchResponse: Response;
    try {
      searchResponse = await fetch(searchUrl);
    } catch (err) {
      log.error({ err }, 'Network error fetching YC story list — skipping');
      return;
    }

    if (!searchResponse.ok) {
      log.error(
        { status: searchResponse.status, statusText: searchResponse.statusText },
        'Non-2xx response fetching YC story list — skipping',
      );
      return;
    }

    let searchData: AlgoliaResponse;
    try {
      searchData = (await searchResponse.json()) as AlgoliaResponse;
    } catch (err) {
      log.error({ err }, 'Failed to parse YC story search response JSON — skipping');
      return;
    }

    const storyHit = searchData.hits[0];
    if (!storyHit) {
      log.error('No "Who is Hiring" story found in Algolia results — skipping');
      return;
    }

    const storyId = storyHit.objectID;
    log.info({ storyId }, 'Found YC "Who is Hiring" story');

    // ── Step 2: Fetch comments filtered by target role ────────────────────────
    const role = preferences.targetRoles[0] ?? '';
    const commentsUrl = `${ALGOLIA_BASE_URL}?tags=comment,story_${storyId}&hitsPerPage=100&query=${encodeURIComponent(role)}`;
    const commentsLog = log.child({ storyId, role });

    commentsLog.info({ url: commentsUrl }, 'Fetching YC hiring comments');

    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

    let commentsResponse: Response;
    try {
      commentsResponse = await fetch(commentsUrl);
    } catch (err) {
      commentsLog.error({ err }, 'Network error fetching YC comments — skipping');
      return;
    }

    if (!commentsResponse.ok) {
      commentsLog.error(
        { status: commentsResponse.status, statusText: commentsResponse.statusText },
        'Non-2xx response fetching YC comments — skipping',
      );
      return;
    }

    let commentsData: AlgoliaResponse;
    try {
      commentsData = (await commentsResponse.json()) as AlgoliaResponse;
    } catch (err) {
      commentsLog.error({ err }, 'Failed to parse YC comments response JSON — skipping');
      return;
    }

    const hits = commentsData.hits ?? [];
    commentsLog.info({ count: hits.length }, 'Fetched YC hiring comments');

    for (const hit of hits) {
      yield {
        sourceUrl: `${HN_ITEM_BASE_URL}?id=${hit.objectID}`,
        rawJson: hit as unknown as Record<string, unknown>,
        platform: 'ycombinator',
        discoveredAt: new Date(),
      };
    }
  }
}
