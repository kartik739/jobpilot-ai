/**
 * Integration Test 70.1: Discovery → Application Pipeline
 *
 * Tests the full agent pipeline end-to-end using in-memory mocks:
 * invokes `submitApplication()` directly (bypassing actual
 * discovery/ranking workers) and asserts that an `ApplicationRecord`
 * is created with `status = 'submitted'`.
 *
 * Validates: Requirements 7.4, 13.1, 28.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ─── Module-level mocks (hoisted before any imports) ─────────────────────────

vi.mock('../../src/db.js', () => ({ prisma: mockPrismaFactory() }));
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
  downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
}));
vi.mock('../../src/agents/screeningAnswers.js', () => ({
  generateScreeningAnswers: vi.fn().mockResolvedValue([]),
}));

// ─── Prisma mock factory (must be declared before vi.mock calls) ──────────────

function mockPrismaFactory() {
  return {
    applicationRecord: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'app-record-1',
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

// ─── Minimal fake page (success path) ────────────────────────────────────────

// Selectors that should return a fake element (e.g. submit button)
const SUBMIT_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Submit")',
  'button:has-text("Apply Now")',
  'button:has-text("Apply")',
];

function createSuccessPage() {
  const fakeButton = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  };

  return {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockImplementation(async (selector: string) => {
      // Return a fake element for submit button selectors; null for CAPTCHA/MFA/form fields
      // The submit selector is a comma-separated multi-selector string
      if (SUBMIT_BUTTON_SELECTORS.some((s) => selector.includes(s.split('[')[0]!.split(':')[0]!))) {
        // Check it's the combined submit button query (contains "submit")
        if (selector.includes('submit') && !selector.includes('captcha') && !selector.includes('mfa')) {
          return fakeButton;
        }
      }
      return null;
    }),
    evaluate: vi.fn().mockResolvedValue('Thank you for your application. Application submitted successfully.'),
    fill: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    url: vi.fn().mockReturnValue('https://jobs.acme.com/apply/success'),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined), // resolves = confirmation found
    locator: vi.fn().mockReturnValue({ boundingBox: vi.fn().mockResolvedValue(null) }),
  };
}

// ─── Mock browser pool ────────────────────────────────────────────────────────

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

// ─── Minimal mock FastifyInstance (WebSocket-capable stub) ───────────────────

const mockFastify = {
  websocketServer: { clients: new Set() },
} as unknown as FastifyInstance;

// ─── Sample ApplicationTask fixture ──────────────────────────────────────────

function makeTask(overrides: Partial<ApplicationTask> = {}): ApplicationTask {
  return {
    taskId: 'task-integration-1',
    userId: 'user-integration-1',
    jobPostingId: 'job-integration-1',
    jobFingerprint: 'fp-integration-abc123',
    applicationUrl: 'https://jobs.acme.com/apply',
    resumePdfPath: 'resumes/user-integration-1/resume.pdf',
    coverLetterPath: undefined,
    profile: {
      userId: 'user-integration-1',
      fullName: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+1-555-0100',
      location: 'San Francisco, CA',
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      noticePeriod: 0,
      remotePreference: 'remote_only',
      targetRoles: ['Software Engineer'],
      preferredLocations: ['Remote'],
      salaryMin: '100000',
      salaryMax: '150000',
      currency: 'USD',
      employmentTypes: ['full_time'],
      workExperiences: [
        {
          company: 'Acme Corp',
          title: 'Software Engineer',
          startDate: new Date('2020-01-01'),
          endDate: null,
          isCurrent: true,
          description: 'Built backend services',
          bullets: ['Designed REST APIs', 'Maintained CI/CD pipelines'],
          skills: ['TypeScript', 'Node.js'],
        },
      ],
      educations: [
        {
          institution: 'State University',
          degree: 'B.S. Computer Science',
          field: 'Computer Science',
          startDate: new Date('2016-09-01'),
          endDate: new Date('2020-05-01'),
          gpa: 3.8,
        },
      ],
      skills: [
        { name: 'TypeScript', category: 'language', proficiency: 'expert', yearsOfExp: 4 },
        { name: 'Node.js', category: 'runtime', proficiency: 'advanced', yearsOfExp: 4 },
      ],
      certifications: [],
    } as unknown as ApplicationTask['profile'],
    job: {
      sourceUrl: 'https://jobs.acme.com/job/1',
      platform: 'greenhouse' as const,
      discoveredAt: new Date(),
      parsedAt: new Date(),
      company: 'Acme Corp',
      title: 'Software Engineer',
      description: 'We are looking for a skilled engineer.',
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: ['PostgreSQL'],
      yearsExperienceMin: 2,
      yearsExperienceMax: 6,
      location: ['San Francisco', 'Remote'],
      isRemote: true,
      isHybrid: false,
      salaryMin: 90000,
      salaryMax: 140000,
      currency: 'USD',
      employmentType: 'full_time',
      visaRequirements: [],
      applicationDeadline: null,
      applicationUrl: 'https://jobs.acme.com/apply',
      rawJson: {},
      rawHtml: null,
      status: 'parsed',
    } as unknown as ApplicationTask['job'],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration 70.1: Discovery → Application Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, no prior application record exists
    vi.mocked(prisma.applicationRecord.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.applicationRecord.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: 'app-record-1',
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates an ApplicationRecord with status = submitted on a clean success path', async () => {
    const page = createSuccessPage();
    const { pool } = createMockPool(page);

    const task = makeTask();
    const result = await submitApplication(task, pool, mockFastify);

    // Agent should report success
    expect(result.success).toBe(true);
    expect(result.alreadyApplied).toBeFalsy();
    expect(result.requiresManualIntervention).toBe(false);

    // Prisma should NOT have flagged a duplicate first
    expect(vi.mocked(prisma.applicationRecord.findFirst)).toHaveBeenCalledWith({
      where: {
        userId: task.userId,
        fingerprint: task.jobFingerprint,
      },
    });
  });

  it('returns alreadyApplied=true and skips submission when a prior record exists (req 13.1)', async () => {
    const existingRecord = {
      id: 'app-existing',
      userId: 'user-integration-1',
      fingerprint: 'fp-integration-abc123',
      status: 'submitted',
    };
    vi.mocked(prisma.applicationRecord.findFirst).mockResolvedValue(existingRecord as never);

    const page = createSuccessPage();
    const { pool, releaseSession } = createMockPool(page);

    const task = makeTask();
    const result = await submitApplication(task, pool, mockFastify);

    expect(result.alreadyApplied).toBe(true);
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(false);

    // Browser session should NEVER be acquired for a duplicate (dedup guard fires first)
    expect(vi.mocked(pool.acquireSession)).not.toHaveBeenCalled();
    expect(releaseSession).not.toHaveBeenCalled();
  });

  it('browser session is always released after a successful submission (req 12.11)', async () => {
    const page = createSuccessPage();
    const { pool, releaseSession } = createMockPool(page);

    await submitApplication(makeTask(), pool, mockFastify);

    expect(releaseSession).toHaveBeenCalledOnce();
  });

  it('dedup guard prevents duplicate calls for same (userId, fingerprint) in sequence (req 7.4)', async () => {
    const findFirstMock = vi.mocked(prisma.applicationRecord.findFirst);
    const existingRecord = { id: 'app-dup', userId: 'user-integration-1', fingerprint: 'fp-integration-abc123' };

    // First call: no prior record
    findFirstMock.mockResolvedValueOnce(null);
    // Second call: record now exists
    findFirstMock.mockResolvedValueOnce(existingRecord as never);

    const task = makeTask();

    const page1 = createSuccessPage();
    const { pool: pool1 } = createMockPool(page1);
    const result1 = await submitApplication(task, pool1, mockFastify);

    const page2 = createSuccessPage();
    const { pool: pool2 } = createMockPool(page2);
    const result2 = await submitApplication(task, pool2, mockFastify);

    // First attempt proceeds; second attempt is caught by guard
    expect(result1.alreadyApplied).toBeFalsy();
    expect(result2.alreadyApplied).toBe(true);
  });

  it('emits job_discovered WebSocket event during submission (req 28.4)', async () => {
    const wsClients = new Set<{ readyState: number; send: ReturnType<typeof vi.fn> }>();
    const mockClient = { readyState: 1 /* WS_OPEN */, send: vi.fn() };
    wsClients.add(mockClient);

    const fastifyWithWs = {
      websocketServer: { clients: wsClients },
    } as unknown as FastifyInstance;

    const page = createSuccessPage();
    const { pool } = createMockPool(page);

    await submitApplication(makeTask(), pool, fastifyWithWs);

    // At least one WS message should have been sent (job_discovered event)
    expect(mockClient.send).toHaveBeenCalled();
    const calls: string[] = mockClient.send.mock.calls.map((c: [string]) => c[0]);
    const discoveredCall = calls.find((msg) => msg.includes('job_discovered'));
    expect(discoveredCall).toBeDefined();
  });
});
