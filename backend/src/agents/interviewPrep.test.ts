/**
 * Tests for the Interview Prep Agent
 *
 * Unit tests: LLM success path, LLM failure fallback, Prisma upsert called.
 * Property 20: fast-check property asserting question count [5,10] and
 *              min 2 behavioral + 2 technical questions per sheet.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { generatePrepSheet } from './interviewPrep.js';
import type { InterviewPrepSheet } from './interviewPrep.js';
import type { UserProfileContext } from './coverLetter.js';
import type { ParsedJobPosting } from './discovery/types.js';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

// Shared upsert spy — replaced fresh per test in beforeEach.
const mockUpsert = vi.fn().mockResolvedValue({});

vi.mock('@prisma/client', () => {
  // Must be a real class (function constructor) so `new PrismaClient()` works.
  class MockPrismaClient {
    interviewPrepSheet = {
      upsert: mockUpsert,
    };
  }
  return { PrismaClient: MockPrismaClient };
});

// ─── LLM mock helpers ────────────────────────────────────────────────────────

function makeMockLlmClient(responseJson: object): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(responseJson) } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

const failingLlmClient: OpenAI = {
  chat: {
    completions: {
      create: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    },
  },
} as unknown as OpenAI;

// ─── Valid LLM response fixture ───────────────────────────────────────────────

const validLlmResponse = {
  behavioralQuestions: [
    {
      question: 'Tell me about a time you resolved a complex technical issue.',
      suggestedAnswer: 'At Acme Corp, I improved API latency by 30% by profiling and caching.',
    },
    {
      question: 'Describe a situation where you collaborated across teams.',
      suggestedAnswer: 'While at Acme Corp, I worked with product and design on a key feature.',
    },
    {
      question: 'Give an example of delivering under tight deadlines.',
      suggestedAnswer: 'I led a sprint at Acme Corp that shipped the feature two days early.',
    },
  ],
  technicalQuestions: [
    { question: 'How would you design a rate-limiting service?', category: 'system-design' },
    { question: 'Explain your experience with TypeScript generics.', category: 'technical' },
    { question: 'How do you handle database migrations in production?', category: 'technical' },
  ],
  companySummary: 'TechCo is a fast-growing startup building developer tools.',
  roleSpecificTips: [
    'Review TypeScript advanced patterns.',
    'Prepare a story about a scaling challenge.',
    'Research TechCo recent product updates.',
  ],
};

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
        highlights: ['10k GitHub stars'],
      },
    ],
    education: [
      {
        institution: 'State University',
        degree: 'BSc Computer Science',
        field: 'Computer Science',
      },
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

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('generatePrepSheet — unit tests', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockUpsert.mockClear();
    mockUpsert.mockResolvedValue({});
    mockPrisma = new PrismaClient();
  });

  it('returns an InterviewPrepSheet with the correct applicationId', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    expect(result.applicationId).toBe('app-001');
  });

  it('returns behavioral questions with category = "behavioral"', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    for (const q of result.behavioralQuestions) {
      expect(q.category).toBe('behavioral');
    }
  });

  it('returns technical questions with category "technical" or "system-design"', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    for (const q of result.technicalQuestions) {
      expect(['technical', 'system-design']).toContain(q.category);
    }
  });

  it('calls prisma upsert with the applicationId (req 19.4)', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    await generatePrepSheet('app-42', baseJob, makeProfile(), llm, mockPrisma);
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ where: { applicationId: 'app-42' } });
  });

  it('falls back to template questions when LLM throws (req 19.4)', async () => {
    const result = await generatePrepSheet(
      'app-001',
      baseJob,
      makeProfile(),
      failingLlmClient,
      mockPrisma,
    );
    expect(result.behavioralQuestions.length).toBeGreaterThanOrEqual(2);
    expect(result.technicalQuestions.length).toBeGreaterThanOrEqual(2);
    const total = result.behavioralQuestions.length + result.technicalQuestions.length;
    expect(total).toBeGreaterThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(10);
  });

  it('template fallback prisma upsert is still called (req 19.4)', async () => {
    await generatePrepSheet('app-001', baseJob, makeProfile(), failingLlmClient, mockPrisma);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it('generatedAt is a recent Date', async () => {
    const before = new Date();
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    const after = new Date();
    expect(result.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('companySummary is a non-empty string', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    expect(typeof result.companySummary).toBe('string');
    expect(result.companySummary.trim().length).toBeGreaterThan(0);
  });

  it('roleSpecificTips is a non-empty array of strings', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    expect(Array.isArray(result.roleSpecificTips)).toBe(true);
    expect(result.roleSpecificTips.length).toBeGreaterThan(0);
    for (const tip of result.roleSpecificTips) {
      expect(typeof tip).toBe('string');
    }
  });

  it('falls back to templates when LLM returns fewer than 2 behavioral questions', async () => {
    const tooFewBehavioral = {
      ...validLlmResponse,
      behavioralQuestions: [validLlmResponse.behavioralQuestions[0]!], // only 1
    };
    const llm = makeMockLlmClient(tooFewBehavioral);
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), llm, mockPrisma);
    // Template fallback should kick in
    expect(result.behavioralQuestions.length).toBeGreaterThanOrEqual(2);
    expect(result.technicalQuestions.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to templates when LLM returns empty content', async () => {
    const emptyLlm: OpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ choices: [{ message: { content: '' } }] }),
        },
      },
    } as unknown as OpenAI;
    const result = await generatePrepSheet('app-001', baseJob, makeProfile(), emptyLlm, mockPrisma);
    expect(result.behavioralQuestions.length).toBeGreaterThanOrEqual(2);
    expect(result.technicalQuestions.length).toBeGreaterThanOrEqual(2);
  });

  it('behavioral suggestedAnswer only contains facts from profile companies (req 19.3)', async () => {
    const llm = makeMockLlmClient(validLlmResponse);
    const profile = makeProfile();
    const knownCompanies = profile.experiences.map((e) => e.company);
    const result = await generatePrepSheet('app-001', baseJob, profile, llm, mockPrisma);

    for (const q of result.behavioralQuestions) {
      if (q.suggestedAnswer != null && q.suggestedAnswer.trim() !== '') {
        // The suggested answer should reference at least one known company if it references any company at all
        const mentionsInventedCompany = /(?:Corp|Inc|Ltd|LLC|Co\b)/i.test(q.suggestedAnswer)
          ? !knownCompanies.some((c) => q.suggestedAnswer!.includes(c))
          : false;
        expect(mentionsInventedCompany).toBe(false);
      }
    }
  });
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const arbUserProfileContext: fc.Arbitrary<UserProfileContext> = fc.record({
  userId: fc.uuid(),
  fullName: fc.string({ minLength: 1, maxLength: 80 }),
  email: fc.emailAddress(),
  location: fc.oneof(fc.string({ maxLength: 60 }), fc.constant(undefined)),
  summary: fc.oneof(fc.string({ maxLength: 300 }), fc.constant(undefined)),
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
  coverLetterReviewMode: fc.constantFrom(
    'auto',
    'review_first',
  ) as fc.Arbitrary<'auto' | 'review_first'>,
});

const arbParsedJobPosting: fc.Arbitrary<ParsedJobPosting> = fc.record({
  sourceUrl: fc.webUrl(),
  platform: fc.constantFrom(
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'remoteok',
    'linkedin',
    'custom_url',
  ) as fc.Arbitrary<ParsedJobPosting['platform']>,
  discoveredAt: fc.date(),
  parsedAt: fc.date(),
  status: fc.constantFrom(
    'parsed',
    'parse_failed',
    'embedding_pending',
  ) as fc.Arbitrary<ParsedJobPosting['status']>,
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
 * Build a mock LLM client that returns a deterministic valid prep sheet
 * regardless of the generated profile/job content.
 * This lets property tests focus on structural invariants, not LLM output.
 */
function makeStructuredMockLlm(numBehavioral: number, numTechnical: number): OpenAI {
  const behavioralQuestions = Array.from({ length: numBehavioral }, (_, i) => ({
    question: `Behavioral question ${i + 1}`,
    suggestedAnswer: `Answer based on my experience ${i + 1}`,
  }));
  const technicalQuestions = Array.from({ length: numTechnical }, (_, i) => ({
    question: `Technical question ${i + 1}`,
    category: 'technical' as const,
  }));
  return makeMockLlmClient({
    behavioralQuestions,
    technicalQuestions,
    companySummary: 'A summary of the company and role.',
    roleSpecificTips: ['Tip 1', 'Tip 2', 'Tip 3'],
  });
}

// ─── Property 20: Interview Prep Question Count ───────────────────────────────

/**
 * Property 20: Interview Prep Question Count
 * **Validates: Requirements 19.1**
 *
 * For any application/job/profile combination:
 *   - Total questions must be between 5 and 10 (inclusive)
 *   - At least 2 behavioral questions
 *   - At least 2 technical questions
 */
describe('Property 20: Interview Prep Question Count (Req 19.1)', () => {
  it('LLM path: question count is in [5,10] with ≥2 behavioral and ≥2 technical', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        fc.integer({ min: 2, max: 5 }), // numBehavioral
        fc.integer({ min: 2, max: 5 }), // numTechnical
        async (profile, job, applicationId, numBehavioral, numTechnical) => {
          const mockPrisma = new PrismaClient();
          const llm = makeStructuredMockLlm(numBehavioral, numTechnical);
          const result: InterviewPrepSheet = await generatePrepSheet(
            applicationId,
            job,
            profile,
            llm,
            mockPrisma,
          );

          const totalQuestions =
            result.behavioralQuestions.length + result.technicalQuestions.length;

          expect(totalQuestions).toBeGreaterThanOrEqual(5);
          expect(totalQuestions).toBeLessThanOrEqual(10);
          expect(result.behavioralQuestions.length).toBeGreaterThanOrEqual(2);
          expect(result.technicalQuestions.length).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fallback path: question count is in [5,10] with ≥2 behavioral and ≥2 technical', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const mockPrisma = new PrismaClient();
          const result: InterviewPrepSheet = await generatePrepSheet(
            applicationId,
            job,
            profile,
            failingLlmClient,
            mockPrisma,
          );

          const totalQuestions =
            result.behavioralQuestions.length + result.technicalQuestions.length;

          expect(totalQuestions).toBeGreaterThanOrEqual(5);
          expect(totalQuestions).toBeLessThanOrEqual(10);
          expect(result.behavioralQuestions.length).toBeGreaterThanOrEqual(2);
          expect(result.technicalQuestions.length).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('behavioral questions always have category = "behavioral"', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const mockPrisma = new PrismaClient();
          const llm = makeStructuredMockLlm(3, 3);
          const result: InterviewPrepSheet = await generatePrepSheet(
            applicationId,
            job,
            profile,
            llm,
            mockPrisma,
          );
          for (const q of result.behavioralQuestions) {
            expect(q.category).toBe('behavioral');
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('technical questions always have category "technical" or "system-design"', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const mockPrisma = new PrismaClient();
          const llm = makeStructuredMockLlm(3, 3);
          const result: InterviewPrepSheet = await generatePrepSheet(
            applicationId,
            job,
            profile,
            llm,
            mockPrisma,
          );
          for (const q of result.technicalQuestions) {
            expect(['technical', 'system-design']).toContain(q.category);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Additional property: behavioral answers don't fabricate ──────────────────

/**
 * Property: Behavioral answers never reference companies not in the profile.
 * **Validates: Requirements 19.3**
 *
 * We check this by ensuring no known "fake" company sentinel appears in answers.
 */
describe('Property: Behavioral answers only reference profile facts (Req 19.3)', () => {
  it('suggested answers in template fallback only contain profile company names', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserProfileContext,
        arbParsedJobPosting,
        fc.uuid(),
        async (profile, job, applicationId) => {
          const mockPrisma = new PrismaClient();
          const result: InterviewPrepSheet = await generatePrepSheet(
            applicationId,
            job,
            profile,
            failingLlmClient,
            mockPrisma,
          );

          const knownCompanies = new Set(profile.experiences.map((e) => e.company));

          for (const q of result.behavioralQuestions) {
            if (q.suggestedAnswer == null || q.suggestedAnswer.trim() === '') continue;

            // Extract any words ending in "Corp", "Inc", "Ltd", etc. from the answer
            const companyLikeMatches =
              q.suggestedAnswer.match(/\b\w[\w\s]{0,30}(?:Corp|Inc|Ltd|LLC)\b/gi) ?? [];

            for (const mention of companyLikeMatches) {
              // Each company-like mention must be from the profile
              const isKnown = [...knownCompanies].some((c) =>
                mention.includes(c),
              );
              expect(isKnown).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
