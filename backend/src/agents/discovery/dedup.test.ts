/**
 * Property 6: Job Deduplication Idempotency
 * Validates: Requirements 7.3
 *
 * deduplicatePostings(deduplicatePostings(jobs)).length === deduplicatePostings(jobs).length
 * for all inputs — i.e. applying dedup twice is identical to applying it once.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeFingerprint, deduplicatePostings } from './dedup.js';
import type { ParsedJobPosting } from './types.js';

// ─── Arbitrary generator ──────────────────────────────────────────────────────

/**
 * Generates an arbitrary ParsedJobPosting with the fields that drive
 * fingerprinting (title, company, sourceUrl) plus the required structural
 * fields to satisfy the TypeScript interface.
 */
const arbParsedJobPosting: fc.Arbitrary<ParsedJobPosting> = fc.record({
  // Fingerprint-driving fields
  title: fc.oneof(fc.string(), fc.constant(null)),
  company: fc.oneof(fc.string(), fc.constant(null)),
  sourceUrl: fc.webUrl(),

  // Required structural fields
  platform: fc.constantFrom(
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'smartrecruiters',
    'wellfound',
    'ycombinator',
    'remoteok',
    'indeed',
    'naukri',
    'linkedin',
    'twitter_x',
    'custom_url',
  ) as fc.Arbitrary<ParsedJobPosting['platform']>,
  discoveredAt: fc.date(),
  parsedAt: fc.date(),
  status: fc.constantFrom(
    'parsed',
    'parse_failed',
    'embedding_pending',
  ) as fc.Arbitrary<ParsedJobPosting['status']>,

  // Nullable structured fields
  requiredSkills: fc.oneof(fc.array(fc.string()), fc.constant(null)),
  preferredSkills: fc.oneof(fc.array(fc.string()), fc.constant(null)),
  yearsExperienceMin: fc.oneof(fc.integer({ min: 0, max: 30 }), fc.constant(null)),
  yearsExperienceMax: fc.oneof(fc.integer({ min: 0, max: 30 }), fc.constant(null)),
  location: fc.oneof(fc.array(fc.string()), fc.constant(null)),
  isRemote: fc.oneof(fc.boolean(), fc.constant(null)),
  isHybrid: fc.oneof(fc.boolean(), fc.constant(null)),
  salaryMin: fc.oneof(fc.integer({ min: 0, max: 1_000_000 }), fc.constant(null)),
  salaryMax: fc.oneof(fc.integer({ min: 0, max: 1_000_000 }), fc.constant(null)),
  currency: fc.oneof(fc.string({ maxLength: 3 }), fc.constant(null)),
  employmentType: fc.oneof(fc.string(), fc.constant(null)),
  visaRequirements: fc.oneof(fc.array(fc.string()), fc.constant(null)),
  applicationDeadline: fc.oneof(fc.date(), fc.constant(null)),
  applicationUrl: fc.oneof(fc.webUrl(), fc.constant(null)),

  // Audit fields
  rawJson: fc.constant({} as Record<string, unknown>),
  rawHtml: fc.oneof(fc.string(), fc.constant(null)),
});

// ─── Unit tests — specific examples ──────────────────────────────────────────

describe('computeFingerprint — specific examples', () => {
  it('returns a 64-character hex string', () => {
    const fp = computeFingerprint('Engineer', 'Acme', 'https://acme.com/jobs/1');
    expect(fp).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });

  it('is case-insensitive for title and company', () => {
    const lower = computeFingerprint('engineer', 'acme', 'https://acme.com/jobs/1');
    const upper = computeFingerprint('ENGINEER', 'ACME', 'https://acme.com/jobs/1');
    expect(lower).toBe(upper);
  });

  it('produces the same result for identical inputs', () => {
    const fp1 = computeFingerprint('SWE', 'Corp', 'https://example.com');
    const fp2 = computeFingerprint('SWE', 'Corp', 'https://example.com');
    expect(fp1).toBe(fp2);
  });

  it('produces different results for different titles', () => {
    const fp1 = computeFingerprint('Engineer', 'Acme', 'https://acme.com/jobs/1');
    const fp2 = computeFingerprint('Manager', 'Acme', 'https://acme.com/jobs/1');
    expect(fp1).not.toBe(fp2);
  });

  it('produces different results for different companies', () => {
    const fp1 = computeFingerprint('Engineer', 'Acme', 'https://acme.com/jobs/1');
    const fp2 = computeFingerprint('Engineer', 'Beta', 'https://acme.com/jobs/1');
    expect(fp1).not.toBe(fp2);
  });

  it('produces different results for different URLs', () => {
    const fp1 = computeFingerprint('Engineer', 'Acme', 'https://acme.com/jobs/1');
    const fp2 = computeFingerprint('Engineer', 'Acme', 'https://acme.com/jobs/2');
    expect(fp1).not.toBe(fp2);
  });
});

describe('deduplicatePostings — specific examples', () => {
  it('returns an empty array for an empty input', () => {
    expect(deduplicatePostings([])).toHaveLength(0);
  });

  it('returns the same single-element array unchanged', () => {
    const job = {
      title: 'Engineer',
      company: 'Acme',
      sourceUrl: 'https://acme.com/jobs/1',
      platform: 'greenhouse' as const,
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed' as const,
      requiredSkills: null,
      preferredSkills: null,
      yearsExperienceMin: null,
      yearsExperienceMax: null,
      location: null,
      isRemote: null,
      isHybrid: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      employmentType: null,
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: null,
      rawJson: {},
      rawHtml: null,
    } satisfies ParsedJobPosting;

    const result = deduplicatePostings([job]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(job);
  });

  it('removes exact duplicate entries (same title/company/url)', () => {
    const base = {
      platform: 'lever' as const,
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed' as const,
      requiredSkills: null,
      preferredSkills: null,
      yearsExperienceMin: null,
      yearsExperienceMax: null,
      location: null,
      isRemote: null,
      isHybrid: null,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      employmentType: null,
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: null,
      rawJson: {},
      rawHtml: null,
    };
    const job1: ParsedJobPosting = { ...base, title: 'SWE', company: 'Corp', sourceUrl: 'https://corp.com/1' };
    const job2: ParsedJobPosting = { ...base, title: 'SWE', company: 'Corp', sourceUrl: 'https://corp.com/1' };

    const result = deduplicatePostings([job1, job2]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(job1); // first occurrence preserved
  });

  it('preserves order of first occurrences', () => {
    const base = {
      platform: 'ashby' as const,
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed' as const,
      requiredSkills: null, preferredSkills: null, yearsExperienceMin: null,
      yearsExperienceMax: null, location: null, isRemote: null, isHybrid: null,
      salaryMin: null, salaryMax: null, currency: null, employmentType: null,
      visaRequirements: null, applicationDeadline: null, applicationUrl: null,
      rawJson: {}, rawHtml: null,
    };
    const job1: ParsedJobPosting = { ...base, title: 'A', company: 'X', sourceUrl: 'https://x.com/1' };
    const job2: ParsedJobPosting = { ...base, title: 'B', company: 'Y', sourceUrl: 'https://y.com/2' };
    const job3: ParsedJobPosting = { ...base, title: 'A', company: 'X', sourceUrl: 'https://x.com/1' }; // dup of job1

    const result = deduplicatePostings([job1, job2, job3]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(job1);
    expect(result[1]).toBe(job2);
  });
});

// ─── Property 6: Job Deduplication Idempotency ───────────────────────────────
// Validates: Requirements 7.3

describe('Property 6: Job Deduplication Idempotency (Req 7.3)', () => {
  it('dedup(dedup(jobs)).length === dedup(jobs).length for arbitrary job arrays', () => {
    fc.assert(
      fc.property(fc.array(arbParsedJobPosting), (jobs) => {
        const once = deduplicatePostings(jobs);
        const twice = deduplicatePostings(once);
        expect(twice.length).toBe(once.length);
      }),
      { numRuns: 200 },
    );
  });

  it('dedup(dedup(jobs)) produces the same elements as dedup(jobs)', () => {
    fc.assert(
      fc.property(fc.array(arbParsedJobPosting), (jobs) => {
        const once = deduplicatePostings(jobs);
        const twice = deduplicatePostings(once);
        // Same references in the same order
        expect(twice).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it('dedup result length never exceeds input length', () => {
    fc.assert(
      fc.property(fc.array(arbParsedJobPosting), (jobs) => {
        expect(deduplicatePostings(jobs).length).toBeLessThanOrEqual(jobs.length);
      }),
      { numRuns: 200 },
    );
  });

  it('computeFingerprint is deterministic for the same inputs', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        (title, company, url) => {
          expect(computeFingerprint(title, company, url)).toBe(
            computeFingerprint(title, company, url),
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
