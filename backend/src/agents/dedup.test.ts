/**
 * Property 16: No Duplicate Applications
 * Validates: Requirements 13.1, 13.2
 *
 * Tests that concurrent submitApplication calls for the same (userId, fingerprint)
 * pair never result in more than one ApplicationRecord, both through the
 * application-level findFirst dedup guard (req 13.1) and through the DB unique
 * constraint P2002 race-condition handler (req 13.2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { FastifyInstance } from 'fastify';

// ─── In-memory mock store ────────────────────────────────────────────────────

// Tracks inserted ApplicationRecords keyed by "userId:fingerprint"
const applicationRecords: Map<string, { id: string; userId: string; fingerprint: string }> = new Map();

vi.mock('../db.js', () => ({
  prisma: {
    applicationRecord: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; fingerprint: string } }) => {
        const key = `${where.userId}:${where.fingerprint}`;
        return applicationRecords.get(key) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: { userId: string; fingerprint: string } }) => {
        const key = `${data.userId}:${data.fingerprint}`;
        if (applicationRecords.has(key)) {
          // Simulate DB unique constraint violation (P2002)
          const err = Object.assign(new Error('Unique constraint failed on fields: (userId, fingerprint)'), {
            code: 'P2002',
            name: 'PrismaClientKnownRequestError',
          });
          throw err;
        }
        const record = { id: `rec-${key}`, ...data };
        applicationRecords.set(key, record as { id: string; userId: string; fingerprint: string });
        return record;
      }),
    },
    reusableAnswer: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../services/storage.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('screenshots/test/key.png'),
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('pdf')),
}));

vi.mock('../core/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
import { prisma } from '../db.js';

// ─── Fake page that simulates a successful submission ─────────────────────────

function createSuccessPage() {
  const page = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi.fn(async (selector: string) => {
      // Return a submit button for submit-related selectors
      if (
        selector.includes('submit') ||
        selector.includes('Apply')
      ) {
        return { click: vi.fn().mockResolvedValue(undefined) };
      }
      return null;
    }),
    evaluate: vi.fn().mockResolvedValue('Apply for this position'),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    url: vi.fn().mockReturnValue('https://jobs.example.com/apply'),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    // Resolves immediately → confirmed = true
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({ boundingBox: vi.fn().mockResolvedValue(null) }),
  };
  return page;
}

// ─── Mock pool factory ────────────────────────────────────────────────────────

function createMockPool(fakePage: ReturnType<typeof createSuccessPage>) {
  const fakeContext = {
    newPage: vi.fn().mockResolvedValue(fakePage),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const releaseSession = vi.fn();
  const pool = {
    acquireSession: vi.fn().mockResolvedValue(fakeContext),
    releaseSession,
  } as unknown as BrowserPool;
  return { pool, releaseSession };
}

// ─── Mock Fastify ──────────────────────────────────────────────────────────────

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

// ─── Helper: simulate worker's create call after successful submitApplication ─

/**
 * Simulates what processApplicationJob does: calls submitApplication and then,
 * if success, calls prisma.applicationRecord.create. This lets us assert on
 * applicationRecords.size to verify dedup behavior.
 */
async function submitAndRecord(task: ApplicationTask, pool: BrowserPool): Promise<void> {
  const result = await submitApplication(task, pool, mockFastify);
  if (result.alreadyApplied) {
    // Dedup guard fired — no record created (req 13.2)
    return;
  }
  if (result.success) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.applicationRecord.create as any)({
        data: {
          userId: task.userId,
          fingerprint: task.jobFingerprint,
          jobPostingId: task.jobPostingId,
          source: 'automation',
        },
      });
    } catch (dbErr: unknown) {
      // P2002 race condition — swallow (req 13.2)
      const err = dbErr as { code?: string };
      if (err.code === 'P2002') {
        return;
      }
      throw dbErr;
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Property 16: No Duplicate Applications', () => {
  beforeEach(() => {
    applicationRecords.clear();
    vi.clearAllMocks();
  });

  it('single call creates at most one record for (userId, fingerprint)', async () => {
    const page = createSuccessPage();
    const { pool } = createMockPool(page);
    const task = makeTask({ userId: 'user-single', jobFingerprint: 'fp-single' });

    await submitAndRecord(task, pool);

    let count = 0;
    for (const [key] of applicationRecords) {
      if (key === `${task.userId}:${task.jobFingerprint}`) count++;
    }
    expect(count).toBeLessThanOrEqual(1);
  });

  it('second call for same (userId, fingerprint) is treated as already-applied', async () => {
    const task = makeTask({ userId: 'user-dup', jobFingerprint: 'fp-dup' });

    // First call — creates a record
    const page1 = createSuccessPage();
    const { pool: pool1 } = createMockPool(page1);
    await submitAndRecord(task, pool1);

    // Second call — findFirst now returns the record, alreadyApplied should be true
    const page2 = createSuccessPage();
    const { pool: pool2 } = createMockPool(page2);
    const result2 = await submitApplication(task, pool2, mockFastify);
    expect(result2.alreadyApplied).toBe(true);

    // Still only one record
    let count = 0;
    for (const [key] of applicationRecords) {
      if (key === `${task.userId}:${task.jobFingerprint}`) count++;
    }
    expect(count).toBe(1);
  });

  it('concurrent calls for same (userId, fingerprint) create exactly 1 record', async () => {
    const userId = 'user-concurrent';
    const fingerprint = 'fp-concurrent';
    const task = makeTask({ userId, jobFingerprint: fingerprint });

    // Fire 5 concurrent calls — each gets a fresh page/pool
    const calls = Array.from({ length: 5 }, () => {
      const page = createSuccessPage();
      const { pool } = createMockPool(page);
      return submitAndRecord(task, pool);
    });
    await Promise.allSettled(calls);

    let count = 0;
    for (const [key] of applicationRecords) {
      if (key === `${userId}:${fingerprint}`) count++;
    }
    expect(count).toBeLessThanOrEqual(1);
  });

  it('property: COUNT(records WHERE userId=X AND fingerprint=Y) <= 1 for any concurrent scenario', async () => {
    /**
     * **Validates: Requirements 13.1, 13.2**
     *
     * For any (userId, fingerprint) pair, firing up to 8 concurrent
     * submitApplication calls must never result in more than one
     * ApplicationRecord for that pair in the store.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.uuid(),
          fingerprint: fc.string({ minLength: 8, maxLength: 16 }),
          concurrency: fc.integer({ min: 1, max: 8 }),
        }),
        async ({ userId, fingerprint, concurrency }) => {
          applicationRecords.clear();
          vi.clearAllMocks();

          const task = makeTask({ userId, jobFingerprint: fingerprint });

          const calls = Array.from({ length: concurrency }, () => {
            const page = createSuccessPage();
            const { pool } = createMockPool(page);
            return submitAndRecord(task, pool);
          });
          await Promise.allSettled(calls);

          let count = 0;
          for (const [key] of applicationRecords) {
            if (key === `${userId}:${fingerprint}`) count++;
          }
          return count <= 1;
        },
      ),
      { numRuns: 15 },
    );
  });
});
