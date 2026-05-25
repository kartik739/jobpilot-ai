/**
 * Indeed Job Discovery Connector
 *
 * Fetches job postings from Indeed's RSS feed, queried per role/location
 * combination derived from the user's preferences.
 *
 * RSS endpoint: GET https://www.indeed.com/rss?q={role}&l={location}&sort=date
 *
 * Indeed rate-limits aggressively, so a conservative token bucket is used:
 * maxTokens: 5, refillRate: 0.5 tokens/sec.
 *
 * Requirements: 3.9, 3.11
 */

import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'IndeedConnector' });

const INDEED_RSS_BASE_URL = 'https://www.indeed.com/rss';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract all `<item>` blocks from an RSS XML string and parse their
 * key sub-elements using simple regex matching.
 */
function parseRssItems(xml: string): Array<{
  title: string;
  link: string;
  description: string;
  pubDate: string;
}> {
  const items: Array<{ title: string; link: string; description: string; pubDate: string }> = [];

  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const block = itemMatch[1] ?? '';

    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');

    if (link) {
      items.push({ title, link, description, pubDate });
    }
  }

  return items;
}

/** Extract the text content of the first matching XML/RSS tag in a string. */
function extractTag(xml: string, tag: string): string {
  // Handle both plain <tag>value</tag> and CDATA <tag><![CDATA[value]]></tag>
  const cdataPattern = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
  const plainPattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');

  const cdataMatch = cdataPattern.exec(xml);
  if (cdataMatch?.[1] !== undefined) return cdataMatch[1].trim();

  const plainMatch = plainPattern.exec(xml);
  if (plainMatch?.[1] !== undefined) return plainMatch[1].trim();

  return '';
}

// ─── Connector ───────────────────────────────────────────────────────────────

export class IndeedConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'indeed' as const;

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
        'indeed',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings from Indeed by querying the RSS feed for each
   * combination of target role and preferred location derived from preferences.
   *
   * HTTP and network errors are logged and skipped (Requirement 3.11).
   */
  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    const roles = preferences.targetRoles.length > 0 ? preferences.targetRoles : [''];
    const locations = preferences.preferredLocations.length > 0 ? preferences.preferredLocations : [''];

    for (const role of roles) {
      for (const location of locations) {
        const params = new URLSearchParams({ sort: 'date' });
        if (role) params.set('q', role);
        if (location) params.set('l', location);

        const url = `${INDEED_RSS_BASE_URL}?${params.toString()}`;
        const feedLog = log.child({ role, location });

        feedLog.info({ url }, 'Fetching Indeed RSS feed');

        if (this.rateLimiter) {
          await this.rateLimiter.acquire();
        }

        let response: Response;
        try {
          response = await fetch(url, {
            headers: {
              'User-Agent': 'jobpilot-ai/1.0',
              'Accept': 'application/rss+xml',
            },
          });
        } catch (err) {
          feedLog.error({ err }, 'Network error fetching Indeed RSS feed — skipping');
          continue;
        }

        if (!response.ok) {
          feedLog.error(
            { status: response.status, statusText: response.statusText },
            'Non-2xx response from Indeed — skipping',
          );
          continue;
        }

        let xml: string;
        try {
          xml = await response.text();
        } catch (err) {
          feedLog.error({ err }, 'Failed to read Indeed RSS response body — skipping');
          continue;
        }

        let items: ReturnType<typeof parseRssItems>;
        try {
          items = parseRssItems(xml);
        } catch (err) {
          feedLog.error({ err }, 'Failed to parse Indeed RSS XML — skipping');
          continue;
        }

        feedLog.info({ count: items.length }, 'Fetched Indeed RSS items');

        for (const item of items) {
          yield {
            sourceUrl: item.link,
            rawJson: item as unknown as Record<string, unknown>,
            platform: 'indeed',
            discoveredAt: new Date(),
          };
        }
      }
    }
  }
}
