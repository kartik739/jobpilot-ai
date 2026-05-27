/**
 * X/Twitter Job Discovery Connector
 *
 * Searches X (Twitter) for job postings using Playwright, extracts outbound
 * URLs from tweets, resolves t.co short links to their final destinations,
 * and filters results against an ATS hostname allowlist.
 *
 * Search endpoint: https://x.com/search?q=<encodedQuery>&f=live
 *
 * Rate limit: max 3 searches/hour (TokenBucketRateLimiter, maxTokens=3, refillRate=3/3600)
 * Max tweets per search: 50
 *
 * Requirements: 3.12
 */

import { chromium } from 'playwright';
import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'TwitterXConnector' });

// ─── Constants ────────────────────────────────────────────────────────────────

const X_BASE_URL = 'https://x.com';
const X_SEARCH_URL = `${X_BASE_URL}/search`;
const ROBOTS_TXT_URL = `${X_BASE_URL}/robots.txt`;
const MAX_TWEETS_PER_SEARCH = 50;

/** Tokens per second for 3 searches per hour. */
const RATE_LIMIT_REFILL = 3 / 3600;

/**
 * ATS hostname allowlist.
 * A URL is accepted if its hostname ends with one of these domains.
 */
export const ATS_ALLOWLIST: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workday.com',
  'smartrecruiters.com',
  'wellfound.com',
  'ycombinator.com',
  'remoteok.com',
  'indeed.com',
  'naukri.com',
  'linkedin.com',
];

// ─── Exported helper ──────────────────────────────────────────────────────────

/**
 * Filter a list of URL strings, keeping only those whose hostname ends with
 * one of the supplied allowlist domains (exact match or subdomain).
 *
 * Exported for use in property-based tests (Property 3).
 *
 * @param urls      - Arbitrary URL strings (invalid URLs are discarded).
 * @param allowlist - Array of allowed base domains, e.g. `['greenhouse.io']`.
 * @returns         Subset of `urls` that pass the allowlist check.
 */
export function filterUrlsByAllowlist(urls: string[], allowlist: string[]): string[] {
  return urls.filter((raw) => {
    let hostname: string;
    try {
      hostname = new URL(raw).hostname.toLowerCase();
    } catch {
      return false;
    }
    return allowlist.some(
      (domain) =>
        hostname === domain.toLowerCase() ||
        hostname.endsWith(`.${domain.toLowerCase()}`),
    );
  });
}

// ─── robots.txt parsing ───────────────────────────────────────────────────────

/**
 * Fetch `https://x.com/robots.txt` and check whether `/search` is disallowed
 * for the `*` user-agent.
 *
 * Returns `true` if it is safe to proceed, `false` if `/search` is disallowed.
 */
async function isSearchAllowedByRobots(): Promise<boolean> {
  let text: string;
  try {
    const res = await fetch(ROBOTS_TXT_URL);
    if (!res.ok) {
      // If we cannot fetch robots.txt, default to allowed (fail-open).
      log.warn({ status: res.status }, 'Could not fetch robots.txt — defaulting to allowed');
      return true;
    }
    text = await res.text();
  } catch (err) {
    log.warn({ err }, 'Network error fetching robots.txt — defaulting to allowed');
    return true;
  }

  // Parse robots.txt: look for `Disallow: /search` under a `User-agent: *` block.
  let inStarBlock = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') {
      continue;
    }
    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = line.split(':')[1]?.trim() ?? '';
      inStarBlock = agent === '*';
      continue;
    }
    if (inStarBlock && lower.startsWith('disallow:')) {
      const path = line.split(':')[1]?.trim() ?? '';
      // Disallow: /search or any prefix that covers /search
      if ('/search'.startsWith(path) && path.length > 0) {
        return false;
      }
    }
  }

  return true;
}

// ─── URL resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a (possibly shortened) URL to its final destination by following
 * HTTP redirects.
 *
 * Returns `null` on network error or if the URL is invalid.
 */
async function resolveUrl(raw: string): Promise<string | null> {
  try {
    const res = await fetch(raw, { redirect: 'follow' });
    return res.url;
  } catch {
    return null;
  }
}

// ─── Connector ───────────────────────────────────────────────────────────────

/** Credentials required to log in to X/Twitter. */
export interface XCredentials {
  username: string;
  password: string;
}

export class TwitterXConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'twitter_x' as const;

  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: 3,
    refillRate: RATE_LIMIT_REFILL,
  };

  private readonly rateLimiter?: TokenBucketRateLimiter;

  /**
   * @param credentials   - Plaintext X/Twitter credentials (already decrypted by caller).
   * @param searchQueries - Queries to run, e.g. `['software engineer jobs', 'hiring SWE']`.
   * @param redis         - Optional ioredis client for rate limiting.
   */
  constructor(
    private readonly credentials: XCredentials,
    private readonly searchQueries: string[],
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.rateLimiter = new TokenBucketRateLimiter(
        'twitter_x',
        this.rateLimitConfig.maxTokens,
        this.rateLimitConfig.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings by searching X/Twitter for each configured query.
   *
   * For each query:
   * 1. Check robots.txt — skip all searches if `/search` is disallowed.
   * 2. Acquire a rate-limit token.
   * 3. Launch a headless Chromium browser, navigate to the live-search URL,
   *    scroll to collect up to 50 tweets, and extract outbound URLs.
   * 4. Resolve t.co short links to their final destinations.
   * 5. Filter through the ATS allowlist and yield matching postings.
   */
  async *discover(_preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    // robots.txt gate — checked once before any Playwright session.
    const allowed = await isSearchAllowedByRobots();
    if (!allowed) {
      log.warn('robots.txt disallows /search — TwitterXConnector yielding nothing');
      return;
    }

    for (const query of this.searchQueries) {
      const queryLog = log.child({ query });

      // Acquire rate-limit token before launching browser.
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      const encodedQuery = encodeURIComponent(query);
      const searchUrl = `${X_SEARCH_URL}?q=${encodedQuery}&f=live`;

      queryLog.info({ searchUrl }, 'Starting X/Twitter search');

      // Launch Playwright session.
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/124.0.0.0 Safari/537.36',
        });
        const page = await context.newPage();

        // ── Navigate to search ───────────────────────────────────────────
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } catch (err) {
          queryLog.error({ err }, 'Failed to navigate to X search page — skipping query');
          continue;
        }

        // ── Collect tweet URLs via scrolling ─────────────────────────────
        const tweetUrls = new Set<string>();
        let previousCount = 0;
        let staleScrolls = 0;
        const MAX_STALE = 3; // stop if 3 consecutive scrolls yield nothing new

        while (tweetUrls.size < MAX_TWEETS_PER_SEARCH && staleScrolls < MAX_STALE) {
          // Extract all anchor hrefs inside tweet article elements.
          const hrefs = await page.evaluate((): string[] => {
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const urls: string[] = [];
            for (const article of articles) {
              for (const anchor of article.querySelectorAll('a[href]')) {
                const href = (anchor as HTMLAnchorElement).href;
                // Only collect outbound links (not internal /user or /status URLs).
                if (href && !href.startsWith('https://x.com') && !href.startsWith('https://twitter.com')) {
                  urls.push(href);
                }
              }
            }
            return urls;
          });

          for (const href of hrefs) {
            if (tweetUrls.size >= MAX_TWEETS_PER_SEARCH) break;
            tweetUrls.add(href);
          }

          if (tweetUrls.size === previousCount) {
            staleScrolls++;
          } else {
            staleScrolls = 0;
            previousCount = tweetUrls.size;
          }

          // Scroll down to load more tweets.
          await page.evaluate(() => window.scrollBy(0, 1500));
          // Brief pause to let new tweets render.
          await page.waitForTimeout(1200);
        }

        queryLog.info({ urlCount: tweetUrls.size }, 'Collected outbound URLs from tweets');

        // ── Resolve short links and filter ───────────────────────────────
        const urlArray = Array.from(tweetUrls);
        const resolvedUrls: string[] = [];

        await Promise.all(
          urlArray.map(async (raw) => {
            const resolved = await resolveUrl(raw);
            if (resolved) resolvedUrls.push(resolved);
          }),
        );

        const accepted = filterUrlsByAllowlist(resolvedUrls, [...ATS_ALLOWLIST]);

        queryLog.info(
          { resolved: resolvedUrls.length, accepted: accepted.length },
          'Filtered URLs through ATS allowlist',
        );

        for (const url of accepted) {
          yield {
            sourceUrl: url,
            rawJson: { query, sourceTwitterUrl: url },
            platform: 'twitter_x',
            discoveredAt: new Date(),
          };
        }
      } finally {
        await browser.close();
      }
    }
  }
}
