import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import {
  CreateProfileRequest,
  UpdateProfileRequest,
  type CreateProfileRequestType,
  WorkExperienceSchema,
  EducationSchema,
  ProjectSchema,
  SkillSchema,
  CertificationSchema,
} from '../schemas/profile.js';

// ─── Nested input types ───────────────────────────────────────────────────────

type WorkExperienceInput = z.infer<typeof WorkExperienceSchema>;
type EducationInput = z.infer<typeof EducationSchema>;
type ProjectInput = z.infer<typeof ProjectSchema>;
type SkillInput = z.infer<typeof SkillSchema>;
type CertificationInput = z.infer<typeof CertificationSchema>;

// ─── Nested create mappers ────────────────────────────────────────────────────

function mapWorkExperience(we: WorkExperienceInput) {
  return {
    company: we.company,
    title: we.title,
    location: we.location,
    startDate: new Date(we.startDate),
    endDate: we.endDate ? new Date(we.endDate) : undefined,
    isCurrent: we.isCurrent,
    description: we.description,
    bullets: we.bullets,
    skills: we.skills,
  };
}

function mapEducation(ed: EducationInput) {
  return {
    institution: ed.institution,
    degree: ed.degree,
    field: ed.field,
    startDate: new Date(ed.startDate),
    endDate: ed.endDate ? new Date(ed.endDate) : undefined,
    gpa: ed.gpa,
    description: ed.description,
  };
}

function mapProject(pr: ProjectInput) {
  return {
    name: pr.name,
    description: pr.description,
    url: pr.url,
    repoUrl: pr.repoUrl,
    skills: pr.skills,
    startDate: pr.startDate ? new Date(pr.startDate) : undefined,
    endDate: pr.endDate ? new Date(pr.endDate) : undefined,
    isCurrent: pr.isCurrent,
    highlights: pr.highlights,
  };
}

function mapSkill(sk: SkillInput) {
  return {
    name: sk.name,
    category: sk.category,
    proficiency: sk.proficiency,
    yearsOfExp: sk.yearsOfExp,
  };
}

function mapCertification(ce: CertificationInput) {
  return {
    name: ce.name,
    issuer: ce.issuer,
    issueDate: ce.issueDate ? new Date(ce.issueDate) : undefined,
    expiryDate: ce.expiryDate ? new Date(ce.expiryDate) : undefined,
    credentialId: ce.credentialId,
    credentialUrl: ce.credentialUrl,
  };
}

// ─── Completeness helper ──────────────────────────────────────────────────────

/**
 * Compute a profile completeness score (0–100) based on how many of the 9
 * required sections are satisfied.
 *
 * Sections:
 *  1. fullName present
 *  2. email present
 *  3. phone present
 *  4. location present
 *  5. at least one workExperience
 *  6. at least one skill
 *  7. workAuthorization non-empty
 *  8. targetRoles non-empty
 *  9. preferredLocations non-empty
 */
function computeCompleteness(data: {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  workExperiences?: unknown[];
  skills?: unknown[];
  workAuthorization?: string[];
  targetRoles?: string[];
  preferredLocations?: string[];
}): number {
  const TOTAL = 9;
  let satisfied = 0;

  if (data.fullName) satisfied++;
  if (data.email) satisfied++;
  if (data.phone) satisfied++;
  if (data.location) satisfied++;
  if ((data.workExperiences ?? []).length >= 1) satisfied++;
  if ((data.skills ?? []).length >= 1) satisfied++;
  if ((data.workAuthorization ?? []).length >= 1) satisfied++;
  if ((data.targetRoles ?? []).length >= 1) satisfied++;
  if ((data.preferredLocations ?? []).length >= 1) satisfied++;

  return Math.round((satisfied / TOTAL) * 100);
}

// ─── Relations include clause ─────────────────────────────────────────────────

const INCLUDE_RELATIONS = {
  workExperiences: true,
  educations: true,
  projects: true,
  skills: true,
  certifications: true,
} as const;

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/profile ──────────────────────────────────────────────────────
  app.get(
    '/api/profile',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const profile = await prisma.profile.findUnique({
          where: { userId: request.user.id },
          include: INCLUDE_RELATIONS,
        });

        if (!profile) {
          return reply.status(404).send({ error: 'Profile not found' });
        }

        return reply.send(profile);
      } catch (err) {
        // Catch decryption errors surfaced by the encryption middleware
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'Decryption failed') {
          request.log.error({ err }, 'Decryption error when fetching profile');
          return reply.status(500).send({ error: 'Failed to read profile data' });
        }
        throw err;
      }
    },
  );

  // ── POST /api/profile ─────────────────────────────────────────────────────
  app.post(
    '/api/profile',
    { preHandler: authenticate },
    async (request, reply) => {
      // Validate request body
      const result = CreateProfileRequest.safeParse(request.body);
      if (!result.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: result.error.flatten(),
        });
      }

      const data = result.data;

      // Check for duplicate email (another profile with the same email)
      const existingEmail = await prisma.profile.findFirst({
        where: {
          email: data.email,
          NOT: { userId: request.user.id },
        },
        select: { id: true },
      });
      if (existingEmail) {
        return reply.status(422).send({ error: 'Email is already in use by another profile' });
      }

      // Destructure nested arrays from flat scalar fields
      const {
        workExperiences,
        educations,
        projects,
        skills,
        certifications,
        salaryMin,
        salaryMax,
        ...coreFields
      } = data;

      // Convert numeric salary to string for encrypted storage
      const salaryMinStr = salaryMin !== undefined ? String(salaryMin) : undefined;
      const salaryMaxStr = salaryMax !== undefined ? String(salaryMax) : undefined;

      // Compute completeness
      const profileCompleteness = computeCompleteness({
        ...coreFields,
        workExperiences,
        skills,
      });

      const profile = await prisma.profile.create({
        data: {
          userId: request.user.id,
          ...coreFields,
          salaryMin: salaryMinStr,
          salaryMax: salaryMaxStr,
          profileCompleteness,
          workExperiences: { create: workExperiences.map(mapWorkExperience) },
          educations: { create: educations.map(mapEducation) },
          projects: { create: projects.map(mapProject) },
          skills: { create: skills.map(mapSkill) },
          certifications: { create: certifications.map(mapCertification) },
        },
        include: INCLUDE_RELATIONS,
      });

      return reply.status(201).send(profile);
    },
  );

  // ── PUT /api/profile ──────────────────────────────────────────────────────
  app.put(
    '/api/profile',
    { preHandler: authenticate },
    async (request, reply) => {
      // Validate request body
      const result = UpdateProfileRequest.safeParse(request.body);
      if (!result.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: result.error.flatten(),
        });
      }

      const data = result.data;

      // Destructure nested arrays (may be undefined for partial updates)
      const {
        workExperiences,
        educations,
        projects,
        skills,
        certifications,
        salaryMin,
        salaryMax,
        ...coreFields
      } = data;

      // Convert numeric salary to string if provided
      const salaryMinStr = salaryMin !== undefined ? String(salaryMin) : undefined;
      const salaryMaxStr = salaryMax !== undefined ? String(salaryMax) : undefined;

      // Fetch existing profile to merge completeness computation
      const existing = await prisma.profile.findUnique({
        where: { userId: request.user.id },
        include: INCLUDE_RELATIONS,
      });

      // Merge incoming data with existing for completeness calculation
      const merged = {
        fullName: coreFields.fullName ?? existing?.fullName,
        email: coreFields.email ?? existing?.email,
        phone: coreFields.phone ?? existing?.phone,
        location: coreFields.location ?? existing?.location,
        workExperiences: workExperiences ?? (existing?.workExperiences as unknown[]) ?? [],
        skills: skills ?? (existing?.skills as unknown[]) ?? [],
        workAuthorization: coreFields.workAuthorization ?? existing?.workAuthorization ?? [],
        targetRoles: coreFields.targetRoles ?? existing?.targetRoles ?? [],
        preferredLocations: coreFields.preferredLocations ?? existing?.preferredLocations ?? [],
      };

      const profileCompleteness = computeCompleteness(merged);

      // Build scalar update payload
      const scalarData: Record<string, unknown> = {
        ...coreFields,
        profileCompleteness,
      };
      if (salaryMinStr !== undefined) scalarData['salaryMin'] = salaryMinStr;
      if (salaryMaxStr !== undefined) scalarData['salaryMax'] = salaryMaxStr;

      if (existing) {
        // Profile exists — update scalars and replace nested arrays if provided
        const updated = await prisma.profile.update({
          where: { userId: request.user.id },
          data: {
            ...scalarData,
            ...(workExperiences !== undefined && {
              workExperiences: { deleteMany: {}, create: workExperiences.map(mapWorkExperience) },
            }),
            ...(educations !== undefined && {
              educations: { deleteMany: {}, create: educations.map(mapEducation) },
            }),
            ...(projects !== undefined && {
              projects: { deleteMany: {}, create: projects.map(mapProject) },
            }),
            ...(skills !== undefined && {
              skills: { deleteMany: {}, create: skills.map(mapSkill) },
            }),
            ...(certifications !== undefined && {
              certifications: { deleteMany: {}, create: certifications.map(mapCertification) },
            }),
          },
          include: INCLUDE_RELATIONS,
        });
        return reply.status(200).send(updated);
      } else {
        // Profile doesn't exist — create it (upsert semantics for PUT)
        const createData: CreateProfileRequestType = {
          fullName: (coreFields.fullName as string) ?? '',
          email: (coreFields.email as string) ?? '',
          phone: coreFields.phone,
          location: (coreFields.location as string) ?? '',
          linkedinUrl: coreFields.linkedinUrl,
          githubUrl: coreFields.githubUrl,
          portfolioUrl: coreFields.portfolioUrl,
          websiteUrl: coreFields.websiteUrl,
          workAuthorization: (coreFields.workAuthorization as string[]) ?? [],
          requiresSponsorship: coreFields.requiresSponsorship ?? false,
          noticePeriod: (coreFields.noticePeriod as number) ?? 0,
          remotePreference: coreFields.remotePreference ?? 'flexible',
          targetRoles: (coreFields.targetRoles as string[]) ?? [],
          preferredLocations: (coreFields.preferredLocations as string[]) ?? [],
          salaryMin,
          salaryMax,
          currency: coreFields.currency ?? 'USD',
          employmentTypes: (coreFields.employmentTypes as string[]) ?? [],
          excludedCompanies: (coreFields.excludedCompanies as string[]) ?? [],
          preferredCompanies: (coreFields.preferredCompanies as string[]) ?? [],
          targetIndustries: (coreFields.targetIndustries as string[]) ?? [],
          targetCompanySizes: (coreFields.targetCompanySizes as string[]) ?? [],
          dailyApplyLimit: coreFields.dailyApplyLimit ?? 10,
          autoPauseEnabled: coreFields.autoPauseEnabled ?? true,
          coverLetterReviewMode: coreFields.coverLetterReviewMode ?? 'auto',
          portalCredentials: coreFields.portalCredentials,
          workExperiences: workExperiences ?? [],
          educations: educations ?? [],
          projects: projects ?? [],
          skills: skills ?? [],
          certifications: certifications ?? [],
        };

        const created = await prisma.profile.create({
          data: {
            userId: request.user.id,
            fullName: createData.fullName,
            email: createData.email,
            phone: createData.phone,
            location: createData.location,
            linkedinUrl: createData.linkedinUrl,
            githubUrl: createData.githubUrl,
            portfolioUrl: createData.portfolioUrl,
            websiteUrl: createData.websiteUrl,
            workAuthorization: createData.workAuthorization,
            requiresSponsorship: createData.requiresSponsorship,
            noticePeriod: createData.noticePeriod,
            remotePreference: createData.remotePreference,
            targetRoles: createData.targetRoles,
            preferredLocations: createData.preferredLocations,
            salaryMin: salaryMinStr,
            salaryMax: salaryMaxStr,
            currency: createData.currency,
            employmentTypes: createData.employmentTypes,
            excludedCompanies: createData.excludedCompanies,
            preferredCompanies: createData.preferredCompanies,
            targetIndustries: createData.targetIndustries,
            targetCompanySizes: createData.targetCompanySizes,
            dailyApplyLimit: createData.dailyApplyLimit,
            autoPauseEnabled: createData.autoPauseEnabled,
            coverLetterReviewMode: createData.coverLetterReviewMode,
            portalCredentials: createData.portalCredentials,
            profileCompleteness,
            workExperiences: { create: createData.workExperiences.map(mapWorkExperience) },
            educations: { create: createData.educations.map(mapEducation) },
            projects: { create: createData.projects.map(mapProject) },
            skills: { create: createData.skills.map(mapSkill) },
            certifications: { create: createData.certifications.map(mapCertification) },
          },
          include: INCLUDE_RELATIONS,
        });
        return reply.status(200).send(created);
      }
    },
  );
}
