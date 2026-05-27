/**
 * LinkedIn Job Discovery Connector
 *
 * Searches LinkedIn Jobs for postings matching the user's target roles and
 * preferred locations using Playwright.  For each job card found on the
 * search results page it:
 *
 *  1. Skips "Easy Apply" cards (out of scope for this version).
 *  2. Follows the card link to capture the external ATS redirect URL.
 *
 * Rate limits (Requirements 5.5):
 *  - Max 20 job cards per session (in-memory counter, reset each session).
 *  - Min 10-minute interval between consecutive sessions (TokenBucketRateLimiter).
 *
 * CAPTCHA handling (Requirements 5.6):
 *  - Detects checkpoint / authwall / verification pages.
 *  - Captures a screenshot, logs a `manual_intervention_required` warning,
 *    and returns immediately — never attempts to bypass the CAPTCHA.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { chromium } from 'playwright';
import type { Redis } from 'ioredis';
import { BaseJobDiscoveryConnector } from '../base.js';
import type { JobPreferences, RateLimitConfig, RawJobPosting } from '../types.js';
import { TokenBucketRateLimiter } from '../../../services/rateLimiter.js';
import { createChildLogger } from '../../../core/logger.js';

const log = createChildLogger({ service: 'LinkedInConnector' });

// ─── Exported rate-limit constants ────────────────────────────────────────────

/** Maximum number of job cards processed in a single discovery session. */
export const MAX_CARDS_PER_SESSION = 20;

/** Minimum time between consecutive LinkedIn discovery sessions (ms). */
export const MIN_SESSION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * TokenBucketRateLimiter configuration for the session-interval enforcer.
 * 1 session per 600 seconds (10 minutes).
 */
export const SESSION_RATE_LIMIT_CONFIG = {
  maxTokens: 1,
  refillRate: 1 / 600, // 1 token per 600 seconds = 1 session per 10 minutes
} as const;

// ─── Internal constants ───────────────────────────────────────────────────────

const LINKEDIN_JOBS_BASE = 'https://www.linkedin.com/jobs/search/';
const LINKEDIN_ROBOTS_URL = 'https://www.linkedin.com/robots.txt';

/** CAPTCHA / verification indicators in the page URL. */
const CAPTCHA_URL_PATTERNS = ['checkpoint', 'authwall'];

/** CAPTCHA / verification indicators in the page body text. */
const CAPTCHA_TEXT_PATTERNS = [
  'Security Verification',
  "verify you're a human",
  'verify you are a human',
  'CAPTCHA',
  'Let\'s do a quick security check',
  'Please complete the security check',
];

// ─── Credential type ──────────────────────────────────────────────────────────

/** Credentials required to use the LinkedIn connector. */
export interface LinkedInCredentials {
  /** LinkedIn account email address. */
  username: string;
  /** Plaintext password (already decrypted by the caller). */
  password: string;
}

// ─── robots.txt helper ────────────────────────────────────────────────────────

/**
 * Fetch `https://www.linkedin.com/robots.txt` and check whether the `/jobs`
 * path is disallowed for the `*` user-agent.
 *
 * Returns `true` if it is safe to proceed, `false` if the path is disallowed.
 * Defaults to allowed (fail-open) when the file cannot be fetched.
 */
async function isJobsAllowedByRobots(): Promise<boolean> {
  let text: string;
  try {
    const res = await fetch(LINKEDIN_ROBOTS_URL);
    if (!res.ok) {
      log.warn({ status: res.status }, 'Could not fetch LinkedIn robots.txt — defaulting to allowed');
      return true;
    }
    text = await res.text();
  } catch (err) {
    log.warn({ err }, 'Network error fetching LinkedIn robots.txt — defaulting to allowed');
    return true;
  }

  // Parse robots.txt: check for `Disallow: /jobs` under `User-agent: *`.
  let inStarBlock = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') continue;

    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = line.split(':')[1]?.trim() ?? '';
      inStarBlock = agent === '*';
      continue;
    }
    if (inStarBlock && lower.startsWith('disallow:')) {
      const path = line.split(':')[1]?.trim() ?? '';
      if (path.length > 0 && '/jobs'.startsWith(path)) {
        return false;
      }
    }
  }

  return true;
}

// ─── CAPTCHA detection ────────────────────────────────────────────────────────

/**
 * Check whether the current page appears to be a CAPTCHA / verification wall.
 */
function isCaptchaUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return CAPTCHA_URL_PATTERNS.some((p) => lower.includes(p));
}

function isCaptchaContent(bodyText: string): boolean {
  return CAPTCHA_TEXT_PATTERNS.some((p) =>
    bodyText.toLowerCase().includes(p.toLowerCase()),
  );
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class LinkedInConnector extends BaseJobDiscoveryConnector {
  readonly sourceName = 'linkedin' as const;

  /**
   * Rate limit config reflects the session-interval enforcer:
   * 1 session per 10 minutes.
   */
  readonly rateLimitConfig: RateLimitConfig = {
    maxTokens: SESSION_RATE_LIMIT_CONFIG.maxTokens,
    refillRate: SESSION_RATE_LIMIT_CONFIG.refillRate,
  };

  private readonly sessionRateLimiter?: TokenBucketRateLimiter;

  /**
   * @param credentials - Plaintext LinkedIn credentials (already decrypted by caller).
   * @param redis       - Optional ioredis client for session-interval rate limiting.
   */
  constructor(
    private readonly credentials: LinkedInCredentials,
    redis?: Redis,
  ) {
    super();
    if (redis) {
      this.sessionRateLimiter = new TokenBucketRateLimiter(
        'linkedin_session',
        SESSION_RATE_LIMIT_CONFIG.maxTokens,
        SESSION_RATE_LIMIT_CONFIG.refillRate,
        redis,
      );
    }
  }

  /**
   * Discover job postings on LinkedIn matching the given preferences.
   *
   * For each combination of `targetRole` × `preferredLocation`:
   *  1. Check robots.txt.
   *  2. Acquire a session-interval rate-limit token (enforces ≥ 10 min between sessions).
   *  3. Launch a headless Chromium browser and navigate to the search results page.
   *  4. Collect up to `MAX_CARDS_PER_SESSION` job cards.
   *  5. For each card: skip Easy Apply; follow the link; capture the ATS redirect URL.
   *  6. On CAPTCHA detection: capture screenshot, log warning, stop the session.
   *
   * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
   */
  async *discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting> {
    // robots.txt gate — checked once before any Playwright session.
    const allowed = await isJobsAllowedByRobots();
    if (!allowed) {
      log.warn('robots.txt disallows /jobs — LinkedInConnector yielding nothing');
      return;
    }

    const roles = preferences.targetRoles.length > 0
      ? preferences.targetRoles
      : ['software engineer'];

    const locations = preferences.preferredLocations.length > 0
      ? preferences.preferredLocations
      : [''];

    for (const role of roles) {
      for (const location of locations) {
        yield* this._runSession(role, location);
      }
    }
  }

  /**
   * Run a single LinkedIn discovery session for one role + location pair.
   * Enforces the session-interval rate limit before launching the browser.
   */
  private async *_runSession(
    role: string,
    location: string,
  ): AsyncGenerator<RawJobPosting> {
    const sessionLog = log.child({ role, location });

    // Acquire session-interval token (blocks until ≥ 10 min since last session).
    if (this.sessionRateLimiter) {
      sessionLog.info('Acquiring LinkedIn session rate-limit token');
      await this.sessionRateLimiter.acquire();
    }

    const searchUrl =
      `${LINKEDIN_JOBS_BASE}?keywords=${encodeURIComponent(role)}` +
      (location ? `&location=${encodeURIComponent(location)}` : '');

    sessionLog.info({ searchUrl }, 'Starting LinkedIn job discovery session');

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // ── Navigate to LinkedIn Jobs search ──────────────────────────────
      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err) {
        sessionLog.error({ err }, 'Failed to navigate to LinkedIn search page — skipping session');
        return;
      }

      // ── CAPTCHA check after initial navigation ────────────────────────
      if (await this._detectAndHandleCaptcha(page)) {
        sessionLog.warn('CAPTCHA detected on search page — stopping session');
        return;
      }

      // ── Collect job card links (up to MAX_CARDS_PER_SESSION) ──────────
      const cardLinks = await this._collectJobCardLinks(page, sessionLog);
      sessionLog.info({ count: cardLinks.length }, 'Collected job card links');

      // ── Process each card ─────────────────────────────────────────────
      let cardCount = 0;
      for (const card of cardLinks) {
        if (cardCount >= MAX_CARDS_PER_SESSION) break;

        const cardLog = sessionLog.child({ cardUrl: card.url, title: card.title });

        // Navigate to the individual job card.
        let cardPage;
        try {
          cardPage = await context.newPage();
          await cardPage.goto(card.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        } catch (err) {
          cardLog.warn({ err }, 'Failed to load job card — skipping');
          await cardPage?.close();
          continue;
        }

        // CAPTCHA check on card page.
        if (await this._detectAndHandleCaptcha(cardPage)) {
          cardLog.warn('CAPTCHA detected on job card page — stopping session');
          await cardPage.close();
          return;
        }

        // Skip Easy Apply cards.
        const isEasyApply = await this._isEasyApply(cardPage);
        if (isEasyApply) {
          cardLog.info('Skipping Easy Apply card');
          await cardPage.close();
          continue;
        }

        // Capture the external ATS redirect URL.
        const atsUrl = await this._extractAtsRedirectUrl(cardPage);
        await cardPage.close();

        if (!atsUrl) {
          cardLog.info('No external ATS URL found on card — skipping');
          continue;
        }

        cardCount++;
        cardLog.info({ atsUrl }, 'Yielding LinkedIn job posting');

        yield {
          sourceUrl: atsUrl,
          rawJson: {
            linkedInCardUrl: card.url,
            title: card.title,
            company: card.company,
            location: card.location,
            atsUrl,
            role,
            searchLocation: location,
          },
          platform: 'linkedin',
          discoveredAt: new Date(),
        };
      }

      sessionLog.info({ cardCount }, 'LinkedIn session completed');
    } finally {
      await browser.close();
    }
  }

  /**
   * Collect job card metadata from the current search results page,
   * capped at MAX_CARDS_PER_SESSION entries.
   */
  private async _collectJobCardLinks(
    page: import('playwright').Page,
    sessionLog: ReturnType<typeof createChildLogger>,
  ): Promise<Array<{ url: string; title: string; company: string; location: string }>> {
    // Wait briefly for cards to render.
    try {
      await page.waitForSelector('.job-search-card, .base-card, [data-entity-urn]', {
        timeout: 10_000,
      });
    } catch {
      sessionLog.warn('Job card selector did not appear — page may be empty or blocked');
    }

    const cards = await page.evaluate((maxCards: number) => {
      const results: Array<{
        url: string;
        title: string;
        company: string;
        location: string;
      }> = [];

      // LinkedIn job cards: public search results use `.job-search-card` or `.base-card`.
      const cardEls = document.querySelectorAll(
        '.job-search-card a.base-card__full-link, .base-card a.base-card__full-link, a[data-tracking-control-name="public_jobs_jserp-result_search-card"]',
      );

      for (const el of cardEls) {
        if (results.length >= maxCards) break;
        const anchor = el as HTMLAnchorElement;
        const card = anchor.closest('.job-search-card, .base-card') as HTMLElement | null;

        const title =
          card?.querySelector('.base-search-card__title, h3')?.textContent?.trim() ?? '';
        const company =
          card?.querySelector('.base-search-card__subtitle, h4')?.textContent?.trim() ?? '';
        const location =
          card?.querySelector('.job-search-card__location, .base-search-card__metadata')
            ?.textContent?.trim() ?? '';

        if (anchor.href) {
          results.push({ url: anchor.href, title, company, location });
        }
      }

      return results;
    }, MAX_CARDS_PER_SESSION);

    return cards;
  }

  /**
   * Check whether the current page is a CAPTCHA / verification wall.
   * If it is, capture a screenshot and emit a `manual_intervention_required`
   * log warning.  Never attempts to bypass the CAPTCHA.
   *
   * @returns `true` if CAPTCHA was detected (caller should stop the session).
   */
  private async _detectAndHandleCaptcha(
    page: import('playwright').Page,
  ): Promise<boolean> {
    const currentUrl = page.url();
    let bodyText = '';
    try {
      bodyText = await page.innerText('body');
    } catch {
      // If we can't read body text, rely on URL check only.
    }

    const captchaDetected =
      isCaptchaUrl(currentUrl) || isCaptchaContent(bodyText);

    if (!captchaDetected) return false;

    // Capture screenshot as PNG buffer.
    let screenshotBase64 = '';
    try {
      const screenshotBuffer = await page.screenshot({ type: 'png' });
      screenshotBase64 = screenshotBuffer.toString('base64');
    } catch (err) {
      log.warn({ err }, 'Failed to capture CAPTCHA screenshot');
    }

    log.warn(
      {
        event: 'manual_intervention_required',
        url: currentUrl,
        screenshotBase64: screenshotBase64
          ? `data:image/png;base64,${screenshotBase64.slice(0, 100)}…`
          : undefined,
      },
      'LinkedIn CAPTCHA / verification wall detected — manual intervention required',
    );

    return true;
  }

  /**
   * Check whether the current job card page has an "Easy Apply" button.
   * Easy Apply jobs are skipped (out of scope for this version).
   *
   * Requirements: 5.3
   */
  private async _isEasyApply(
    page: import('playwright').Page,
  ): Promise<boolean> {
    try {
      const easyApplyBtn = await page.$(
        'button[aria-label*="Easy Apply"], .jobs-apply-button--top-card .artdeco-button__text',
      );
      if (easyApplyBtn) {
        const text = (await easyApplyBtn.textContent()) ?? '';
        return text.toLowerCase().includes('easy apply');
      }
    } catch {
      // If selector lookup fails, assume not Easy Apply.
    }
    return false;
  }

  /**
   * Extract the external ATS redirect URL from a LinkedIn job card page.
   *
   * LinkedIn wraps external apply links; we look for the "Apply" button
   * href or the redirect anchor that points outside linkedin.com.
   *
   * Requirements: 5.2
   */
  private async _extractAtsRedirectUrl(
    page: import('playwright').Page,
  ): Promise<string | null> {
    try {
      // Look for the external apply button / link.
      const applyUrl = await page.evaluate((): string | null => {
        // Try the top-card apply button first.
        const applyBtn = document.querySelector<HTMLAnchorElement>(
          'a.jobs-apply-button, .jobs-apply-button--top-card a, a[data-tracking-control-name*="apply"]',
        );
        if (applyBtn?.href) return applyBtn.href;

        // Fallback: any link in the apply section that goes outside LinkedIn.
        const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
        for (const a of allLinks) {
          const href = a.href ?? '';
          if (
            href &&
            !href.includes('linkedin.com') &&
            (href.startsWith('https://') || href.startsWith('http://'))
          ) {
            return href;
          }
        }
        return null;
      });

      return applyUrl ?? null;
    } catch (err) {
      log.warn({ err }, 'Error extracting ATS redirect URL');
      return null;
    }
  }
}
