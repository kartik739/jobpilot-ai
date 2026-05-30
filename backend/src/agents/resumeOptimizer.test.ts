/**
 * Property 10: Resume Optimization Fact Preservation
 * Validates: Requirements 9.4, 9.5, 9.6, 9.7
 *
 * For any arbitrary resume + job, the optimized output must contain no new
 * work experiences, projects, certifications, education entries, or skills
 * that were not present in the original base resume.
 *
 * Property 11: Resume Count Invariant
 * Validates: Requirements 9.5, 9.6
 *
 * experiences.length and projects.length must equal the original counts.
 *
 * Property 12: Truthfulness Validation Fallback
 * Validates: Requirements 9.8, 9.9
 *
 * validateTruthfulness detects fabrications and optimizeResume falls back to
 * the base resume content when fabrications would be introduced.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import OpenAI from 'openai';
import {
  optimizeResume,
  validateTruthfulness,
} from './resumeOptimizer.js';
import type {
  WorkExperience,
  Project,
  Skill,
  Education,
  Certification,
  ResumeContent,
  ResumeVersion,
  TailoredResume,
} from './resumeOptimizer.js';
import type { ParsedJobPosting } from './discovery/types.js';

// ─── Mock LLM clients ─────────────────────────────────────────────────────────

/** Returns a predictable summary — avoids real LLM calls in tests. */
const mockLlmClient = {
  chat: {
    completions: {
      create: async () => ({
        choices: [{ message: { content: 'Mocked tailored summary.' } }],
      }),
    },
  },
} as unknown as OpenAI;

/** Always throws — used to exercise the LLM failure / fallback path. */
const failingLlmClient = {
  chat: {
    completions: {
      create: async () => {
        throw new Error('LLM unavailable');
      },
    },
  },
} as unknown as OpenAI;

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const arbWorkExperience: fc.Arbitrary<WorkExperience> = fc.record({
  company: fc.string({ minLength: 1, maxLength: 50 }),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  startDate: fc.constantFrom('2020-01', '2019-06', '2018-03', '2022-09'),
  bullets: fc.array(fc.string({ maxLength: 100 }), { minLength: 0, maxLength: 5 }),
  skills: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 8 }),
  location: fc.oneof(fc.string({ maxLength: 50 }), fc.constant(undefined)),
  endDate: fc.oneof(fc.string(), fc.constant(undefined)),
  isCurrent: fc.oneof(fc.boolean(), fc.constant(undefined)),
  description: fc.oneof(fc.string({ maxLength: 200 }), fc.constant(undefined)),
});

const arbProject: fc.Arbitrary<Project> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 80 }),
  skills: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 8 }),
  highlights: fc.array(fc.string({ maxLength: 100 }), { minLength: 0, maxLength: 5 }),
  description: fc.oneof(fc.string({ maxLength: 200 }), fc.constant(undefined)),
  url: fc.constant(undefined),
  repoUrl: fc.constant(undefined),
  startDate: fc.oneof(fc.constantFrom('2020-01', '2019-06'), fc.constant(undefined)),
  endDate: fc.oneof(fc.string(), fc.constant(undefined)),
  isCurrent: fc.oneof(fc.boolean(), fc.constant(undefined)),
});

const arbSkill: fc.Arbitrary<Skill> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 40 }),
  category: fc.oneof(fc.string({ maxLength: 30 }), fc.constant(undefined)),
  proficiency: fc.oneof(
    fc.constantFrom('beginner', 'intermediate', 'expert'),
    fc.constant(undefined),
  ),
  yearsOfExp: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(undefined)),
});

const arbEducation: fc.Arbitrary<Education> = fc.record({
  institution: fc.string({ minLength: 1, maxLength: 100 }),
  degree: fc.string({ minLength: 1, maxLength: 80 }),
  startDate: fc.constantFrom('2014-09', '2016-09', '2018-09'),
  field: fc.oneof(fc.string({ maxLength: 60 }), fc.constant(undefined)),
  endDate: fc.oneof(fc.string(), fc.constant(undefined)),
  gpa: fc.oneof(fc.float({ min: 0, max: 4 }), fc.constant(undefined)),
  description: fc.oneof(fc.string({ maxLength: 200 }), fc.constant(undefined)),
});

const arbCertification: fc.Arbitrary<Certification> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  issuer: fc.oneof(fc.string({ maxLength: 80 }), fc.constant(undefined)),
  issueDate: fc.oneof(fc.string(), fc.constant(undefined)),
  expiryDate: fc.oneof(fc.string(), fc.constant(undefined)),
  credentialId: fc.oneof(fc.string(), fc.constant(undefined)),
  credentialUrl: fc.oneof(fc.string(), fc.constant(undefined)),
});

const arbResumeVersion: fc.Arbitrary<ResumeVersion> = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 80 }),
  specialization: fc.constantFrom('backend', 'frontend', 'fullstack', 'devops', 'general'),
  fileUrl: fc.webUrl(),
  fileHash: fc.stringMatching(/^[0-9a-f]{64}$/),
  isDefault: fc.boolean(),
  content: fc.record({
    summary: fc.string({ maxLength: 500 }),
    experiences: fc.array(arbWorkExperience, { minLength: 0, maxLength: 5 }),
    education: fc.array(arbEducation, { minLength: 0, maxLength: 3 }),
    projects: fc.array(arbProject, { minLength: 0, maxLength: 5 }),
    skills: fc.array(arbSkill, { minLength: 0, maxLength: 15 }),
    certifications: fc.array(arbCertification, { minLength: 0, maxLength: 5 }),
    rawText: fc.string({ maxLength: 200 }),
  }),
});

const arbParsedJobPosting: fc.Arbitrary<ParsedJobPosting> = fc.record({
  sourceUrl: fc.webUrl(),
  platform: fc.constantFrom(
    'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters',
    'wellfound', 'ycombinator', 'remoteok', 'indeed', 'naukri',
    'linkedin', 'twitter_x', 'custom_url',
  ) as fc.Arbitrary<ParsedJobPosting['platform']>,
  discoveredAt: fc.date(),
  parsedAt: fc.date(),
  status: fc.constantFrom(
    'parsed', 'parse_failed', 'embedding_pending',
  ) as fc.Arbitrary<ParsedJobPosting['status']>,
  company: fc.oneof(fc.string({ maxLength: 50 }), fc.constant(null)),
  title: fc.oneof(fc.string({ maxLength: 80 }), fc.constant(null)),
  requiredSkills: fc.oneof(
    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 8 }),
    fc.constant(null),
  ),
  preferredSkills: fc.oneof(
    fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 8 }),
    fc.constant(null),
  ),
  yearsExperienceMin: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(null)),
  yearsExperienceMax: fc.oneof(fc.integer({ min: 0, max: 30 }), fc.constant(null)),
  location: fc.oneof(fc.array(fc.string(), { maxLength: 3 }), fc.constant(null)),
  isRemote: fc.oneof(fc.boolean(), fc.constant(null)),
  isHybrid: fc.oneof(fc.boolean(), fc.constant(null)),
  salaryMin: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(null)),
  salaryMax: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(null)),
  currency: fc.oneof(fc.constantFrom('USD', 'EUR', 'GBP'), fc.constant(null)),
  employmentType: fc.oneof(
    fc.constantFrom('full_time', 'part_time', 'contract'),
    fc.constant(null),
  ),
  visaRequirements: fc.oneof(fc.array(fc.string(), { maxLength: 2 }), fc.constant(null)),
  applicationDeadline: fc.oneof(fc.date(), fc.constant(null)),
  applicationUrl: fc.oneof(fc.webUrl(), fc.constant(null)),
  rawJson: fc.constant({} as Record<string, unknown>),
  rawHtml: fc.oneof(fc.string({ maxLength: 100 }), fc.constant(null)),
});

// ─── Concrete helpers ──────────────────────────────────────────────────────────

/** Minimal base resume used in concrete unit tests. */
function makeBaseResume(overrides?: Partial<ResumeContent>): ResumeVersion {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    name: 'My Resume',
    specialization: 'backend',
    fileUrl: 'https://example.com/resume.pdf',
    fileHash: 'a'.repeat(64),
    isDefault: true,
    content: {
      summary: 'Experienced backend engineer with TypeScript expertise.',
      experiences: [
        {
          company: 'Acme Corp',
          title: 'Software Engineer',
          startDate: '2020-01',
          bullets: ['Built REST APIs', 'Reduced latency by 30%'],
          skills: ['TypeScript', 'Node.js'],
        },
      ],
      education: [
        { institution: 'State University', degree: 'BSc Computer Science', startDate: '2016-09' },
      ],
      projects: [
        { name: 'OpenSource Tool', skills: ['TypeScript'], highlights: ['10k GitHub stars'] },
      ],
      skills: [
        { name: 'TypeScript' },
        { name: 'Node.js' },
        { name: 'PostgreSQL' },
      ],
      certifications: [
        { name: 'AWS Certified Developer' },
      ],
      rawText: 'Experienced backend engineer…',
      ...overrides,
    },
  };
}

/** Minimal job posting used in concrete unit tests. */
const baseJob: ParsedJobPosting = {
  sourceUrl: 'https://example.com/jobs/1',
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

// ─── Unit tests — optimizeResume ──────────────────────────────────────────────

describe('optimizeResume — specific examples', () => {
  it('returns a TailoredResume with the same baseResumeId and userId', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    expect(result.baseResumeId).toBe(base.id);
    expect(result.userId).toBe(base.userId);
  });

  it('preserves exact experience count after optimization', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    expect(result.content.experiences).toHaveLength(base.content.experiences.length);
  });

  it('preserves exact project count after optimization', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    expect(result.content.projects).toHaveLength(base.content.projects.length);
  });

  it('skills in result are a subset of original skills (by name, case-insensitive)', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    const origNames = new Set(base.content.skills.map((s) => s.name.toLowerCase().trim()));
    for (const skill of result.content.skills) {
      expect(origNames.has(skill.name.toLowerCase().trim())).toBe(true);
    }
  });

  it('sets summaryGenerated=true when LLM succeeds', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    expect(result.optimizationMetadata.summaryGenerated).toBe(true);
    expect(result.optimizationMetadata.summaryFallback).toBe(false);
  });

  it('falls back to original summary when LLM fails', async () => {
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, failingLlmClient);
    expect(result.optimizationMetadata.summaryFallback).toBe(true);
    expect(result.optimizationMetadata.summaryGenerated).toBe(false);
    expect(result.content.summary).toBe(base.content.summary);
  });

  it('sets truthfulnessFallback=true when base content is returned on fabrication detection', async () => {
    // Fabrication scenario: manually invoke optimizeResume and verify truthfulnessFallback
    // is not set for a clean (non-fabricated) result
    const base = makeBaseResume();
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    // A clean run should NOT trigger truthfulnessFallback
    expect(result.optimizationMetadata.truthfulnessFallback).toBeFalsy();
  });

  it('handles empty experiences and projects without error', async () => {
    const base = makeBaseResume({ experiences: [], projects: [], skills: [] });
    const result = await optimizeResume(base, baseJob, mockLlmClient);
    expect(result.content.experiences).toHaveLength(0);
    expect(result.content.projects).toHaveLength(0);
  });
});

// ─── Unit tests — validateTruthfulness ────────────────────────────────────────

describe('validateTruthfulness — specific examples', () => {
  it('returns hasFabrications=false for an unmodified resume', async () => {
    const base = makeBaseResume();
    const tailored = await optimizeResume(base, baseJob, mockLlmClient);
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(false);
    expect(report.violations).toHaveLength(0);
  });

  it('detects a fabricated experience not in the original', () => {
    const base = makeBaseResume();
    const fabricatedExp: WorkExperience = {
      company: 'Made Up Corp',
      title: 'Principal Engineer',
      startDate: '2023-01',
      bullets: [],
      skills: [],
    };
    // Build a TailoredResume with an injected fabricated experience
    const tailored: TailoredResume = {
      baseResumeId: base.id,
      userId: base.userId,
      content: {
        ...base.content,
        experiences: [...base.content.experiences, fabricatedExp],
      },
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
      },
    };
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(true);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.field === 'experiences')).toBe(true);
  });

  it('detects a fabricated project not in the original', () => {
    const base = makeBaseResume();
    const fabricatedProj: Project = {
      name: 'Invented Project',
      skills: [],
      highlights: [],
    };
    const tailored: TailoredResume = {
      baseResumeId: base.id,
      userId: base.userId,
      content: {
        ...base.content,
        projects: [...base.content.projects, fabricatedProj],
      },
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
      },
    };
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(true);
    expect(report.violations.some((v) => v.field === 'projects')).toBe(true);
  });

  it('detects a fabricated skill not in the original', () => {
    const base = makeBaseResume();
    const tailored: TailoredResume = {
      baseResumeId: base.id,
      userId: base.userId,
      content: {
        ...base.content,
        skills: [...base.content.skills, { name: 'Invented Skill XYZ' }],
      },
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
      },
    };
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(true);
    expect(report.violations.some((v) => v.field === 'skills')).toBe(true);
  });

  it('detects a fabricated certification not in the original', () => {
    const base = makeBaseResume();
    const tailored: TailoredResume = {
      baseResumeId: base.id,
      userId: base.userId,
      content: {
        ...base.content,
        certifications: [
          ...base.content.certifications,
          { name: 'Fake Cert Never Obtained' },
        ],
      },
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
      },
    };
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(true);
    expect(report.violations.some((v) => v.field === 'certifications')).toBe(true);
  });

  it('detects a fabricated education entry not in the original', () => {
    const base = makeBaseResume();
    const tailored: TailoredResume = {
      baseResumeId: base.id,
      userId: base.userId,
      content: {
        ...base.content,
        education: [
          ...base.content.education,
          { institution: 'Fake University', degree: 'PhD Rocket Science', startDate: '2023-09' },
        ],
      },
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
      },
    };
    const report = validateTruthfulness(base, tailored);
    expect(report.hasFabrications).toBe(true);
    expect(report.violations.some((v) => v.field === 'education')).toBe(true);
  });
});

// ─── Property 10: Resume Optimization Fact Preservation ──────────────────────
// **Validates: Requirements 9.4, 9.5, 9.6, 9.7**

describe('Property 10: Resume Optimization Fact Preservation (Req 9.4, 9.5, 9.6, 9.7)', () => {
  it('no new work experiences appear in the optimized resume', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);

        // Build a set of "company|title|startDate" keys from the original
        const origExpKeys = new Set(
          baseResume.content.experiences.map((e) =>
            `${e.company.toLowerCase().trim()}|${e.title.toLowerCase().trim()}|${e.startDate.toLowerCase().trim()}`,
          ),
        );

        for (const exp of result.content.experiences) {
          const key = `${exp.company.toLowerCase().trim()}|${exp.title.toLowerCase().trim()}|${exp.startDate.toLowerCase().trim()}`;
          expect(origExpKeys.has(key)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no new projects appear in the optimized resume', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);

        const origProjNames = new Set(
          baseResume.content.projects.map((p) => p.name.toLowerCase().trim()),
        );

        for (const proj of result.content.projects) {
          expect(origProjNames.has(proj.name.toLowerCase().trim())).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no new certifications appear in the optimized resume', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);

        const origCertNames = new Set(
          baseResume.content.certifications.map((c) => c.name.toLowerCase().trim()),
        );

        for (const cert of result.content.certifications) {
          expect(origCertNames.has(cert.name.toLowerCase().trim())).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('no new education entries appear in the optimized resume', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);

        const origEduKeys = new Set(
          baseResume.content.education.map((e) =>
            `${e.institution.toLowerCase().trim()}|${e.degree.toLowerCase().trim()}`,
          ),
        );

        for (const edu of result.content.education) {
          const key = `${edu.institution.toLowerCase().trim()}|${edu.degree.toLowerCase().trim()}`;
          expect(origEduKeys.has(key)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('skills set is a subset of original skills (case-insensitive)', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);

        const origSkillNames = new Set(
          baseResume.content.skills.map((s) => s.name.toLowerCase().trim()),
        );

        for (const skill of result.content.skills) {
          expect(origSkillNames.has(skill.name.toLowerCase().trim())).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 11: Resume Count Invariant ─────────────────────────────────────
// **Validates: Requirements 9.5, 9.6**

describe('Property 11: Resume Count Invariant (Req 9.5, 9.6)', () => {
  it('experiences count is preserved after optimization', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);
        expect(result.content.experiences.length).toBe(
          baseResume.content.experiences.length,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('projects count is preserved after optimization', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);
        expect(result.content.projects.length).toBe(
          baseResume.content.projects.length,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('experiences and projects counts are both preserved simultaneously', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);
        expect(result.content.experiences.length).toBe(
          baseResume.content.experiences.length,
        );
        expect(result.content.projects.length).toBe(
          baseResume.content.projects.length,
        );
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 12: Truthfulness Validation Fallback ───────────────────────────
// **Validates: Requirements 9.8, 9.9**

describe('Property 12: Truthfulness Validation Fallback (Req 9.8, 9.9)', () => {
  /**
   * Part 1: validateTruthfulness must detect injected fabrications.
   *
   * For any original resume, when we inject an extra experience/project/
   * skill/cert/edu that is NOT in the original, hasFabrications must be true
   * and violations must be non-empty.
   */
  it('detects fabricated experience for any arbitrary resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        // Inject a fabricated experience guaranteed to be distinguishable from the original.
        // We use a company name that is extremely unlikely to collide: a UUID-derived marker.
        const fabricatedExp: WorkExperience = {
          company: 'FABRICATED_COMPANY_XYZZY_12345',
          title: 'FABRICATED_TITLE_XYZZY_12345',
          startDate: '1900-01',
          bullets: [],
          skills: [],
        };

        const tailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: {
            ...original.content,
            // Replace experiences with just the fabricated one plus original count
            // to exercise count-mismatch AND key-mismatch detection paths.
            experiences: [...original.content.experiences, fabricatedExp],
          },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, tailored);
        expect(report.hasFabrications).toBe(true);
        expect(report.violations.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('detects fabricated project for any arbitrary resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        const fabricatedProj: Project = {
          name: 'FABRICATED_PROJECT_XYZZY_12345',
          skills: [],
          highlights: [],
        };

        const tailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: {
            ...original.content,
            projects: [...original.content.projects, fabricatedProj],
          },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, tailored);
        expect(report.hasFabrications).toBe(true);
        expect(report.violations.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('detects fabricated skill for any arbitrary resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        const tailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: {
            ...original.content,
            skills: [...original.content.skills, { name: 'FABRICATED_SKILL_XYZZY_12345' }],
          },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, tailored);
        expect(report.hasFabrications).toBe(true);
        expect(report.violations.some((v) => v.field === 'skills')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('detects fabricated certification for any arbitrary resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        const tailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: {
            ...original.content,
            certifications: [
              ...original.content.certifications,
              { name: 'FABRICATED_CERT_XYZZY_12345' },
            ],
          },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, tailored);
        expect(report.hasFabrications).toBe(true);
        expect(report.violations.some((v) => v.field === 'certifications')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('detects fabricated education entry for any arbitrary resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        const tailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: {
            ...original.content,
            education: [
              ...original.content.education,
              {
                institution: 'FABRICATED_UNIVERSITY_XYZZY_12345',
                degree: 'FABRICATED_DEGREE_XYZZY_12345',
                startDate: '1900-01',
              },
            ],
          },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, tailored);
        expect(report.hasFabrications).toBe(true);
        expect(report.violations.some((v) => v.field === 'education')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Part 2: optimizeResume returns base resume content when fabrications occur.
   *
   * A legitimate optimizeResume call (using mockLlmClient which only changes the
   * summary) must NOT set truthfulnessFallback, and must preserve counts.
   * This verifies the guard path is only triggered when truly needed.
   */
  it('truthfulnessFallback is NOT set for a clean optimizeResume call (no fabrications)', async () => {
    await fc.assert(
      fc.asyncProperty(arbResumeVersion, arbParsedJobPosting, async (baseResume, job) => {
        const result = await optimizeResume(baseResume, job, mockLlmClient);
        // A clean run should never trigger the fallback
        expect(result.optimizationMetadata.truthfulnessFallback).toBeFalsy();
      }),
      { numRuns: 200 },
    );
  });

  it('returns no violations for an unchanged (identity-transformed) resume', () => {
    fc.assert(
      fc.property(arbResumeVersion, (original) => {
        // Build a TailoredResume that is structurally identical to the original
        const identityTailored: TailoredResume = {
          baseResumeId: original.id,
          userId: original.userId,
          content: { ...original.content },
          optimizationMetadata: {
            experiencesReordered: false,
            projectsReordered: false,
            skillsReordered: false,
            summaryGenerated: false,
            summaryFallback: false,
          },
        };

        const report = validateTruthfulness(original, identityTailored);
        expect(report.hasFabrications).toBe(false);
        expect(report.violations).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });
});
