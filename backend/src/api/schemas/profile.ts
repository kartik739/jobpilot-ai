import { z } from 'zod/v4';

// ─── Nested model schemas ─────────────────────────────────────────────────────

export const WorkExperienceSchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  isCurrent: z.boolean().optional().default(false),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional().default([]),
  skills: z.array(z.string()).optional().default([]),
});

export const EducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  field: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  gpa: z.number().optional(),
  description: z.string().optional(),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().optional(),
  repoUrl: z.string().optional(),
  skills: z.array(z.string()).optional().default([]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  isCurrent: z.boolean().optional().default(false),
  highlights: z.array(z.string()).optional().default([]),
});

export const SkillSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  proficiency: z.string().optional(),
  yearsOfExp: z.number().optional(),
});

export const CertificationSchema = z.object({
  name: z.string().min(1),
  issuer: z.string().optional(),
  issueDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  credentialId: z.string().optional(),
  credentialUrl: z.string().optional(),
});

// ─── Salary refinement ────────────────────────────────────────────────────────

function salaryMinLeMax(data: { salaryMin?: number; salaryMax?: number }): boolean {
  if (data.salaryMin !== undefined && data.salaryMax !== undefined) {
    return data.salaryMin <= data.salaryMax;
  }
  return true;
}

const SALARY_REFINE_ERROR = {
  message: 'salaryMin must be less than or equal to salaryMax',
  path: ['salaryMin'],
};

// ─── Core profile object (no refine, so .partial() works cleanly) ─────────────

const ProfileCoreObject = z.object({
  // Personal Information
  fullName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  location: z.string().min(1),

  linkedinUrl: z.string().optional(),
  githubUrl: z.string().optional(),
  portfolioUrl: z.string().optional(),
  websiteUrl: z.string().optional(),

  // Work Authorization
  workAuthorization: z.array(z.string()).min(1),
  requiresSponsorship: z.boolean().optional().default(false),
  noticePeriod: z.number().int().min(0),

  // Job Preferences
  remotePreference: z.string().optional().default('flexible'),
  targetRoles: z.array(z.string()).min(1),
  preferredLocations: z.array(z.string()).min(1),
  salaryMin: z.number().optional(),
  salaryMax: z.number().optional(),
  currency: z.string().optional().default('USD'),
  employmentTypes: z.array(z.string()).optional().default([]),
  excludedCompanies: z.array(z.string()).optional().default([]),
  preferredCompanies: z.array(z.string()).optional().default([]),
  targetIndustries: z.array(z.string()).optional().default([]),
  targetCompanySizes: z.array(z.string()).optional().default([]),
  dailyApplyLimit: z.number().int().min(1).optional().default(10),
  autoPauseEnabled: z.boolean().optional().default(true),
  coverLetterReviewMode: z.string().optional().default('auto'),

  portalCredentials: z.string().optional(),

  // Nested relations
  workExperiences: z.array(WorkExperienceSchema).optional().default([]),
  educations: z.array(EducationSchema).optional().default([]),
  projects: z.array(ProjectSchema).optional().default([]),
  skills: z.array(SkillSchema).optional().default([]),
  certifications: z.array(CertificationSchema).optional().default([]),
});

// ─── Request schemas ──────────────────────────────────────────────────────────

/** All required fields for creating a profile. */
export const CreateProfileRequest = ProfileCoreObject.refine(salaryMinLeMax, SALARY_REFINE_ERROR);
export type CreateProfileRequestType = z.infer<typeof CreateProfileRequest>;

/** Partial version of CreateProfileRequest — all fields optional for updates. */
export const UpdateProfileRequest = ProfileCoreObject.partial().refine(
  salaryMinLeMax,
  SALARY_REFINE_ERROR,
);
export type UpdateProfileRequestType = z.infer<typeof UpdateProfileRequest>;

// ─── Response schema ──────────────────────────────────────────────────────────

/** Full profile response shape including nested relations. */
export const ProfileResponse = z.object({
  id: z.string(),
  userId: z.string(),

  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  location: z.string(),

  linkedinUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),

  workAuthorization: z.array(z.string()),
  requiresSponsorship: z.boolean(),
  noticePeriod: z.number().int(),

  remotePreference: z.string(),
  targetRoles: z.array(z.string()),
  preferredLocations: z.array(z.string()),
  salaryMin: z.string().nullable(),
  salaryMax: z.string().nullable(),
  currency: z.string(),
  employmentTypes: z.array(z.string()),
  excludedCompanies: z.array(z.string()),
  preferredCompanies: z.array(z.string()),
  targetIndustries: z.array(z.string()),
  targetCompanySizes: z.array(z.string()),
  dailyApplyLimit: z.number().int(),
  autoPauseEnabled: z.boolean(),
  coverLetterReviewMode: z.string(),

  portalCredentials: z.string().nullable(),
  profileCompleteness: z.number().int(),

  createdAt: z.date(),
  updatedAt: z.date(),

  workExperiences: z.array(z.unknown()).optional(),
  educations: z.array(z.unknown()).optional(),
  projects: z.array(z.unknown()).optional(),
  skills: z.array(z.unknown()).optional(),
  certifications: z.array(z.unknown()).optional(),
});
export type ProfileResponseType = z.infer<typeof ProfileResponse>;
