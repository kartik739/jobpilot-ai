/**
 * Profile completeness service.
 *
 * Computes a score (0–100) reflecting how many of the 9 required profile
 * sections are satisfied. This is the single source of truth — profile.ts
 * and agent.ts both import from here.
 *
 * Required sections:
 *  1. fullName present
 *  2. email present
 *  3. phone present
 *  4. location present
 *  5. at least one workExperience
 *  6. at least one skill
 *  7. workAuthorization non-empty
 *  8. targetRoles non-empty
 *  9. preferredLocations non-empty
 *
 * Score = Math.round((satisfiedCount / 9) * 100)
 *
 * Requirements: 1.8, 2.4, 2.5
 */

/** Minimal profile shape needed to compute completeness. */
export interface CompletenessProfile {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  workExperiences?: unknown[];
  skills?: unknown[];
  workAuthorization?: string[];
  targetRoles?: string[];
  preferredLocations?: string[];
}

const TOTAL_SECTIONS = 9;
const MINIMUM_COMPLETENESS = 70;

export { MINIMUM_COMPLETENESS };

/**
 * Compute profile completeness score (0–100).
 *
 * Accepts either:
 *  - A `CompletenessProfile` object (all-in-one form used by profile routes)
 *  - A profile object plus explicit `hasWorkExperience` / `hasSkills` booleans
 *    (useful when callers already have counts from the DB without loading arrays)
 *
 * @param profile        Profile data (or scalar-only subset with boolean flags)
 * @param hasWorkExperience  When provided, overrides the array-length check for work experiences
 * @param hasSkills          When provided, overrides the array-length check for skills
 */
export function computeCompleteness(
  profile: CompletenessProfile,
  hasWorkExperience?: boolean,
  hasSkills?: boolean,
): number {
  let satisfied = 0;

  if (profile.fullName) satisfied++;
  if (profile.email) satisfied++;
  if (profile.phone) satisfied++;
  if (profile.location) satisfied++;

  // Work experience: prefer the explicit boolean flag if provided, otherwise
  // fall back to inspecting the array on the profile object.
  const workExpSatisfied =
    hasWorkExperience !== undefined
      ? hasWorkExperience
      : (profile.workExperiences ?? []).length >= 1;
  if (workExpSatisfied) satisfied++;

  // Skills: same pattern.
  const skillsSatisfied =
    hasSkills !== undefined ? hasSkills : (profile.skills ?? []).length >= 1;
  if (skillsSatisfied) satisfied++;

  if ((profile.workAuthorization ?? []).length >= 1) satisfied++;
  if ((profile.targetRoles ?? []).length >= 1) satisfied++;
  if ((profile.preferredLocations ?? []).length >= 1) satisfied++;

  return Math.round((satisfied / TOTAL_SECTIONS) * 100);
}
