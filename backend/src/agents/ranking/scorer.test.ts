/**
 * Property 7: Match Score Boundedness
 * Validates: Requirements 8.2
 *
 * For any arbitrary job/profile combination:
 *   overall ∈ [0, 100]
 *   skillMatch ∈ [0, 100]
 *   experienceMatch ∈ [0, 100]
 *   locationMatch ∈ [0, 100]
 *   salaryMatch ∈ [0, 100]
 *   technologyMatch ∈ [0, 100]
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeMatchScore } from './scorer.js';
import type { UserProfile } from './scorer.js';
import type { ParsedJobPosting } from '../discovery/types.js';

// ─── Stub LLM holistic scorer ─────────────────────────────────────────────────

/** Always returns 50 — avoids real LLM calls in tests. */
const stubHolistic = async () => 50;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a non-empty array of non-empty strings (skill/tech names). */
const arbStringArray = fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
  minLength: 0,
  maxLength: 10,
});

/** Generates a possibly null string array (for job fields that can be null). */
const arbNullableStringArray = fc.oneof(arbStringArray, fc.constant(null));

/** Generates an arbitrary UserProfile. */
const arbUserProfile: fc.Arbitrary<UserProfile> = fc.record({
  workAuthorization: fc.array(
    fc.constantFrom('US_CITIZEN', 'PERMANENT_RESIDENT', 'H1B', 'OPT', 'EAD'),
    { minLength: 1, maxLength: 3 },
  ),
  requiresSponsorship: fc.boolean(),
  totalYearsExperience: fc.integer({ min: 0, max: 40 }),
  skills: arbStringArray,
  techStack: arbStringArray,
  preferredLocations: fc.array(
    fc.constantFrom('Remote', 'New York, NY', 'San Francisco, CA', 'Austin, TX', 'London, UK'),
    { minLength: 0, maxLength: 3 },
  ),
  remotePreference: fc.constantFrom('remote_only', 'hybrid', 'onsite', 'flexible') as fc.Arbitrary<
    UserProfile['remotePreference']
  >,
  salaryMin: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(undefined)),
  salaryMax: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(undefined)),
  preferredCompanies: fc.array(
    fc.constantFrom('Acme Corp', 'Tech Co', 'StartupXYZ', 'BigCorp'),
    { minLength: 0, maxLength: 3 },
  ),
});

/** Generates an arbitrary ParsedJobPosting (only fields used by the scorer). */
const arbParsedJobPosting: fc.Arbitrary<ParsedJobPosting> = fc.record({
  // Scorer-relevant fields
  company: fc.oneof(fc.string({ minLength: 0, maxLength: 50 }), fc.constant(null)),
  title: fc.oneof(fc.string({ minLength: 0, maxLength: 80 }), fc.constant(null)),
  requiredSkills: arbNullableStringArray,
  preferredSkills: arbNullableStringArray,
  yearsExperienceMin: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(null)),
  yearsExperienceMax: fc.oneof(fc.integer({ min: 0, max: 30 }), fc.constant(null)),
  location: fc.oneof(
    fc.array(
      fc.constantFrom('Remote', 'New York, NY', 'San Francisco, CA', 'Austin, TX'),
      { minLength: 0, maxLength: 3 },
    ),
    fc.constant(null),
  ),
  isRemote: fc.oneof(fc.boolean(), fc.constant(null)),
  isHybrid: fc.oneof(fc.boolean(), fc.constant(null)),
  salaryMin: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(null)),
  salaryMax: fc.oneof(fc.integer({ min: 0, max: 500_000 }), fc.constant(null)),
  currency: fc.oneof(fc.constantFrom('USD', 'EUR', 'GBP', 'INR'), fc.constant(null)),
  visaRequirements: fc.oneof(
    fc.array(
      fc.constantFrom('no_sponsorship', 'citizens_only', 'h1b_ok', 'visa_ok'),
      { minLength: 0, maxLength: 2 },
    ),
    fc.constant(null),
  ),
  // Required structural fields
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
  employmentType: fc.oneof(
    fc.constantFrom('full_time', 'part_time', 'contract', 'internship'),
    fc.constant(null),
  ),
  applicationDeadline: fc.oneof(fc.date(), fc.constant(null)),
  applicationUrl: fc.oneof(fc.webUrl(), fc.constant(null)),
  rawJson: fc.constant({} as Record<string, unknown>),
  rawHtml: fc.oneof(fc.string(), fc.constant(null)),
});

// ─── Unit tests — specific examples ──────────────────────────────────────────

describe('computeMatchScore — specific examples', () => {
  it('returns overall=0 and disqualifier for incompatible work auth (no_sponsorship + requiresSponsorship)', async () => {
    const job: ParsedJobPosting = {
      sourceUrl: 'https://example.com/job/1',
      platform: 'greenhouse',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed',
      company: 'Acme',
      title: 'Senior Engineer',
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: [],
      yearsExperienceMin: 3,
      yearsExperienceMax: 8,
      location: ['New York, NY'],
      isRemote: false,
      isHybrid: false,
      salaryMin: 100_000,
      salaryMax: 150_000,
      currency: 'USD',
      employmentType: 'full_time',
      visaRequirements: ['no_sponsorship'],
      applicationDeadline: null,
      applicationUrl: 'https://acme.com/apply',
      rawJson: {},
      rawHtml: null,
    };

    const profile: UserProfile = {
      workAuthorization: ['H1B'],
      requiresSponsorship: true,
      totalYearsExperience: 5,
      skills: ['TypeScript', 'Node.js', 'React'],
      techStack: ['TypeScript', 'Node.js'],
      preferredLocations: ['New York, NY'],
      remotePreference: 'onsite',
      salaryMin: 90_000,
      salaryMax: 160_000,
      preferredCompanies: [],
    };

    const score = await computeMatchScore(job, profile, stubHolistic);
    expect(score.overall).toBe(0);
    expect(score.disqualifiers).toContain('work_authorization_incompatible');
  });

  it('returns overall=0 and disqualifier when required skill coverage < 50%', async () => {
    const job: ParsedJobPosting = {
      sourceUrl: 'https://example.com/job/2',
      platform: 'lever',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed',
      company: 'Beta Inc',
      title: 'ML Engineer',
      requiredSkills: ['Python', 'TensorFlow', 'Kubernetes', 'CUDA', 'PyTorch'],
      preferredSkills: [],
      yearsExperienceMin: 2,
      yearsExperienceMax: null,
      location: ['Remote'],
      isRemote: true,
      isHybrid: false,
      salaryMin: null,
      salaryMax: null,
      currency: null,
      employmentType: 'full_time',
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: null,
      rawJson: {},
      rawHtml: null,
    };

    const profile: UserProfile = {
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      totalYearsExperience: 3,
      skills: ['Python'], // only 1/5 = 20% coverage → disqualified
      techStack: ['Python'],
      preferredLocations: ['Remote'],
      remotePreference: 'remote_only',
      salaryMin: undefined,
      salaryMax: undefined,
      preferredCompanies: [],
    };

    const score = await computeMatchScore(job, profile, stubHolistic);
    expect(score.overall).toBe(0);
    expect(score.disqualifiers).toContain('insufficient_required_skills');
  });

  it('returns overall > 0 for a well-matched job/profile pair', async () => {
    const job: ParsedJobPosting = {
      sourceUrl: 'https://example.com/job/3',
      platform: 'ashby',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed',
      company: 'Tech Co',
      title: 'Backend Engineer',
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: ['PostgreSQL'],
      yearsExperienceMin: 2,
      yearsExperienceMax: 6,
      location: ['Remote'],
      isRemote: true,
      isHybrid: false,
      salaryMin: 100_000,
      salaryMax: 150_000,
      currency: 'USD',
      employmentType: 'full_time',
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: 'https://tech.co/apply',
      rawJson: {},
      rawHtml: null,
    };

    const profile: UserProfile = {
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      totalYearsExperience: 4,
      skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'React'],
      techStack: ['TypeScript', 'Node.js', 'PostgreSQL'],
      preferredLocations: ['Remote'],
      remotePreference: 'remote_only',
      salaryMin: 90_000,
      salaryMax: 160_000,
      preferredCompanies: [],
    };

    const score = await computeMatchScore(job, profile, stubHolistic);
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.disqualifiers).toHaveLength(0);
  });

  it('applies 1.2× boost for preferred companies and clamps to 100', async () => {
    const job: ParsedJobPosting = {
      sourceUrl: 'https://example.com/job/4',
      platform: 'greenhouse',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed',
      company: 'Dream Co',
      title: 'Staff Engineer',
      requiredSkills: ['TypeScript'],
      preferredSkills: [],
      yearsExperienceMin: 1,
      yearsExperienceMax: 20,
      location: ['Remote'],
      isRemote: true,
      isHybrid: false,
      salaryMin: 80_000,
      salaryMax: 300_000,
      currency: 'USD',
      employmentType: 'full_time',
      visaRequirements: null,
      applicationDeadline: null,
      applicationUrl: null,
      rawJson: {},
      rawHtml: null,
    };

    const profile: UserProfile = {
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      totalYearsExperience: 8,
      skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
      techStack: ['TypeScript', 'Node.js'],
      preferredLocations: ['Remote'],
      remotePreference: 'flexible',
      salaryMin: 100_000,
      salaryMax: 250_000,
      preferredCompanies: ['Dream Co'], // triggers 1.2× boost
    };

    const score = await computeMatchScore(job, profile, stubHolistic);
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100); // clamped even after boost
  });

  it('handles empty required and preferred skills gracefully', async () => {
    const job: ParsedJobPosting = {
      sourceUrl: 'https://example.com/job/5',
      platform: 'remoteok',
      discoveredAt: new Date(),
      parsedAt: new Date(),
      status: 'parsed',
      company: null,
      title: null,
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

    const profile: UserProfile = {
      workAuthorization: ['US_CITIZEN'],
      requiresSponsorship: false,
      totalYearsExperience: 0,
      skills: [],
      techStack: [],
      preferredLocations: [],
      remotePreference: 'flexible',
      salaryMin: undefined,
      salaryMax: undefined,
      preferredCompanies: [],
    };

    const score = await computeMatchScore(job, profile, stubHolistic);
    // With no required skills or constraints, should score positively
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
  });
});

// ─── Property 8: Hard Disqualifier Zero Score ────────────────────────────────
// **Validates: Requirements 8.4, 8.5, 8.6**

describe('Property 8: Hard Disqualifier Zero Score (Req 8.4, 8.5, 8.6)', () => {
  /**
   * Generates a job posting with incompatible work authorization:
   * visaRequirements contains 'no_sponsorship' or 'citizens_only',
   * paired with a profile that requiresSponsorship === true.
   */
  const arbIncompatibleWorkAuthPair = fc.record({
    job: arbParsedJobPosting.map((job) => ({
      ...job,
      visaRequirements: fc.sample(
        fc.array(
          fc.constantFrom('no_sponsorship', 'citizens_only'),
          { minLength: 1, maxLength: 2 },
        ),
        1,
      )[0],
    })),
    profile: arbUserProfile.map((profile) => ({
      ...profile,
      requiresSponsorship: true,
    })),
  });

  /**
   * Generates a job with N required skills and a profile that covers < 50% of them.
   * Strategy: job has at least 2 required skills, user has 0 matching skills
   * (all user skills are distinct from required skills).
   */
  const arbInsufficientSkillsCoverage = fc
    .tuple(
      // Job required skills: at least 2 unique distinct skill names (uppercase to avoid overlap)
      fc.array(
        fc.stringMatching(/^[A-Z][A-Z0-9]{2,9}$/),
        { minLength: 2, maxLength: 8 },
      ).filter((skills) => new Set(skills.map((s) => s.toLowerCase())).size === skills.length),
      // User skills: at most floor((N-1)/2) matches allowed — simplest: empty skills
      arbUserProfile,
      arbParsedJobPosting,
    )
    .map(([requiredSkills, profile, baseJob]) => {
      // User has no skills overlapping with requiredSkills → 0% coverage
      const profileNoSkillsMatch = {
        ...profile,
        skills: ['zzznotaskill'], // no overlap with uppercase job skills
        requiresSponsorship: false, // avoid mixing disqualifiers
        workAuthorization: ['US_CITIZEN'],
      };
      const job = {
        ...baseJob,
        requiredSkills,
        visaRequirements: null, // no work auth disqualifier
      };
      return { job, profile: profileNoSkillsMatch };
    });

  it('overall === 0 when work authorization is incompatible', async () => {
    await fc.assert(
      fc.asyncProperty(arbIncompatibleWorkAuthPair, async ({ job, profile }) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.overall).toBe(0);
      }),
      { numRuns: 150 },
    );
  });

  it('disqualifiers is non-empty when work authorization is incompatible', async () => {
    await fc.assert(
      fc.asyncProperty(arbIncompatibleWorkAuthPair, async ({ job, profile }) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.disqualifiers).not.toHaveLength(0);
        expect(score.disqualifiers).toContain('work_authorization_incompatible');
      }),
      { numRuns: 150 },
    );
  });

  it('overall === 0 when required skill coverage is below 50%', async () => {
    await fc.assert(
      fc.asyncProperty(arbInsufficientSkillsCoverage, async ({ job, profile }) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.overall).toBe(0);
      }),
      { numRuns: 150 },
    );
  });

  it('disqualifiers is non-empty when required skill coverage is below 50%', async () => {
    await fc.assert(
      fc.asyncProperty(arbInsufficientSkillsCoverage, async ({ job, profile }) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.disqualifiers).not.toHaveLength(0);
        expect(score.disqualifiers).toContain('insufficient_required_skills');
      }),
      { numRuns: 150 },
    );
  });

  it('overall === 0 for either hard disqualifier (combined arbitrary)', async () => {
    // Mix both disqualifier scenarios together
    const arbEitherDisqualifier = fc.oneof(
      arbIncompatibleWorkAuthPair,
      arbInsufficientSkillsCoverage,
    );
    await fc.assert(
      fc.asyncProperty(arbEitherDisqualifier, async ({ job, profile }) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.overall).toBe(0);
        expect(score.disqualifiers.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Property 7: Match Score Boundedness ─────────────────────────────────────
// **Validates: Requirements 8.2**

describe('Property 7: Match Score Boundedness (Req 8.2)', () => {
  it('overall is always in [0, 100] for arbitrary job/profile combinations', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.overall).toBeGreaterThanOrEqual(0);
        expect(score.overall).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('skillMatch is always in [0, 100]', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.skillMatch).toBeGreaterThanOrEqual(0);
        expect(score.skillMatch).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('experienceMatch is always in [0, 100]', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.experienceMatch).toBeGreaterThanOrEqual(0);
        expect(score.experienceMatch).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('locationMatch is always in [0, 100]', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.locationMatch).toBeGreaterThanOrEqual(0);
        expect(score.locationMatch).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('salaryMatch is always in [0, 100]', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.salaryMatch).toBeGreaterThanOrEqual(0);
        expect(score.salaryMatch).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('technologyMatch is always in [0, 100]', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);
        expect(score.technologyMatch).toBeGreaterThanOrEqual(0);
        expect(score.technologyMatch).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });

  it('all component scores are in [0, 100] simultaneously', async () => {
    await fc.assert(
      fc.asyncProperty(arbParsedJobPosting, arbUserProfile, async (job, profile) => {
        const score = await computeMatchScore(job, profile, stubHolistic);

        const components = [
          score.skillMatch,
          score.experienceMatch,
          score.locationMatch,
          score.salaryMatch,
          score.technologyMatch,
        ];

        for (const component of components) {
          expect(component).toBeGreaterThanOrEqual(0);
          expect(component).toBeLessThanOrEqual(100);
        }
        expect(score.overall).toBeGreaterThanOrEqual(0);
        expect(score.overall).toBeLessThanOrEqual(100);
      }),
      { numRuns: 500 },
    );
  });
});

// ─── Property 9: Preferred Company Score Boost ───────────────────────────────
// **Validates: Requirements 8.3**

describe('Property 9: Preferred Company Score Boost (Req 8.3)', () => {
  /**
   * Generates a job/profile pair guaranteed to produce a non-zero score
   * (i.e., no hard disqualifiers):
   * - Job has a non-empty company name
   * - Profile has no sponsorship requirement (avoids work_auth disqualifier)
   * - Profile skills cover ≥50% of required skills (avoids skill disqualifier)
   * - Profile's preferredCompanies does NOT contain the job's company
   */
  const arbBoostPair = fc
    .tuple(
      // company name: non-empty, trimmed, no leading/trailing whitespace
      fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{1,29}$/).map((s) => s.trim()).filter((s) => s.length > 0),
      arbParsedJobPosting,
      arbUserProfile,
    )
    .map(([company, baseJob, baseProfile]) => {
      // Build required skills that the profile WILL cover (≥50%)
      // Use the profile's existing skills so coverage is guaranteed
      const profileSkills =
        baseProfile.skills.length > 0
          ? baseProfile.skills
          : ['TypeScript', 'Node.js']; // fallback so we always have skills

      // Build job with: the generated company, skills drawn from profile (100% coverage),
      // no sponsorship requirement
      const job: ParsedJobPosting = {
        ...baseJob,
        company,
        requiredSkills: profileSkills.slice(0, Math.max(1, Math.floor(profileSkills.length / 2))),
        visaRequirements: null, // no work auth disqualifier
      };

      // Profile without the company in preferredCompanies
      const profileWithout: UserProfile = {
        ...baseProfile,
        skills: profileSkills,
        requiresSponsorship: false,
        workAuthorization: ['US_CITIZEN'],
        preferredCompanies: [], // no preferred companies → no boost
      };

      // Profile WITH the company in preferredCompanies
      const profileWith: UserProfile = {
        ...profileWithout,
        preferredCompanies: [company], // triggers 1.2× boost
      };

      return { job, profileWithout, profileWith };
    });

  it('scoreWithBoost equals Math.min(scoreWithoutBoost * 1.2, 100) when pre-boost > 0', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoostPair, async ({ job, profileWithout, profileWith }) => {
        const [scoreWithout, scoreWith] = await Promise.all([
          computeMatchScore(job, profileWithout, stubHolistic),
          computeMatchScore(job, profileWith, stubHolistic),
        ]);

        // Only verify the boost relationship when there are no disqualifiers
        // (scoreWithoutBoost > 0 ensures no hard disqualifiers fired)
        if (scoreWithout.overall > 0) {
          const expected = Math.min(scoreWithout.overall * 1.2, 100);
          expect(Math.abs(scoreWith.overall - expected)).toBeLessThan(0.001);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('scoreWithBoost > scoreWithoutBoost when pre-boost * 1.2 < 100', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoostPair, async ({ job, profileWithout, profileWith }) => {
        const [scoreWithout, scoreWith] = await Promise.all([
          computeMatchScore(job, profileWithout, stubHolistic),
          computeMatchScore(job, profileWith, stubHolistic),
        ]);

        // Only assert when there are no disqualifiers and the boost doesn't hit the cap
        if (scoreWithout.overall > 0 && scoreWithout.overall * 1.2 < 100) {
          expect(scoreWith.overall).toBeGreaterThan(scoreWithout.overall);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('scoreWithBoost === 100 when pre-boost * 1.2 >= 100', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoostPair, async ({ job, profileWithout, profileWith }) => {
        const [scoreWithout, scoreWith] = await Promise.all([
          computeMatchScore(job, profileWithout, stubHolistic),
          computeMatchScore(job, profileWith, stubHolistic),
        ]);

        if (scoreWithout.overall > 0 && scoreWithout.overall * 1.2 >= 100) {
          expect(scoreWith.overall).toBe(100);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('scoreWithBoost is always in [0, 100] regardless of boost (clamping holds)', async () => {
    await fc.assert(
      fc.asyncProperty(arbBoostPair, async ({ job, profileWith }) => {
        const score = await computeMatchScore(job, profileWith, stubHolistic);
        expect(score.overall).toBeGreaterThanOrEqual(0);
        expect(score.overall).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 },
    );
  });
});

// ─── Concrete unit tests for preferred company boost ─────────────────────────

describe('computeMatchScore — preferred company boost concrete examples', () => {
  /**
   * A base job/profile pair that:
   * - Has no hard disqualifiers
   * - Has a well-known, controlled score (high skill match, experience in range, remote, salary overlap)
   * - Results in a predictable pre-boost raw score
   */
  const baseJob: ParsedJobPosting = {
    sourceUrl: 'https://example.com/job/boost-test',
    platform: 'greenhouse',
    discoveredAt: new Date(),
    parsedAt: new Date(),
    status: 'parsed',
    company: 'BoostCo',
    title: 'Senior Engineer',
    requiredSkills: ['TypeScript', 'Node.js'],
    preferredSkills: ['PostgreSQL'],
    yearsExperienceMin: 2,
    yearsExperienceMax: 8,
    location: ['Remote'],
    isRemote: true,
    isHybrid: false,
    salaryMin: 100_000,
    salaryMax: 150_000,
    currency: 'USD',
    employmentType: 'full_time',
    visaRequirements: null,
    applicationDeadline: null,
    applicationUrl: 'https://boostco.com/apply',
    rawJson: {},
    rawHtml: null,
  };

  const baseProfile: UserProfile = {
    workAuthorization: ['US_CITIZEN'],
    requiresSponsorship: false,
    totalYearsExperience: 5,
    skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    techStack: ['TypeScript', 'Node.js', 'PostgreSQL'],
    preferredLocations: ['Remote'],
    remotePreference: 'remote_only',
    salaryMin: 90_000,
    salaryMax: 160_000,
    preferredCompanies: [],
  };

  it('applies 1.2× boost and scoreWithBoost === Math.min(scoreWithout * 1.2, 100)', async () => {
    const [scoreWithout, scoreWith] = await Promise.all([
      computeMatchScore(baseJob, { ...baseProfile, preferredCompanies: [] }, stubHolistic),
      computeMatchScore(baseJob, { ...baseProfile, preferredCompanies: ['BoostCo'] }, stubHolistic),
    ]);

    expect(scoreWithout.overall).toBeGreaterThan(0);
    expect(scoreWithout.disqualifiers).toHaveLength(0);

    const expectedBoosted = Math.min(scoreWithout.overall * 1.2, 100);
    expect(Math.abs(scoreWith.overall - expectedBoosted)).toBeLessThan(0.001);
  });

  it('scoreWithBoost > scoreWithoutBoost when pre-boost score allows headroom', async () => {
    // Profile intentionally weak in several dimensions to keep pre-boost score < 83.33:
    //   - experience under-qualified (0 years vs min 2) → experienceMatch ≈ 80
    //   - salary mismatch (user min 200k vs job max 150k) → salaryMatch = 0
    //   - holistic = 0 (lowest possible)
    //   - location & skill still good (so no disqualifiers)
    const lowHolistic = async () => 0;

    const weakJob: ParsedJobPosting = {
      ...baseJob,
      company: 'BoostCo',
      yearsExperienceMin: 2,
      yearsExperienceMax: 8,
      salaryMin: 60_000,
      salaryMax: 90_000, // below user salary min → salaryMatch = 0
    };

    const weakProfile: UserProfile = {
      ...baseProfile,
      totalYearsExperience: 0,  // under-qualified → experienceMatch ≈ 80
      salaryMin: 150_000,       // no overlap with job salary → salaryMatch = 0
      salaryMax: 250_000,
      preferredCompanies: [],
    };

    const [scoreWithout, scoreWith] = await Promise.all([
      computeMatchScore(weakJob, { ...weakProfile, preferredCompanies: [] }, lowHolistic),
      computeMatchScore(weakJob, { ...weakProfile, preferredCompanies: ['BoostCo'] }, lowHolistic),
    ]);

    expect(scoreWithout.overall).toBeGreaterThan(0);
    expect(scoreWithout.overall).toBeLessThan(100 / 1.2); // headroom for boost
    expect(scoreWith.overall).toBeGreaterThan(scoreWithout.overall);
  });

  it('boost is case-insensitive and trims whitespace', async () => {
    const [scoreWithout, scoreWith] = await Promise.all([
      computeMatchScore(baseJob, { ...baseProfile, preferredCompanies: [] }, stubHolistic),
      // Company stored as 'BoostCo', preferred list uses different casing + spaces
      computeMatchScore(
        baseJob,
        { ...baseProfile, preferredCompanies: ['  BOOSTCO  '] },
        stubHolistic,
      ),
    ]);

    expect(scoreWithout.overall).toBeGreaterThan(0);
    const expectedBoosted = Math.min(scoreWithout.overall * 1.2, 100);
    expect(Math.abs(scoreWith.overall - expectedBoosted)).toBeLessThan(0.001);
  });

  it('no boost applied when company is not in preferredCompanies', async () => {
    const [scoreWithout, scoreWithDifferentPref] = await Promise.all([
      computeMatchScore(baseJob, { ...baseProfile, preferredCompanies: [] }, stubHolistic),
      computeMatchScore(
        baseJob,
        { ...baseProfile, preferredCompanies: ['OtherCorp', 'AnotherCo'] },
        stubHolistic,
      ),
    ]);

    // Scores should be identical — no boost
    expect(scoreWithDifferentPref.overall).toBeCloseTo(scoreWithout.overall, 5);
  });

  it('clamps to 100 when pre-boost score × 1.2 exceeds 100', async () => {
    // Force a near-100 pre-boost by making everything perfect and using a high holistic stub
    const highHolistic = async () => 100;

    // Job with wide salary range to guarantee salary match, experience well-covered
    const highScoreJob: ParsedJobPosting = {
      ...baseJob,
      company: 'CappedCo',
      requiredSkills: ['TypeScript'],
      preferredSkills: [],
      yearsExperienceMin: 1,
      yearsExperienceMax: 50,
      salaryMin: 0,
      salaryMax: 1_000_000,
    };

    const highScoreProfile: UserProfile = {
      ...baseProfile,
      skills: ['TypeScript'],
      techStack: ['TypeScript'],
      totalYearsExperience: 10,
      preferredCompanies: ['CappedCo'],
      salaryMin: 100_000,
      salaryMax: 200_000,
    };

    const score = await computeMatchScore(highScoreJob, highScoreProfile, highHolistic);
    expect(score.overall).toBe(100);
  });
});
