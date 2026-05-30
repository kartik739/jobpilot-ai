/**
 * Tests for the Cover Letter Agent
 *
 * Unit tests: verify generateCoverLetter and submitWithReviewMode behavior.
 * Property tests: verify facts-only constraint and review mode properties.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import OpenAI from 'openai';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { generateCoverLetter, submitWithReviewMode } from './coverLetter.js';
import type { UserProfileContext, CoverLetter, SubmitWithReviewModeOptions } from './coverLetter.js';

/** Short poll interval for tests so we don't wait real 5-second intervals. */
const TEST_REVIEW_OPTIONS: SubmitWithReviewModeOptions = { pollIntervalMs: 10, reviewTimeoutSeconds: 1 };
import type { ParsedJobPosting } from './discovery/types.js';

// ─── Mock storage service ─────────────────────────────────────────────────────

vi.mock('../services/storage.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('mocked-storage-key'),
}));

import { uploadFile } from '../services/storage.js';

// ─── Mock LLM clients ─────────────────────────────────────────────────────────

/** Returns a predictable cover letter body — avoids real LLM calls. */
const mockLlmClient = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Dear Hiring Manager,\n\nI am excited to apply.' } }],
      }),
    },
  },
} as unknown as OpenAI;

/** Always throws — exercises the template fallback path. */
const failingLlmClient = {
  chat: {
    completions: {
      create: async () => {
        throw new Error('LLM unavailable');
      },
    },
  },
} as unknown as OpenAI;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfileContext> = {}): UserProfileContext {
  return {
    userId: 'user-001',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    location: 'San Francisco, CA',
    summary: 'Experienced TypeScript engineer with 5 years in backend systems.',
    experiences: [
      {
        company: 'Acme Corp',
        title: 'Software Engineer',
        startDate: '2020-01',
        endDate: '2023-06',
        bullets: ['Built REST APIs', 'Improved latency by 30%'],
      },
    ],
    skills: [{ name: 'TypeScript' }, { name: 'Node.js' }, { name: 'PostgreSQL' }],
    projects: [
      {
        name: 'OpenSource Lib',
        description: 'A utility library',
        highlights: ['10k GitHub stars', 'Used in production'],
      },
    ],
    education: [
      { institution: 'State University', degree: 'BSc Computer Science', field: 'Computer Science' },
    ],
    coverLetterReviewMode: 'auto',
    ...overrides,
  };
}

const baseJob: ParsedJobPosting = {
  sourceUrl: 'https://techco.com/jobs/1',
  platform: 'greenhouse',
  discoveredAt: new Date('2024-01-01'),
  parsedAt: new Date('2024-01-01'),
  status: 'parsed',
  company: 'TechCo',
  title: 'Senior Backend Engineer',
  requiredSkills: ['TypeScript', 'Node.js'],
  preferredSkills: ['PostgreSQL'],
  yearsExperienceMin: 3,
  yearsExperienceMax: 8,
  location: ['Remote'],
  isRemote: true,
  isHybrid: false,
  salaryMin: 120_000,
  salaryMax: 180_000,
  currency: 'USD',
  employmentType: 'full_time',
  visaRequirements: null,
  applicationDeadline: null,
  applicationUrl: 'https://techco.com/apply',
  rawJson: {},
  rawHtml: null,
};

// ─── Unit tests — generateCoverLetter ─────────────────────────────────────────

describe('generateCoverLetter — unit tests', () => {
  beforeEach(() => {
    vi.mocked(uploadFile).mockResolvedValue('letters/user-001/app-001.txt');
  });

  it('returns a CoverLetter with correct applicationId and userId', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', mockLlmClient);
    expect(result.applicationId).toBe('app-001');
    expect(result.userId).toBe('user-001');
  });

  it('sets version to "generated" for LLM-produced content (req 10.1)', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', mockLlmClient);
    expect(result.version).toBe('generated');
  });

  it('stores the cover letter in SeaweedFS under letters/{userId}/{applicationId}.txt (req 10.7)', async () => {
    const profile = makeProfile();
    await generateCoverLetter(profile, baseJob, 'app-001', mockLlmClient);
    expect(uploadFile).toHaveBeenCalledWith(
      'letters/user-001/app-001.txt',
      expect.any(Buffer),
      'text/plain',
    );
  });

  it('falls back to template cover letter when LLM fails (req 10.2)', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', failingLlmClient);
    // Template fallback still returns a valid non-empty cover letter
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.version).toBe('generated');
  });

  it('template fallback includes the profile name (req 10.2 — no fabrications)', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', failingLlmClient);
    expect(result.content).toContain('Jane Doe');
  });

  it('sets generatedAt to a recent Date', async () => {
    const before = new Date();
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', mockLlmClient);
    const after = new Date();
    expect(result.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('storageKey matches the expected path pattern', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-42', mockLlmClient);
    expect(result.storageKey).toBe('letters/user-001/app-42.txt');
  });

  it('LLM content is used as the cover letter body when available', async () => {
    const profile = makeProfile();
    const result = await generateCoverLetter(profile, baseJob, 'app-001', mockLlmClient);
    expect(result.content).toBe('Dear Hiring Manager,\n\nI am excited to apply.');
  });
});

// ─── Unit tests — submitWithReviewMode ────────────────────────────────────────

function makeCoverLetter(overrides: Partial<CoverLetter> = {}): CoverLetter {
  return {
    applicationId: 'app-001',
    userId: 'user-001',
    content: 'Dear Hiring Manager,\n\nI am excited to apply.',
    storageKey: 'letters/user-001/app-001.txt',
    version: 'generated',
    generatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal Fastify-like instance with no websocketServer — exercises null-check guard. */
const fastifyNoWs = {} as FastifyInstance;

/** Minimal Fastify instance with a websocketServer that has 0 clients. */
const fastifyWithWs = {
  websocketServer: { clients: new Set() },
} as unknown as FastifyInstance;

describe('submitWithReviewMode — auto mode', () => {
  it('returns the cover letter immediately without polling Redis (req 10.5)', async () => {
    const letter = makeCoverLetter();
    const redis = { get: vi.fn() } as unknown as Redis;
    const result = await submitWithReviewMode(letter, 'auto', fastifyNoWs, redis);
    expect(result).toBe(letter);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('version remains "generated" in auto mode', async () => {
    const letter = makeCoverLetter();
    const redis = { get: vi.fn() } as unknown as Redis;
    const result = await submitWithReviewMode(letter, 'auto', fastifyNoWs, redis);
    expect(result.version).toBe('generated');
  });
});

describe('submitWithReviewMode — review_first mode, user provides edit', () => {
  beforeEach(() => {
    vi.mocked(uploadFile).mockResolvedValue('letters/user-001/app-001.txt');
  });

  it('uses the edited content and sets version to "edited" (req 10.6)', async () => {
    const letter = makeCoverLetter();
    const editedText = 'Dear Hiring Manager,\n\nI have tailored this letter.';
    // Redis returns the user-edited content on first poll
    const redis = {
      get: vi.fn().mockResolvedValueOnce(editedText),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    const result = await submitWithReviewMode(letter, 'review_first', fastifyWithWs, redis, TEST_REVIEW_OPTIONS);
    expect(result.version).toBe('edited');
    expect(result.content).toBe(editedText);
  });

  it('uploads the edited content to the same storage key (req 10.7)', async () => {
    const letter = makeCoverLetter();
    const editedText = 'Edited cover letter text.';
    const redis = {
      get: vi.fn().mockResolvedValueOnce(editedText),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    await submitWithReviewMode(letter, 'review_first', fastifyWithWs, redis, TEST_REVIEW_OPTIONS);
    expect(uploadFile).toHaveBeenCalledWith(
      'letters/user-001/app-001.txt',
      Buffer.from(editedText, 'utf-8'),
      'text/plain',
    );
  });

  it('deletes the Redis approval key after processing the edit', async () => {
    const letter = makeCoverLetter();
    const redis = {
      get: vi.fn().mockResolvedValueOnce('edited text'),
      del: vi.fn().mockResolvedValue(1),
    } as unknown as Redis;

    await submitWithReviewMode(letter, 'review_first', fastifyWithWs, redis, TEST_REVIEW_OPTIONS);
    expect(redis.del).toHaveBeenCalledWith('cover_letter_approvals:app-001');
  });
});

// ─── Property tests ───────────────────────────────────────────────────────────

/**
 * Arbitraries for property-based tests
 */

const arbUserProfileContext: fc.Arbitrary<UserProfileContext> = fc.record({
  userId: fc.uuid(),
  fullName: fc.string({ minLength: 1, maxLength: 80 }),
  email: fc.emailAddress(),
  location: fc.oneof(fc.string({ maxLength: 60 }), fc.constant(undefined)),
  summary: fc.oneof(fc.string({ maxLength: 400 }), fc.constant(undefined)),
  experiences: fc.array(
    fc.record({
      company: fc.string({ minLength: 1, maxLength: 60 }),
      title: fc.string({ minLength: 1, maxLength: 80 }),
      startDate: fc.constantFrom('2020-01', '2019-06', '2018-03'),
      endDate: fc.oneof(fc.string({ maxLength: 10 }), fc.constant(undefined)),
      bullets: fc.array(fc.string({ maxLength: 120 }), { maxLength: 5 }),
    }),
    { maxLength: 4 },
  ),
  skills: fc.array(
    fc.record({ name: fc.string({ minLength: 1, maxLength: 40 }) }),
    { maxLength: 10 },
  ),
  projects: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 80 }),
      description: fc.oneof(fc.string({ maxLength: 200 }), fc.constant(undefined)),
      highlights: fc.array(fc.string({ maxLength: 120 }), { maxLength: 5 }),
    }),
    { maxLength: 4 },
  ),
  education: fc.array(
    fc.record({
      institution: fc.string({ minLength: 1, maxLength: 100 }),
      degree: fc.string({ minLength: 1, maxLength: 80 }),
      field: fc.oneof(fc.string({ maxLength: 60 }), fc.constant(undefined)),
    }),
    { maxLength: 3 },
  ),
  coverLetterReviewMode: fc.constantFrom('auto', 'review_first') as fc.Arbitrary<'auto' | 'review_first'>,
});

const arbParsedJobPosting: fc.Arbitrary<ParsedJobPosting> = fc.record({
  sourceUrl: fc.webUrl(),
  platform: fc.constantFrom(
    'greenhouse', 'lever', 'ashby', 'workday', 'remoteok', 'linkedin', 'custom_url',
  ) as fc.Arbitrary<ParsedJobPosting['platform']>,
  discoveredAt: fc.date(),
  parsedAt: fc.date(),
  status: fc.constantFrom('parsed', 'parse_failed', 'embedding_pending') as fc.Arbitrary<ParsedJobPosting['status']>,
  company: fc.oneof(fc.string({ minLength: 1, maxLength: 50 }), fc.constant(null)),
  title: fc.oneof(fc.string({ minLength: 1, maxLength: 80 }), fc.constant(null)),
  requiredSkills: fc.oneof(
    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 8 }),
    fc.constant(null),
  ),
  preferredSkills: fc.oneof(
    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 6 }),
    fc.constant(null),
  ),
  yearsExperienceMin: fc.oneof(fc.integer({ min: 0, max: 15 }), fc.constant(null)),
  yearsExperienceMax: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(null)),
  location: fc.oneof(fc.array(fc.string(), { maxLength: 3 }), fc.constant(null)),
  isRemote: fc.oneof(fc.boolean(), fc.constant(null)),
  isHybrid: fc.oneof(fc.boolean(), fc.constant(null)),
  salaryMin: fc.oneof(fc.integer({ min: 0, max: 300_000 }), fc.constant(null)),
  salaryMax: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(null)),
  currency: fc.oneof(fc.constantFrom('USD', 'EUR', 'GBP'), fc.constant(null)),
  employmentType: fc.oneof(fc.constantFrom('full_time', 'contract'), fc.constant(null)),
  visaRequirements: fc.oneof(fc.array(fc.string(), { maxLength: 2 }), fc.constant(null)),
  applicationDeadline: fc.oneof(fc.date(), fc.constant(null)),
  applicationUrl: fc.oneof(fc.webUrl(), fc.constant(null)),
  rawJson: fc.constant({} as Record<string, unknown>),
  rawHtml: fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)),
});

/**
 * Property 1: Cover Letter Storage Key Format
 * **Validates: Requirements 10.7**
 *
 * For any profile and job, the generated cover letter's storageKey must always
 * follow the pattern letters/{userId}/{applicationId}.txt
 */
describe('Property 1: Cover Letter Storage Key Format (Req 10.7)', () => {
  it('storageKey always has the pattern letters/{userId}/{applicationId}.txt', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const result = await generateCoverLetter(profile, job, applicationId, mockLlmClient);
          expect(result.storageKey).toBe(`letters/${profile.userId}/${applicationId}.txt`);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 2: Cover Letter Identity Metadata
 * **Validates: Requirements 10.7**
 *
 * The returned CoverLetter always has userId and applicationId matching the
 * inputs, regardless of what the LLM returns.
 */
describe('Property 2: Cover Letter Identity Metadata (Req 10.7)', () => {
  it('userId and applicationId always match the inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const result = await generateCoverLetter(profile, job, applicationId, mockLlmClient);
          expect(result.userId).toBe(profile.userId);
          expect(result.applicationId).toBe(applicationId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 3: Cover Letter Non-Empty Content
 * **Validates: Requirements 10.1, 10.2**
 *
 * For any profile and job, the generated cover letter content is never empty —
 * even when the LLM fails and the template fallback is used.
 */
describe('Property 3: Cover Letter Non-Empty Content (Req 10.1, 10.2)', () => {
  it('cover letter content is always non-empty (LLM path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const result = await generateCoverLetter(profile, job, applicationId, mockLlmClient);
          expect(result.content.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cover letter content is always non-empty (template fallback path)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const result = await generateCoverLetter(profile, job, applicationId, failingLlmClient);
          expect(result.content.trim().length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 4: Auto Mode Returns Original Cover Letter Unchanged
 * **Validates: Requirements 10.5**
 *
 * In auto mode, submitWithReviewMode always returns the exact same object
 * without calling Redis or modifying any fields.
 */
describe('Property 4: Auto Mode Returns Original Cover Letter Unchanged (Req 10.5)', () => {
  it('returns the identical object reference in auto mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          applicationId: fc.uuid(),
          userId: fc.uuid(),
          content: fc.string({ minLength: 1, maxLength: 500 }),
          storageKey: fc.string({ minLength: 1, maxLength: 100 }),
          version: fc.constantFrom('generated', 'edited') as fc.Arbitrary<'generated' | 'edited'>,
          generatedAt: fc.date(),
        }),
        async (letter) => {
          const redis = { get: vi.fn() } as unknown as Redis;
          const result = await submitWithReviewMode(letter, 'auto', fastifyNoWs, redis);
          expect(result).toBe(letter);
          expect(redis.get).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
