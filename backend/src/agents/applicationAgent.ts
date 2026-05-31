/**
 * Application Agent
 *
 * Automates job application submission using Playwright. Handles portal login,
 * form filling, file uploads, CAPTCHA/MFA detection, and result capture.
 *
 * Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.11, 12.12, 13.1, 13.2
 */

import type { FastifyInstance } from 'fastify';
import type { BrowserContext, Page } from 'playwright';
import { createChildLogger } from '../core/logger.js';
import { BrowserPool } from '../services/browserPool.js';
import { decrypt } from '../core/encryption.js';
import { generateScreeningAnswers } from './screeningAnswers.js';
import type { ScreeningQuestion, UserProfile } from './screeningAnswers.js';
import type { ParsedJobPosting } from './discovery/types.js';
import { downloadFile, uploadFile } from '../services/storage.js';
import { prisma } from '../db.js';

const log = createChildLogger({ module: 'applicationAgent' });

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ApplicationTask {
  taskId: string;
  userId: string;
  jobPostingId: string;
  jobFingerprint: string;
  applicationUrl: string;
  resumePdfPath: string;
  coverLetterPath?: string;
  portalCredentials?: {
    username: string; // encrypted
    password: string; // encrypted
  };
  screeningQuestions?: ScreeningQuestion[];
  profile: UserProfile;
  job: ParsedJobPosting;
  attemptNumber?: number;
}

export interface ApplicationResult {
  success: boolean;
  applicationId?: string;
  screenshotPath?: string;
  confirmationNumber?: string;
  failureReason?: string;
  requiresManualIntervention: boolean;
  retryable: boolean;
  alreadyApplied?: boolean;
}

export interface PortalLoginResult {
  success: boolean;
  requiresManualIntervention: boolean;
  failureReason?: 'portal_credentials_missing' | 'credential_decryption_failed' | 'captcha_detected' | 'mfa_detected' | 'login_failed';
}

export interface ApplicationAgentOptions {
  /** Navigation timeout in ms. Default: 30_000 */
  navigationTimeoutMs?: number;
  /** Confirmation wait timeout in ms. Default: 10_000 */
  confirmationTimeoutMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WS_OPEN = 1;

// CAPTCHA detection selectors / patterns
const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[src*="recaptcha"]',
  '#cf-turnstile',
  '.h-captcha',
  '[data-sitekey]',
];
const CAPTCHA_TEXT_PATTERN = /captcha|robot|human verification/i;

// MFA detection selectors / patterns
const MFA_SELECTORS = [
  'input[name*="otp"]',
  'input[name*="mfa"]',
  'input[name*="token"]',
  'input[name*="code"][type="number"]',
];
const MFA_TEXT_PATTERN = /two.factor|2fa|verification code|authenticator/i;

// ─── WebSocket helper ─────────────────────────────────────────────────────────

type WsClient = { readyState: number; send: (data: string) => void };
type FastifyWithWs = FastifyInstance & {
  websocketServer?: { clients?: Set<WsClient> };
};

function emitWebSocketEvent(
  fastifyInstance: FastifyInstance,
  userId: string,
  event: string,
  data: Record<string, unknown>,
): void {
  const wsServer = (fastifyInstance as FastifyWithWs).websocketServer;

  if (wsServer == null || wsServer.clients == null) {
    log.warn({ userId, event }, 'WebSocket server not available — cannot emit event');
    return;
  }

  const payload = JSON.stringify({ event, userId, ...data });
  let sentCount = 0;

  for (const client of wsServer.clients) {
    if (client.readyState === WS_OPEN) {
      try {
        client.send(payload);
        sentCount++;
      } catch (err) {
        log.warn({ userId, event, err }, 'Failed to send WebSocket message to a client');
      }
    }
  }

  log.info({ userId, event, sentCount }, 'Emitted WebSocket event');
}

// ─── Screenshot helper ────────────────────────────────────────────────────────

async function captureScreenshot(
  page: Page,
  userId: string,
  taskId: string,
): Promise<string | undefined> {
  try {
    const timestamp = Date.now();
    const key = `screenshots/${userId}/${taskId}_${timestamp}.png`;
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    await uploadFile(key, Buffer.from(buffer), 'image/png');
    log.info({ userId, taskId, key }, 'Screenshot captured and stored');
    return key;
  } catch (err) {
    log.warn({ userId, taskId, err }, 'Failed to capture screenshot');
    return undefined;
  }
}

// ─── CAPTCHA / MFA detection ──────────────────────────────────────────────────

async function detectCaptcha(page: Page): Promise<boolean> {
  for (const selector of CAPTCHA_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) return true;
    } catch {
      // selector error — continue
    }
  }

  try {
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    if (CAPTCHA_TEXT_PATTERN.test(bodyText)) return true;
  } catch {
    // ignore
  }

  return false;
}

async function detectMfa(page: Page): Promise<boolean> {
  for (const selector of MFA_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) return true;
    } catch {
      // selector error — continue
    }
  }

  try {
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    if (MFA_TEXT_PATTERN.test(bodyText)) return true;
  } catch {
    // ignore
  }

  return false;
}

// ─── Form filling helpers ─────────────────────────────────────────────────────

/** Try to fill a field found by one of the given selectors. Returns true if filled. */
async function tryFillField(
  page: Page,
  selectors: string[],
  value: string | null | undefined,
): Promise<boolean> {
  if (!value) return false;

  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.fill(value);
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

/** Upload a file to a file input matching one of the given selectors. */
async function tryUploadFile(
  page: Page,
  selectors: string[],
  fileBuffer: Buffer,
  fileName: string,
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.setInputFiles({
          name: fileName,
          mimeType: 'application/pdf',
          buffer: fileBuffer,
        });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

// ─── Error classification ─────────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('net::') ||
    msg.includes('connection refused') ||
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('navigation')
  );
}

// ─── Portal login function ────────────────────────────────────────────────────

/**
 * Attempt to log in to a job portal using the provided encrypted credentials.
 *
 * - If credentials are missing, returns `{ success: false, requiresManualIntervention: true, failureReason: 'portal_credentials_missing' }`
 * - If decryption fails, returns `{ success: false, requiresManualIntervention: true, failureReason: 'credential_decryption_failed' }`
 * - If CAPTCHA is detected after login, returns `{ success: false, requiresManualIntervention: true, failureReason: 'captcha_detected' }`
 * - If MFA is detected after login, returns `{ success: false, requiresManualIntervention: true, failureReason: 'mfa_detected' }`
 * - If no login form is found (already logged in), returns `{ success: true, requiresManualIntervention: false }`
 * - On successful login, returns `{ success: true, requiresManualIntervention: false }`
 *
 * Requirements: 12.2, 12.3, 12.4
 */
export async function loginToPortal(
  page: Page,
  credentials: { username: string; password: string } | undefined | null,
  options?: { navigationTimeoutMs?: number },
): Promise<PortalLoginResult> {
  const navTimeout = options?.navigationTimeoutMs ?? 30_000;

  // Missing credentials
  if (credentials == null) {
    return { success: false, requiresManualIntervention: true, failureReason: 'portal_credentials_missing' };
  }

  // Decrypt credentials
  let username: string;
  let password: string;

  try {
    username = decrypt(credentials.username);
    password = decrypt(credentials.password);
  } catch {
    return { success: false, requiresManualIntervention: true, failureReason: 'credential_decryption_failed' };
  }

  // Find login form fields
  const emailFilled = await tryFillField(page, [
    'input[type="email"]',
    'input[name="username"]',
    'input[name="email"]',
  ], username);

  const passwordFilled = await tryFillField(page, ['input[type="password"]'], password);

  // No login form found — assume already logged in
  if (!emailFilled || !passwordFilled) {
    log.info('No login form found — may already be logged in; continuing');
    return { success: true, requiresManualIntervention: false };
  }

  // Click submit and wait for navigation
  try {
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")',
    );

    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ timeout: navTimeout, waitUntil: 'domcontentloaded' }).catch(() => undefined),
        submitBtn.click(),
      ]);
    } else {
      // Fallback: press Enter on the password field
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ timeout: navTimeout, waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
  } catch {
    // Login navigation errors are non-fatal — continue to post-login checks
  }

  // Post-login CAPTCHA check
  if (await detectCaptcha(page)) {
    return { success: false, requiresManualIntervention: true, failureReason: 'captcha_detected' };
  }

  // Post-login MFA check
  if (await detectMfa(page)) {
    return { success: false, requiresManualIntervention: true, failureReason: 'mfa_detected' };
  }

  return { success: true, requiresManualIntervention: false };
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Submit a job application using Playwright automation.
 *
 * Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.11, 12.12, 13.1, 13.2
 */
export async function submitApplication(
  task: ApplicationTask,
  pool: BrowserPool,
  fastifyInstance: FastifyInstance,
  options?: ApplicationAgentOptions,
): Promise<ApplicationResult> {
  const navTimeout = options?.navigationTimeoutMs ?? 30_000;
  const confirmTimeout = options?.confirmationTimeoutMs ?? 10_000;

  log.info(
    { taskId: task.taskId, userId: task.userId, jobPostingId: task.jobPostingId, url: task.applicationUrl },
    'Starting application submission',
  );

  // ── Step 1: Already-applied guard (req 13.1, 13.2) ─────────────────────────
  try {
    const existing = await prisma.applicationRecord.findFirst({
      where: {
        userId: task.userId,
        fingerprint: task.jobFingerprint,
      },
    });

    if (existing) {
      log.info(
        { taskId: task.taskId, userId: task.userId, jobFingerprint: task.jobFingerprint, existingId: existing.id },
        'Deduplication: application already exists — skipping',
      );
      return {
        success: false,
        alreadyApplied: true,
        requiresManualIntervention: false,
        retryable: false,
      };
    }
  } catch (err) {
    log.warn({ taskId: task.taskId, userId: task.userId, err }, 'Failed to query existing application record; proceeding');
  }

  // ── Step 2: Emit job_discovered lifecycle event (req 12.12) ────────────────
  emitWebSocketEvent(fastifyInstance, task.userId, 'job_discovered', {
    taskId: task.taskId,
    jobPostingId: task.jobPostingId,
    applicationUrl: task.applicationUrl,
    company: task.job.company,
    title: task.job.title,
  });

  // ── Step 3: Acquire browser session (req 12.11) ─────────────────────────────
  let context: BrowserContext | null = null;

  try {
    context = await pool.acquireSession();
    const page = await context.newPage();
    page.setDefaultTimeout(navTimeout);

    // ── Step 4: Navigate to application URL ───────────────────────────────────
    try {
      await page.goto(task.applicationUrl, { timeout: navTimeout, waitUntil: 'domcontentloaded' });
    } catch (navErr) {
      log.warn({ taskId: task.taskId, userId: task.userId, err: navErr }, 'Navigation error');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId,
        jobPostingId: task.jobPostingId,
        failureReason: 'navigation_error',
        screenshotPath,
      });
      return {
        success: false,
        screenshotPath,
        failureReason: 'navigation_error',
        requiresManualIntervention: false,
        retryable: isRetryableError(navErr instanceof Error ? navErr : new Error(String(navErr))),
      };
    }

    // ── Step 5: CAPTCHA/MFA check on landing page (req 12.5, 12.6) ────────────
    if (await detectCaptcha(page)) {
      log.info({ taskId: task.taskId, userId: task.userId }, 'CAPTCHA detected on landing page');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'captcha_detected', screenshotPath,
      });
      return { success: false, screenshotPath, failureReason: 'captcha_detected', requiresManualIntervention: true, retryable: false };
    }

    if (await detectMfa(page)) {
      log.info({ taskId: task.taskId, userId: task.userId }, 'MFA detected on landing page');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'mfa_detected', screenshotPath,
      });
      return { success: false, screenshotPath, failureReason: 'mfa_detected', requiresManualIntervention: true, retryable: false };
    }

    // ── Step 6: Portal login (req 12.2) ───────────────────────────────────────
    if (task.portalCredentials) {
      let username: string;
      let password: string;

      try {
        username = decrypt(task.portalCredentials.username);
        password = decrypt(task.portalCredentials.password);
      } catch (decryptErr) {
        log.warn({ taskId: task.taskId, userId: task.userId, err: decryptErr }, 'Credential decryption failed');
        const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
        emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
          taskId: task.taskId, jobPostingId: task.jobPostingId,
          failureReason: 'credential_decryption_failed', screenshotPath,
        });
        return {
          success: false, screenshotPath,
          failureReason: 'credential_decryption_failed',
          requiresManualIntervention: true, retryable: false,
        };
      }

      // Find and fill login form fields
      const emailFilled = await tryFillField(page, [
        'input[type="email"]', 'input[name="username"]', 'input[name="email"]',
      ], username);

      const passwordFilled = await tryFillField(page, ['input[type="password"]'], password);

      if (emailFilled && passwordFilled) {
        // Submit the login form
        try {
          const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")');
          if (submitBtn) {
            await Promise.all([
              page.waitForNavigation({ timeout: navTimeout, waitUntil: 'domcontentloaded' }).catch(() => undefined),
              submitBtn.click(),
            ]);
          } else {
            // Try pressing Enter on password field as fallback
            await page.keyboard.press('Enter');
            await page.waitForNavigation({ timeout: navTimeout, waitUntil: 'domcontentloaded' }).catch(() => undefined);
          }
        } catch (loginErr) {
          log.warn({ taskId: task.taskId, userId: task.userId, err: loginErr }, 'Login navigation error');
        }

        // Post-login CAPTCHA/MFA check
        if (await detectCaptcha(page)) {
          log.info({ taskId: task.taskId, userId: task.userId }, 'CAPTCHA detected after login');
          const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
          emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
            taskId: task.taskId, jobPostingId: task.jobPostingId,
            failureReason: 'captcha_detected', screenshotPath,
          });
          return { success: false, screenshotPath, failureReason: 'captcha_detected', requiresManualIntervention: true, retryable: false };
        }

        if (await detectMfa(page)) {
          log.info({ taskId: task.taskId, userId: task.userId }, 'MFA detected after login');
          const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
          emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
            taskId: task.taskId, jobPostingId: task.jobPostingId,
            failureReason: 'mfa_detected', screenshotPath,
          });
          return { success: false, screenshotPath, failureReason: 'mfa_detected', requiresManualIntervention: true, retryable: false };
        }
      } else {
        log.info({ taskId: task.taskId, userId: task.userId }, 'No login form found — may already be logged in; continuing');
      }
    }

    // ── Step 7: Detect and fill form fields (req 12.1) ────────────────────────

    // Emit resume_optimized / cover_letter_generated events at this lifecycle moment
    emitWebSocketEvent(fastifyInstance, task.userId, 'resume_optimized', {
      taskId: task.taskId, jobPostingId: task.jobPostingId,
    });
    if (task.coverLetterPath) {
      emitWebSocketEvent(fastifyInstance, task.userId, 'cover_letter_generated', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
      });
    }

    // Generate screening answers
    let screeningAnswers = await generateScreeningAnswers(
      task.screeningQuestions ?? [],
      task.profile,
      task.job,
    ).catch((err) => {
      log.warn({ taskId: task.taskId, userId: task.userId, err }, 'Failed to generate screening answers; continuing without them');
      return [];
    });

    // Fill common profile fields
    const nameParts = task.profile.fullName.split(' ');
    const firstName = nameParts[0] ?? task.profile.fullName;
    const lastName = nameParts.slice(1).join(' ') || firstName;

    await tryFillField(page, [
      'input[name*="first"][name*="name"]', 'input[name*="firstName"]',
      'input[placeholder*="first name" i]', 'input[id*="first"][id*="name"]',
    ], firstName);

    await tryFillField(page, [
      'input[name*="last"][name*="name"]', 'input[name*="lastName"]',
      'input[placeholder*="last name" i]', 'input[id*="last"][id*="name"]',
    ], lastName);

    await tryFillField(page, [
      'input[name*="full"][name*="name"]', 'input[name*="fullName"]',
      'input[placeholder*="full name" i]',
    ], task.profile.fullName);

    await tryFillField(page, [
      'input[type="email"]', 'input[name*="email"]',
      'input[id*="email"]', 'input[placeholder*="email" i]',
    ], task.profile.email);

    await tryFillField(page, [
      'input[type="tel"]', 'input[name*="phone"]',
      'input[id*="phone"]', 'input[placeholder*="phone" i]',
    ], task.profile.phone ?? undefined);

    await tryFillField(page, [
      'input[name*="location"]', 'input[name*="city"]',
      'input[id*="location"]', 'input[id*="city"]',
      'input[placeholder*="location" i]', 'input[placeholder*="city" i]',
    ], task.profile.location);

    // LinkedIn URL if available — access via optional field
    const profileAny = task.profile as unknown as Record<string, unknown>;
    const linkedinUrl = typeof profileAny['linkedinUrl'] === 'string' ? profileAny['linkedinUrl'] : undefined;
    if (linkedinUrl) {
      await tryFillField(page, [
        'input[name*="linkedin"]', 'input[id*="linkedin"]',
        'input[placeholder*="linkedin" i]',
      ], linkedinUrl);
    }

    // Fill screening answers that don't require manual completion
    for (const answer of screeningAnswers) {
      if (answer.requiresManualCompletion || !answer.answer) continue;
      await tryFillField(page, [
        `input[name*="${answer.questionType}"]`,
        `input[id*="${answer.questionType}"]`,
        `textarea[name*="${answer.questionType}"]`,
        `select[name*="${answer.questionType}"]`,
      ], answer.answer);
    }

    // ── Step 8: Upload resume and cover letter (req 12.1) ─────────────────────
    try {
      const resumeBuffer = await downloadFile(task.resumePdfPath);
      const resumeUploaded = await tryUploadFile(
        page,
        [
          'input[type="file"][name*="resume"]',
          'input[type="file"][accept*=".pdf"]',
          'input[type="file"]',
        ],
        resumeBuffer,
        'resume.pdf',
      );
      if (resumeUploaded) {
        log.info({ taskId: task.taskId, userId: task.userId }, 'Resume PDF uploaded');
      } else {
        log.warn({ taskId: task.taskId, userId: task.userId }, 'No resume file input found on form');
      }
    } catch (err) {
      log.warn({ taskId: task.taskId, userId: task.userId, err }, 'Failed to upload resume; continuing');
    }

    if (task.coverLetterPath) {
      try {
        const coverLetterBuffer = await downloadFile(task.coverLetterPath);
        const clUploaded = await tryUploadFile(
          page,
          [
            'input[type="file"][name*="cover"]',
            'input[type="file"][name*="letter"]',
            'input[type="file"][accept*=".pdf"]:nth-of-type(2)',
          ],
          coverLetterBuffer,
          'cover-letter.pdf',
        );
        if (clUploaded) {
          log.info({ taskId: task.taskId, userId: task.userId }, 'Cover letter PDF uploaded');
        }
      } catch (err) {
        log.warn({ taskId: task.taskId, userId: task.userId, err }, 'Failed to upload cover letter; continuing');
      }
    }

    // ── Step 9: Final CAPTCHA/MFA check before submit (req 12.5, 12.6) ────────
    if (await detectCaptcha(page)) {
      log.info({ taskId: task.taskId, userId: task.userId }, 'CAPTCHA detected before submit');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'captcha_detected', screenshotPath,
      });
      return { success: false, screenshotPath, failureReason: 'captcha_detected', requiresManualIntervention: true, retryable: false };
    }

    if (await detectMfa(page)) {
      log.info({ taskId: task.taskId, userId: task.userId }, 'MFA detected before submit');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'mfa_detected', screenshotPath,
      });
      return { success: false, screenshotPath, failureReason: 'mfa_detected', requiresManualIntervention: true, retryable: false };
    }

    // ── Step 10: Submit form ──────────────────────────────────────────────────
    try {
      const submitButton = await page.$(
        'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply Now"), button:has-text("Apply")',
      );

      if (!submitButton) {
        log.warn({ taskId: task.taskId, userId: task.userId }, 'No submit button found on form');
        const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
        emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
          taskId: task.taskId, jobPostingId: task.jobPostingId,
          failureReason: 'submit_button_not_found', screenshotPath,
        });
        return {
          success: false, screenshotPath,
          failureReason: 'submit_button_not_found',
          requiresManualIntervention: false, retryable: false,
        };
      }

      await Promise.all([
        page.waitForNavigation({ timeout: navTimeout, waitUntil: 'domcontentloaded' }).catch(() => undefined),
        submitButton.click(),
      ]);
    } catch (submitErr) {
      log.warn({ taskId: task.taskId, userId: task.userId, err: submitErr }, 'Error clicking submit button');
      const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'submit_error', screenshotPath,
      });
      return {
        success: false, screenshotPath,
        failureReason: 'submit_error',
        requiresManualIntervention: false,
        retryable: isRetryableError(submitErr instanceof Error ? submitErr : new Error(String(submitErr))),
      };
    }

    // ── Step 11: Wait for confirmation ────────────────────────────────────────
    let confirmed = false;
    let confirmationNumber: string | undefined;

    try {
      await page.waitForFunction(
        () => {
          const url = window.location.href;
          const body = document.body?.innerText ?? '';
          const hasConfirmationEl =
            document.querySelector('.confirmation') != null ||
            document.querySelector('[data-testid*="success"]') != null;
          const hasConfirmationText = /application.*submitted|thank you|we.*received/i.test(body);
          const urlChanged = url !== window.location.href;
          return hasConfirmationEl || hasConfirmationText || urlChanged;
        },
        { timeout: confirmTimeout },
      );
      confirmed = true;

      // Try to extract a confirmation number from page text
      try {
        const pageText = await page.evaluate(() => document.body?.innerText ?? '');
        const confirmMatch = pageText.match(/confirmation[^\d]*(\d{5,})/i) ??
          pageText.match(/reference[^\d]*(\d{5,})/i) ??
          pageText.match(/application[^\d]*#?\s*(\w{6,})/i);
        if (confirmMatch?.[1]) {
          confirmationNumber = confirmMatch[1];
        }
      } catch {
        // ignore — confirmation number is optional
      }
    } catch {
      // Timeout on confirmation wait — check URL change as a fallback signal
      const currentUrl = page.url();
      if (currentUrl !== task.applicationUrl) {
        // URL changed — likely navigated to a success page
        confirmed = true;
        log.info({ taskId: task.taskId, userId: task.userId, currentUrl }, 'URL changed after submit — assuming success');
      } else {
        log.info({ taskId: task.taskId, userId: task.userId }, 'No confirmation indicator found within timeout');
      }
    }

    // ── Step 12: Capture final screenshot (req 12.7) ──────────────────────────
    const screenshotPath = await captureScreenshot(page, task.userId, task.taskId);

    // ── Step 13: Emit final lifecycle event (req 12.12) ───────────────────────
    if (confirmed) {
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_submitted', {
        taskId: task.taskId,
        jobPostingId: task.jobPostingId,
        company: task.job.company,
        title: task.job.title,
        screenshotPath,
        confirmationNumber,
      });

      log.info(
        { taskId: task.taskId, userId: task.userId, jobPostingId: task.jobPostingId, confirmationNumber },
        'Application submitted successfully',
      );

      return {
        success: true,
        screenshotPath,
        confirmationNumber,
        requiresManualIntervention: false,
        retryable: false,
      };
    } else {
      emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
        taskId: task.taskId, jobPostingId: task.jobPostingId,
        failureReason: 'no_confirmation', screenshotPath,
      });

      log.warn(
        { taskId: task.taskId, userId: task.userId, jobPostingId: task.jobPostingId },
        'Application submission — no confirmation indicator detected',
      );

      return {
        success: false,
        screenshotPath,
        failureReason: 'no_confirmation',
        requiresManualIntervention: false,
        retryable: false,
      };
    }

  } catch (err) {
    // Top-level unexpected error
    log.error({ taskId: task.taskId, userId: task.userId, err }, 'Unexpected error during application submission');

    emitWebSocketEvent(fastifyInstance, task.userId, 'application_failed', {
      taskId: task.taskId, jobPostingId: task.jobPostingId,
      failureReason: 'unexpected_error',
    });

    return {
      success: false,
      failureReason: 'unexpected_error',
      requiresManualIntervention: false,
      retryable: isRetryableError(err instanceof Error ? err : new Error(String(err))),
    };
  } finally {
    // ── Step 3 (finally): Always release browser session (req 12.11) ─────────
    if (context !== null) {
      pool.releaseSession(context);
      log.debug({ taskId: task.taskId, userId: task.userId }, 'Browser session released');
    }
  }
}
