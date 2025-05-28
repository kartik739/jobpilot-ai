/**
 * Match score computation for the Job Ranking Agent.
 *
 * Computes a composite MatchScore from 6 weighted components:
 *   skill_match       × 0.35
 *   experience_match  × 0.20
 *   location_match    × 0.15
 *   salary_match      × 0.10
 *   tech_match        × 0.10
 *   llm_holistic      × 0.10
 *
 * Hard disqualifiers:
 *   - Incompatible work authorization  → overall = 0
 *   - Required skill coverage < 50%   → overall = 0
 *
 * Preferred company boost: 1.2× applied before clamping to [0, 100].
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import type { ParsedJobPosting } from '../discovery/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchScore {
  overall: number;            // 0-100
  skillMatch: number;         // weighted skill overlap
  experienceMatch: number;    // years required vs available
  locationMatch: number;      // location preference alignment
  salaryMatch: number;        // salary range overlap
  technologyMatch: number;    // tech stack alignment
  workAuthMatch: boolean;     // visa/authorization compatible
  successProbability: number; // historical + LLM prediction
  disqualifiers: string[];    // reasons to skip
}

/**
 * Minimal UserProfile shape needed for scoring.
 * Mirrors the design.md UserProfile and the Prisma schema fields.
 */
export interface UserProfile {
  /** User's work authorization types, e.g. ['US_CITIZEN', 'H1B']. */
  workAuthorization: string[];
  /** Whether the user requires visa sponsorship. */
  requiresSponsorship: boolean;
  /** Total years of professional experience (derived from work history). */
  totalYearsExperience: number;
  /** All skills the user has (names, case-insensitive). */
  skills: string[];
  /** Technology stack the user is familiar with. */
  techStack: string[];
  /** Preferred work locations, e.g. ['Remote', 'New York, NY']. */
  preferredLocations: string[];
  /** Remote-work preference. */
  remotePreference: 'remote_only' | 'hybrid' | 'onsite' | 'flexible';
  /** Minimum acceptable salary. */
  salaryMin?: number;
  /** Maximum acceptable salary. */
  salaryMax?: number;
  /** Companies the user prefers (1.2× score boost). */
  preferredCompanies: string[];
}

/**
 * Injectable LLM holistic scorer — defaults to returning 50 when unavailable.
 * In tests, pass `() => Promise.resolve(50)` to avoid real LLM calls.
 */
export type HolisticScoreFn = (
  job: ParsedJobPosting,
  profile: UserProfile,
) => Promise<number>;

// ─── Default holistic scorer (fallback = 50) ─────────────────────────────────

const defaultHolisticScoreFn: HolisticScoreFn = async () => 50;

// ─── Helper utilities ─────────────────────────────────────────────────────────

/** Normalise a string array to lowercase, trimmed, non-empty elements. */
function normalise(arr: string[] | null | undefined): string[] {
  return (arr ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
}

/** Jaccard-like overlap ratio: |A ∩ B| / |A| (coverage of A by B). */
function coverageRatio(required: string[], available: string[]): number {
  if (required.length === 0) return 1; // no requirements → full coverage
  const avSet = new Set(available);
  const matched = required.filter((r) => avSet.has(r)).length;
  return matched / required.length;
}

/** Clamp a value to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// ─── Component scorers (each returns 0-100) ───────────────────────────────────

/**
 * Skill match: what fraction of required + preferred skills does the user cover?
 * Weight: required skills count double vs preferred.
 */
function scoreSkillMatch(job: ParsedJobPosting, profile: UserProfile): number {
  const userSkills = normalise(profile.skills);
  const required = normalise(job.requiredSkills);
  const preferred = normalise(job.preferredSkills);

  const reqRatio = coverageRatio(required, userSkills);
  const prefRatio = coverageRatio(preferred, userSkills);

  if (required.length === 0 && preferred.length === 0) return 100;

  // Weighted blend: required contributes 70%, preferred 30%
  const totalWeight = (required.length > 0 ? 0.7 : 0) + (preferred.length > 0 ? 0.3 : 0);
  if (totalWeight === 0) return 100;

  let score = 0;
  if (required.length > 0) score += reqRatio * 0.7;
  if (preferred.length > 0) score += prefRatio * 0.3;
  score = score / totalWeight;

  return clamp(score * 100, 0, 100);
}

/**
 * Experience match: how well does the user's total years align with the job's range?
 * Full score when within range; decays outside.
 */
function scoreExperienceMatch(job: ParsedJobPosting, profile: UserProfile): number {
  const userYears = profile.totalYearsExperience;
  const minReq = job.yearsExperienceMin ?? 0;
  const maxReq = job.yearsExperienceMax ?? Infinity;

  if (userYears >= minReq && userYears <= maxReq) return 100;

  if (userYears < minReq) {
    // Under-qualified: decay proportionally
    const gap = minReq - userYears;
    const score = Math.max(0, 100 - gap * 10);
    return clamp(score, 0, 100);
  }

  // Over-qualified: slight penalty, capped at 80
  return 80;
}

/**
 * Location match: does the job's location align with the user's preferences?
 * Remote roles always match remote_only/hybrid/flexible users.
 */
function scoreLocationMatch(job: ParsedJobPosting, profile: UserProfile): number {
  const isRemote = job.isRemote === true;
  const isHybrid = job.isHybrid === true;

  if (isRemote) {
    if (profile.remotePreference === 'onsite') return 30;
    return 100;
  }

  if (isHybrid) {
    if (profile.remotePreference === 'remote_only') return 40;
    if (profile.remotePreference === 'hybrid' || profile.remotePreference === 'flexible') return 90;
    return 60;
  }

  // On-site only
  if (profile.remotePreference === 'remote_only') return 10;
  if (profile.remotePreference === 'hybrid') return 60;

  // Check location overlap
  const jobLocations = normalise(job.location);
  const userLocations = normalise(profile.preferredLocations);

  if (jobLocations.length === 0) return 70; // location unknown → neutral
  if (userLocations.length === 0) return 70;

  const hasMatch = jobLocations.some((jl) =>
    userLocations.some((ul) => jl.includes(ul) || ul.includes(jl)),
  );
  return hasMatch ? 100 : 40;
}

/**
 * Salary match: how well do the salary ranges overlap?
 * Full score when job range contains user's range or vice-versa; partial for partial overlap.
 */
function scoreSalaryMatch(job: ParsedJobPosting, profile: UserProfile): number {
  const jobMin = job.salaryMin;
  const jobMax = job.salaryMax;
  const userMin = profile.salaryMin;
  const userMax = profile.salaryMax;

  // Missing salary info → neutral score
  if (jobMin == null && jobMax == null) return 70;
  if (userMin == null && userMax == null) return 70;

  const jMin = jobMin ?? 0;
  const jMax = jobMax ?? Number.MAX_SAFE_INTEGER;
  const uMin = userMin ?? 0;
  const uMax = userMax ?? Number.MAX_SAFE_INTEGER;

  // No overlap
  if (jMax < uMin || uMax < jMin) return 0;

  // Full containment
  const overlapMin = Math.max(jMin, uMin);
  const overlapMax = Math.min(jMax, uMax);
  const overlapSize = overlapMax - overlapMin;
  const userRange = uMax - uMin;
  const jobRange = jMax - jMin;

  if (userRange === 0 && jobRange === 0) return 100;

  const denominator = Math.max(userRange, jobRange, 1);
  const overlapRatio = overlapSize / denominator;

  return clamp(overlapRatio * 100, 0, 100);
}

/**
 * Technology match: fraction of job's tech stack the user has experience with.
 * Combines required + preferred skills with the user's techStack.
 */
function scoreTechnologyMatch(job: ParsedJobPosting, profile: UserProfile): number {
  const userTech = normalise([...profile.techStack, ...profile.skills]);
  const jobTech = normalise([...(job.requiredSkills ?? []), ...(job.preferredSkills ?? [])]);

  if (jobTech.length === 0) return 100;

  return clamp(coverageRatio(jobTech, userTech) * 100, 0, 100);
}

// ─── Work auth check ──────────────────────────────────────────────────────────

/**
 * Returns true when the user's work authorization is compatible with the job.
 * If the job has no visa requirements, it is compatible with everyone.
 * If the job requires sponsorship and the user requires it but doesn't have
 * an auth type that signals self-sponsorship, it's incompatible.
 */
function checkWorkAuth(job: ParsedJobPosting, profile: UserProfile): boolean {
  const visaReqs = normalise(job.visaRequirements);
  if (visaReqs.length === 0) return true;

  // Check for explicit "no sponsorship" / "citizens only" indicator first
  const noSponsorshipOffered = visaReqs.some(
    (v) =>
      v.includes('no_sponsorship') ||
      v.includes('no sponsorship') ||
      v.includes('citizens_only'),
  );
  if (noSponsorshipOffered && profile.requiresSponsorship) {
    // Job explicitly won't sponsor and user needs it → incompatible
    return false;
  }

  return true; // Default to compatible
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

/**
 * Compute a composite MatchScore for a job/profile pair.
 *
 * @param job       The parsed job posting to score against.
 * @param profile   The user's profile.
 * @param holisticFn  Optional injectable LLM holistic scorer; defaults to 50.
 * @returns         A MatchScore with overall and all component scores in [0, 100].
 */
export async function computeMatchScore(
  job: ParsedJobPosting,
  profile: UserProfile,
  holisticFn: HolisticScoreFn = defaultHolisticScoreFn,
): Promise<MatchScore> {
  const disqualifiers: string[] = [];

  // ── Work authorization check ──────────────────────────────────────────────
  const workAuthMatch = checkWorkAuth(job, profile);
  if (!workAuthMatch) {
    disqualifiers.push('work_authorization_incompatible');
  }

  // ── Component scores (0-100) ──────────────────────────────────────────────
  const skillMatch = clamp(scoreSkillMatch(job, profile), 0, 100);
  const experienceMatch = clamp(scoreExperienceMatch(job, profile), 0, 100);
  const locationMatch = clamp(scoreLocationMatch(job, profile), 0, 100);
  const salaryMatch = clamp(scoreSalaryMatch(job, profile), 0, 100);
  const technologyMatch = clamp(scoreTechnologyMatch(job, profile), 0, 100);

  // ── LLM holistic (fallback = 50 on unavailability) ────────────────────────
  let holisticScore: number;
  try {
    holisticScore = clamp(await holisticFn(job, profile), 0, 100);
  } catch {
    holisticScore = 50; // fallback on LLM unavailability
  }

  // ── Required skill coverage disqualifier ─────────────────────────────────
  const required = normalise(job.requiredSkills);
  const userSkills = normalise(profile.skills);
  if (required.length > 0) {
    const coverage = coverageRatio(required, userSkills);
    if (coverage < 0.5) {
      disqualifiers.push('insufficient_required_skills');
    }
  }

  // ── Hard disqualifier: return overall = 0 immediately ─────────────────────
  if (disqualifiers.length > 0) {
    return {
      overall: 0,
      skillMatch,
      experienceMatch,
      locationMatch,
      salaryMatch,
      technologyMatch,
      workAuthMatch,
      successProbability: 0,
      disqualifiers,
    };
  }

  // ── Weighted overall score ────────────────────────────────────────────────
  const raw =
    skillMatch * 0.35 +
    experienceMatch * 0.20 +
    locationMatch * 0.15 +
    salaryMatch * 0.10 +
    technologyMatch * 0.10 +
    holisticScore * 0.10;

  // ── Preferred company boost (1.2×) before clamping ───────────────────────
  const company = (job.company ?? '').toLowerCase().trim();
  const isPreferred = profile.preferredCompanies.some(
    (pc) => pc.toLowerCase().trim() === company,
  );
  const boosted = isPreferred ? raw * 1.2 : raw;
  const overall = clamp(boosted, 0, 100);

  // successProbability mirrors overall for now (no historical data)
  const successProbability = overall;

  return {
    overall,
    skillMatch,
    experienceMatch,
    locationMatch,
    salaryMatch,
    technologyMatch,
    workAuthMatch: true,
    successProbability,
    disqualifiers: [],
  };
}
