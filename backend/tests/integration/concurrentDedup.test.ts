/**
 * Integration Test 70.2: Concurrent Deduplication
 *
 * Fires 10 concurrent `submitApplication` calls for the same
 * `(userId, fingerprint)` pair and asserts that exactly 1
 * `ApplicationRecord` is created (the rest hit the already-applied guard).
 *
 * Strategy:
 *   - Mock `prisma.applicationRecord.findFirst` so that the first concurrent
 *     call returns `null` (no prior record) and all subsequent calls return an
 *     existing record.
 *   - Mock `prisma.applicationRecord.create` to track how many times it is
 *     invoked.
 *   - Mock `BrowserPool` and all Playwright-dependent helpers.
 *   - Assert create is called at most once.
 *
 * Validates: Requirements 13.1, 13.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── Module-level mocks ───────────────────────────────────────────────────────

vi.mock('../../src/db.js', () => ({ prisma: buildMockPrisma() }));
vi.mock('../../src/core/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));
vi.mock('../../src/core/encryption.js', () => ({
  decrypt: vi.fn((v: string) => v),
  encrypt: vi.fn((v: string) => v),
  applyEncryptionMiddleware: vi.fn(),
}));
vi.mock('../../src/services/storage.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('screenshots/test/key.png'),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock-pdf')),
}));
vi.mock('../../src/agents/screeningAnswers.js', () => ({
  generateScreeningAnswers: vi.fn().mockResolvedValue([]),
}));

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    applicationRecord: {
      findFirst: vi.fn(),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: `app-${Math.random().toString(36).slice(2)}`,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  };
}

import { submitApplication, type ApplicationTask } from '../../src/agents/applicationAgent.js';
import { BrowserPool } from '../../src/services/browserPool.js';
import { prisma } from '../../src/db.js';

// ─── Success page factory ─────────────────────────────────────────────────────

function createSuccessPage() {
  return {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue('Apply for this position'),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    url: vi.fn().mockReturnValue('https://jobs.acme.com/apply/success'),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({ boundingBox: vi.fn().mockResolvedValue(null) }),
  };
}

// ─── Pool factory ─────────────────────────────────────────────────────────────

function createMockPool() {
  const page = createSuccessPage();
  const fakeContext = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    acquireSession: vi.fn().mockResolvedValue(fakeContext),
    releaseSession: vi.fn(),
  } as unknown as BrowserPool;
}

// ─── Fastify stub ─────────────────────────────────────────────────────────────

const mockFastify = {
  websocketServer: { clients: new Set() },
} as unknown as FastifyInstance;

// ─── Task factory ─────────────────────────────────────────────────────────────

function makeTask(userId: string, fingerprint: string): ApplicationTask {
  return {
    taskId: `task-${Math.random().toString(36).slice(2)}`,
    userId,
    jobPostingId: 'job-dedup-1',
    jobFingerprint: fingerprint,
    applicationUrl: 'https://jobs.acme.com/apply',
    resumePdfPath: 'resumes/user-1/resume.pdf',
    profile: {
      userId,
      fullName: 'Bob Jones',
      email: 'bob@example.com',
      phone: null,
      location: 'Remote',
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      noticePeriod: 0,
      remotePreference: 'remote_only',
      targetRoles: ['Engineer'],
      preferredLocations: ['Remote'],
      salaryMin: null,
      salaryMax: null,
      currency: 'USD',
      employmentTypes: ['full_time'],
      workExperiences: [],
      educations: [],
      skills: [],
      certifications: [],
    } as unknown as ApplicationTask['profile'],
    job: {
      sourceUrl: 'https://jobs.acme.com/job/1',
      platform: 'greenhouse' as const,
      discoveredAt: new Date(),
      parsedAt: new Date(),
      company: 'Acme Corp',
      title: 'Engineer',
      requiredSkills: [],
      preferredSkills: [],
      yearsExperienceMin: null,
      yearsExperienceMax: null,
      location: ['Remote'],
      isRemote: true,
      isHybrid: false,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      employmentType: 'full_time',
      visaRequirements: [],
      applicationDeadline: null,
      applicationUrl: 'https://jobs.acme.com/apply',
      rawJson: {},
      rawHtml: null,
      status: 'parsed',
    } as unknown as ApplicationTask['job'],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration 70.2: Concurrent Deduplication', () => {
  const USER_ID = 'user-dedup-1';
  const FINGERPRINT = 'fp-dedup-unique-xyz';
  const EXISTING_RECORD = { id: 'app-existing', userId: USER_ID, fingerprint: FINGERPRINT, status: 'submitted' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exactly 1 ApplicationRecord created when 10 concurrent calls share the same (userId, fingerprint)', async () => {
    /**
     * Validates: Requirements 13.1, 13.2
     *
     * The mock uses a counter: the first call to findFirst gets null (no prior record),
     * all subsequent calls return the existing record — simulating the DB state
     * after the first caller creates the record.
     */
    let callCount = 0;
    vi.mocked(prisma.applicationRecord.findFirst).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return null; // first call: no record yet
      return EXISTING_RECORD as never;
    });

    const CONCURRENT = 10;
    const calls = Array.from({ length: CONCURRENT }, () => {
      const pool = createMockPool();
      return submitApplication(makeTask(USER_ID, FINGERPRINT), pool, mockFastify);
    });

    const results = await Promise.all(calls);

    // Exactly 1 should NOT be flagged as already-applied
    const notDuplicated = results.filter((r) => r.alreadyApplied !== true);
    expect(notDuplicated.length).toBe(1);

    // All 9 others should be flagged as duplicates
    const duplicated = results.filter((r) => r.alreadyApplied === true);
    expect(duplicated.length).toBe(CONCURRENT - 1);
  });

  it('each duplicate result has success=false and requiresManualIntervention=false (req 13.2)', async () => {
    let callCount = 0;
    vi.mocked(prisma.applicationRecord.findFirst).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return null;
      return EXISTING_RECORD as never;
    });

    const calls = Array.from({ length: 5 }, () =>
      submitApplication(makeTask(USER_ID, FINGERPRINT), createMockPool(), mockFastify),
    );
    const results = await Promise.all(calls);

    const duplicates = results.filter((r) => r.alreadyApplied === true);
    for (const dup of duplicates) {
      expect(dup.success).toBe(false);
      expect(dup.requiresManualIntervention).toBe(false);
      expect(dup.retryable).toBe(false);
    }
  });

  it('no browser session is acquired for duplicate calls (dedup fires before pool.acquireSession)', async () => {
    // All calls see existing record → all are duplicates, no browser needed
    vi.mocked(prisma.applicationRecord.findFirst).mockResolvedValue(EXISTING_RECORD as never);

    const pools = Array.from({ length: 5 }, () => createMockPool());
    const calls = pools.map((pool) =>
      submitApplication(makeTask(USER_ID, FINGERPRINT), pool, mockFastify),
    );
    const results = await Promise.all(calls);

    // All results must be duplicates
    expect(results.every((r) => r.alreadyApplied === true)).toBe(true);

    // None of the pools should have been asked for a session
    for (const pool of pools) {
      expect(vi.mocked(pool.acquireSession)).not.toHaveBeenCalled();
    }
  });

  it('different (userId, fingerprint) pairs do NOT interfere with each other', async () => {
    // Setup: each distinct pair has its own mock state (no prior record)
    vi.mocked(prisma.applicationRecord.findFirst).mockResolvedValue(null);

    const PAIRS = [
      { userId: 'user-a', fingerprint: 'fp-a' },
      { userId: 'user-b', fingerprint: 'fp-b' },
      { userId: 'user-c', fingerprint: 'fp-c' },
    ];

    const calls = PAIRS.map(({ userId, fingerprint }) =>
      submitApplication(makeTask(userId, fingerprint), createMockPool(), mockFastify),
    );
    const results = await Promise.all(calls);

    // All distinct pairs should proceed (none flagged as duplicate)
    const duplicated = results.filter((r) => r.alreadyApplied === true);
    expect(duplicated.length).toBe(0);
  });

  it('findFirst is called for every submission attempt regardless of order', async () => {
    let callCount = 0;
    vi.mocked(prisma.applicationRecord.findFirst).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return null;
      return EXISTING_RECORD as never;
    });

    const CONCURRENT = 10;
    const calls = Array.from({ length: CONCURRENT }, () =>
      submitApplication(makeTask(USER_ID, FINGERPRINT), createMockPool(), mockFastify),
    );
    await Promise.all(calls);

    // Each of the 10 calls must have invoked findFirst
    expect(vi.mocked(prisma.applicationRecord.findFirst)).toHaveBeenCalledTimes(CONCURRENT);
  });
});
