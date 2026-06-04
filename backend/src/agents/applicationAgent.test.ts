/**
 * Property 13: CAPTCHA and MFA Non-Bypass
 * Validates: Requirements 12.5, 12.6
 *
 * Property 15: Browser Session Release Guarantee
 * Validates: Requirements 12.11
 *
 * Tests use mocked Playwright pages to simulate CAPTCHA/MFA detection and
 * error injection without launching a real browser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { FastifyInstance } from 'fastify';

// ─── Module-level mocks (must appear before any imports of the subject) ────────

vi.mock('../services/storage.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('screenshots/test/key.png'),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf')),
}));

vi.mock('../db.js', () => ({
  prisma: {
    applicationRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'app-1' }),
    },
  },
}));

vi.mock('../core/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./screeningAnswers.js', () => ({
  generateScreeningAnswers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../core/encryption.js', () => ({
  decrypt: vi.fn((v: string) => v),
  encrypt: vi.fn((v: string) => v),
  applyEncryptionMiddleware: vi.fn(),
}));

import { submitApplication, type ApplicationTask } from './applicationAgent.js';
import type { BrowserPool } from '../services/browserPool.js';

// ─── Fake page factory ────────────────────────────────────────────────────────

function createFakePage(options: {
  hasCaptcha?: boolean;
  hasMfa?: boolean;
  navigationThrows?: boolean;
  submitThrows?: boolean;
} = {}) {
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn(async () => {
      if (options.navigationThrows) throw new Error('net::ERR_CONNECTION_REFUSED');
    }),
    $: vi.fn(async (selector: string) => {
      if (options.hasCaptcha) {
        // CAPTCHA_SELECTORS: 'iframe[src*="captcha"]', 'iframe[src*="recaptcha"]',
        //   '#cf-turnstile', '.h-captcha', '[data-sitekey]'
        if (
          selector.includes('captcha') ||
          selector.includes('recaptcha') ||
          selector === '#cf-turnstile' ||
          selector === '.h-captcha' ||
          selector.includes('data-sitekey')
        ) {
          return {}; // non-null = element found
        }
      }
      if (options.hasMfa) {
        // MFA_SELECTORS: 'input[name*="otp"]', 'input[name*="mfa"]',
        //   'input[name*="token"]', 'input[name*="code"][type="number"]'
        if (
          selector.includes('otp') ||
          selector.includes('mfa') ||
          selector.includes('token') ||
          (selector.includes('code') && selector.includes('number'))
        ) {
          return {};
        }
      }
      return null;
    }),
    evaluate: vi.fn(async () => {
      if (options.hasCaptcha) return 'Please complete the captcha verification';
      if (options.hasMfa) return 'Enter your two-factor authentication code';
      return 'Apply for this position';
    }),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    url: vi.fn().mockReturnValue('https://jobs.example.com/apply'),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockRejectedValue(new Error('timeout')),
    locator: vi.fn().mockReturnValue({ boundingBox: vi.fn().mockResolvedValue(null) }),
  };
  return page;
}

// ─── Mock pool factory ────────────────────────────────────────────────────────

function createMockPool(
  fakePage: ReturnType<typeof createFakePage>,
  throwOnAcquire = false,
) {
  const fakeContext = {
    newPage: vi.fn().mockResolvedValue(fakePage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const releaseSession = vi.fn();
  const pool = {
    acquireSession: vi.fn(async () => {
      if (throwOnAcquire) throw new Error('pool exhausted');
      return fakeContext;
    }),
    releaseSession,
  } as unknown as BrowserPool;
  return { pool, releaseSession, fakeContext };
}

// ─── Mock Fastify ─────────────────────────────────────────────────────────────

const mockFastify = {
  websocketServer: { clients: new Set() },
} as unknown as FastifyInstance;

// ─── Minimal valid ApplicationTask ───────────────────────────────────────────

function makeTask(overrides: Partial<ApplicationTask> = {}): ApplicationTask {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    jobPostingId: 'job-1',
    jobFingerprint: 'fp-abc',
    applicationUrl: 'https://jobs.example.com/apply',
    resumePdfPath: 'resumes/user-1/resume.pdf',
    profile: {
      userId: 'user-1',
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      location: 'Remote',
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      noticePeriod: 0,
      remotePreference: 'remote_only',
      targetRoles: ['Engineer'],
      preferredLocations: ['Remote'],
      currency: 'USD',
      employmentTypes: ['full_time'],
      workExperiences: [],
      educations: [],
      skills: [],
      certifications: [],
    } as unknown as ApplicationTask['profile'],
    job: {
      sourceUrl: 'https://jobs.example.com/job/1',
      platform: 'greenhouse',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      company: 'Acme',
      title: 'Engineer',
      requiredSkills: [],
      preferredSkills: [],
      yearsExperienceMin: null,
      yearsExperienceMax: null,
      location: null,
      isRemote: true,
      isHybrid: false,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      employmentType: null,
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: 'https://jobs.example.com/apply',
      rawJson: {},
      rawHtml: null,
      status: 'parsed',
    } as unknown as ApplicationTask['job'],
    ...overrides,
  };
}

// ─── Property 13: CAPTCHA Non-Bypass ─────────────────────────────────────────
// **Validates: Requirements 12.5, 12.6**

describe('Property 13: CAPTCHA Non-Bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success=false and requiresManualIntervention=true for any CAPTCHA scenario', async () => {
    const page = createFakePage({ hasCaptcha: true });
    const { pool, releaseSession } = createMockPool(page);
    const result = await submitApplication(makeTask(), pool, mockFastify);
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(true);
    expect(result.failureReason).toContain('captcha');
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('property: CAPTCHA always yields requiresManualIntervention=true', async () => {
    /**
     * **Validates: Requirements 12.5**
     *
     * For any arbitrary task input where the page contains a CAPTCHA element,
     * submitApplication must never succeed and must always require manual intervention.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          taskId: fc.uuid(),
          userId: fc.uuid(),
          jobFingerprint: fc.string({ minLength: 8, maxLength: 32 }),
        }),
        async ({ taskId, userId, jobFingerprint }) => {
          const page = createFakePage({ hasCaptcha: true });
          const { pool } = createMockPool(page);
          const result = await submitApplication(
            makeTask({ taskId, userId, jobFingerprint }),
            pool,
            mockFastify,
          );
          return result.success === false && result.requiresManualIntervention === true;
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 13: MFA Non-Bypass ─────────────────────────────────────────────
// **Validates: Requirements 12.5, 12.6**

describe('Property 13: MFA Non-Bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success=false and requiresManualIntervention=true for any MFA scenario', async () => {
    /**
     * **Validates: Requirements 12.6**
     */
    const page = createFakePage({ hasMfa: true });
    const { pool, releaseSession } = createMockPool(page);
    const result = await submitApplication(makeTask(), pool, mockFastify);
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(true);
    expect(result.failureReason).toContain('mfa');
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('property: MFA always yields requiresManualIntervention=true', async () => {
    /**
     * **Validates: Requirements 12.6**
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          taskId: fc.uuid(),
          userId: fc.uuid(),
          jobFingerprint: fc.string({ minLength: 8, maxLength: 32 }),
        }),
        async ({ taskId, userId, jobFingerprint }) => {
          const page = createFakePage({ hasMfa: true });
          const { pool } = createMockPool(page);
          const result = await submitApplication(
            makeTask({ taskId, userId, jobFingerprint }),
            pool,
            mockFastify,
          );
          return result.success === false && result.requiresManualIntervention === true;
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ─── Property 15: Browser Session Release Guarantee ──────────────────────────
// **Validates: Requirements 12.11**

describe('Property 15: Browser Session Release Guarantee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always calls releaseSession on success path', async () => {
    const page = createFakePage({});
    const { pool, releaseSession } = createMockPool(page);
    await submitApplication(makeTask(), pool, mockFastify);
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('always calls releaseSession on CAPTCHA detection', async () => {
    const page = createFakePage({ hasCaptcha: true });
    const { pool, releaseSession } = createMockPool(page);
    await submitApplication(makeTask(), pool, mockFastify);
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('always calls releaseSession on navigation error', async () => {
    const page = createFakePage({ navigationThrows: true });
    const { pool, releaseSession } = createMockPool(page);
    await submitApplication(makeTask(), pool, mockFastify);
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('always calls releaseSession on MFA detection', async () => {
    const page = createFakePage({ hasMfa: true });
    const { pool, releaseSession } = createMockPool(page);
    await submitApplication(makeTask(), pool, mockFastify);
    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('property: releaseSession called exactly once for any error scenario', async () => {
    /**
     * **Validates: Requirements 12.11**
     *
     * Inject errors at random points via page configuration; assert browser
     * pool's releaseSession is always called exactly once after each call
     * regardless of error type.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          hasCaptcha: fc.boolean(),
          hasMfa: fc.boolean(),
          navigationThrows: fc.boolean(),
        }),
        async ({ hasCaptcha, hasMfa, navigationThrows }) => {
          const page = createFakePage({ hasCaptcha, hasMfa, navigationThrows });
          const { pool, releaseSession } = createMockPool(page);
          await submitApplication(makeTask(), pool, mockFastify);
          return (releaseSession as ReturnType<typeof vi.fn>).mock.calls.length === 1;
        },
      ),
      { numRuns: 20 },
    );
  });

  it('property: releaseSession called exactly once even when acquireSession throws', async () => {
    /**
     * **Validates: Requirements 12.11**
     *
     * When acquireSession fails (pool exhausted), the finally block should not
     * call releaseSession (context is null), but the function must not throw.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // no variation needed — just run a few times
        async () => {
          const page = createFakePage({});
          const { pool, releaseSession } = createMockPool(page, /* throwOnAcquire */ true);
          // Should not throw — returns an error result
          const result = await submitApplication(makeTask(), pool, mockFastify);
          // When acquire fails, releaseSession must NOT be called (no context to release)
          return result.success === false &&
            (releaseSession as ReturnType<typeof vi.fn>).mock.calls.length === 0;
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ─── Property 16: No Duplicate Applications ──────────────────────────────────
// **Validates: Requirements 13.1, 13.2**

import { prisma } from '../db.js';

describe('Property 16: No Duplicate Applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deterministic: second call for same (userId, fingerprint) returns alreadyApplied=true', async () => {
    /**
     * **Validates: Requirements 13.1, 13.2**
     *
     * First call: findFirst returns null → application goes through.
     * Second call: findFirst returns an existing record → alreadyApplied=true.
     */
    const existingRecord = { id: 'app-existing', userId: 'user-dup', fingerprint: 'fp-dup' };
    const findFirstMock = vi.mocked(prisma.applicationRecord.findFirst);

    // First call: no record exists yet
    findFirstMock.mockResolvedValueOnce(null);
    const page1 = createFakePage({});
    const { pool: pool1 } = createMockPool(page1);
    const result1 = await submitApplication(
      makeTask({ userId: 'user-dup', jobFingerprint: 'fp-dup' }),
      pool1,
      mockFastify,
    );

    // Second call: record now exists (simulates DB constraint)
    findFirstMock.mockResolvedValueOnce(existingRecord as never);
    const page2 = createFakePage({});
    const { pool: pool2, releaseSession: releaseSession2 } = createMockPool(page2);
    const result2 = await submitApplication(
      makeTask({ userId: 'user-dup', jobFingerprint: 'fp-dup' }),
      pool2,
      mockFastify,
    );

    // First call may succeed or fail for other reasons, but must NOT be alreadyApplied
    expect(result1.alreadyApplied).toBeFalsy();

    // Second call must be flagged as duplicate
    expect(result2.alreadyApplied).toBe(true);
    expect(result2.success).toBe(false);

    // No browser session should be acquired for the duplicate — dedup happens before acquireSession
    expect(releaseSession2).not.toHaveBeenCalled();
  });

  it('property: at most one concurrent call succeeds for the same (userId, fingerprint)', async () => {
    /**
     * **Validates: Requirements 13.1, 13.2**
     *
     * Simulate N concurrent submitApplication calls for the same (userId, fingerprint).
     * The mock tracks a per-pair "seen" state: first call gets null, subsequent calls
     * get an existing record. Assert that at most 1 result is NOT alreadyApplied=true.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          fingerprint: fc.string({ minLength: 8, maxLength: 64 }),
        }),
        async ({ userId, fingerprint }) => {
          vi.clearAllMocks();

          const existingRecord = { id: 'app-concurrent', userId, fingerprint };
          let callCount = 0;

          // First invocation returns null (no record); all subsequent return the record
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (vi.mocked(prisma.applicationRecord.findFirst) as any).mockImplementation(async () => {
            callCount += 1;
            if (callCount === 1) return null;
            return existingRecord;
          });

          const concurrentCalls = Array.from({ length: 4 }, () => {
            const page = createFakePage({});
            const { pool } = createMockPool(page);
            return submitApplication(makeTask({ userId, jobFingerprint: fingerprint }), pool, mockFastify);
          });

          const results = await Promise.all(concurrentCalls);

          // At most 1 result should NOT be flagged as alreadyApplied
          const notDuplicated = results.filter((r) => r.alreadyApplied !== true);
          return notDuplicated.length <= 1;
        },
      ),
      { numRuns: 20 },
    );
  });

  it('DB constraint guard: when findFirst always returns a record, every call returns alreadyApplied=true without acquiring a session', async () => {
    /**
     * **Validates: Requirements 13.1, 13.2**
     *
     * Simulate a scenario where the DB always signals the record already exists.
     * Every submitApplication call must return alreadyApplied=true and must never
     * reach pool.acquireSession().
     */
    const existingRecord = { id: 'app-guard', userId: 'user-guard', fingerprint: 'fp-guard' };
    vi.mocked(prisma.applicationRecord.findFirst).mockResolvedValue(existingRecord as never);

    for (let i = 0; i < 5; i++) {
      const page = createFakePage({});
      const { pool, releaseSession } = createMockPool(page);
      const result = await submitApplication(
        makeTask({ userId: 'user-guard', jobFingerprint: 'fp-guard' }),
        pool,
        mockFastify,
      );

      expect(result.alreadyApplied).toBe(true);
      expect(result.success).toBe(false);
      expect(vi.mocked(pool.acquireSession)).not.toHaveBeenCalled();
      expect(releaseSession).not.toHaveBeenCalled();
    }
  });
});
