import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { generatePresignedUrl } from '../../services/storage.js';
import { Prisma } from '@prisma/client';
import {
  CreateApplicationRequest,
  UpdateApplicationStatusRequest,
  ListApplicationsQuerySchema,
  FORWARD_ONLY_STATUSES,
  STATUS_ORDER,
  type ApplicationStatus,
} from '../schemas/applications.js';
import type { PrepQuestion } from '../../agents/interviewPrep.js';

// Prisma Json fields require a plain JSON-serializable value; cast via
// Prisma.InputJsonValue to satisfy the type checker.
const toJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if transitioning from `current` to `next` violates the
 * forward-only rule (req 18.4).
 *
 * A transition is illegal when:
 *   - The current status is one of the FORWARD_ONLY_STATUSES, AND
 *   - The target status appears earlier in STATUS_ORDER than the current status.
 */
function isBackwardTransition(current: ApplicationStatus, next: ApplicationStatus): boolean {
  if (!FORWARD_ONLY_STATUSES.includes(current)) {
    return false;
  }
  const currentIdx = STATUS_ORDER.indexOf(current);
  const nextIdx = STATUS_ORDER.indexOf(next);
  // next is earlier in the ordered list → backward
  return nextIdx < currentIdx;
}

// ─── Relations include clause ─────────────────────────────────────────────────

const INCLUDE_RELATIONS_FULL = {
  jobPosting: { select: { title: true, company: true } },
  resumeVersion: { select: { name: true, specialization: true } },
  transitions: { orderBy: { timestamp: 'asc' as const } },
} as const;

const INCLUDE_RELATIONS_LIST = {
  jobPosting: { select: { title: true, company: true } },
  resumeVersion: { select: { name: true, specialization: true } },
  transitions: { orderBy: { timestamp: 'asc' as const } },
} as const;

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/applications ─────────────────────────────────────────────────
  app.get(
    '/api/applications',
    { preHandler: authenticate },
    async (request, reply) => {
      const queryResult = ListApplicationsQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: queryResult.error.flatten(),
        });
      }

      const { status, page, pageSize } = queryResult.data;
      const skip = (page - 1) * pageSize;

      const where = {
        userId: request.user.id,
        ...(status ? { status } : {}),
      };

      const [total, applications] = await Promise.all([
        prisma.applicationRecord.count({ where }),
        prisma.applicationRecord.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { appliedAt: 'desc' },
          include: INCLUDE_RELATIONS_LIST,
        }),
      ]);

      return reply.send({
        data: applications,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    },
  );

  // ── GET /api/applications/:id ─────────────────────────────────────────────
  app.get(
    '/api/applications/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        include: INCLUDE_RELATIONS_FULL,
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      return reply.send(application);
    },
  );

  // ── POST /api/applications ────────────────────────────────────────────────
  app.post(
    '/api/applications',
    { preHandler: authenticate },
    async (request, reply) => {
      const result = CreateApplicationRequest.safeParse(request.body);
      if (!result.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: result.error.flatten(),
        });
      }

      const data = result.data;

      // Check fingerprint uniqueness per user
      const existing = await prisma.applicationRecord.findFirst({
        where: { userId: request.user.id, fingerprint: data.fingerprint },
        select: { id: true },
      });
      if (existing) {
        return reply.status(422).send({
          error: 'An application with this fingerprint already exists for this user',
        });
      }

      // matchScoreSnapshot is written once at creation (req 18.5)
      const application = await prisma.applicationRecord.create({
        data: {
          userId: request.user.id,
          jobPostingId: data.jobPostingId,
          appliedAt: new Date(data.appliedAt),
          source: data.source,
          applicationUrl: data.applicationUrl,
          resumeVersionId: data.resumeVersionId,
          coverLetterPath: data.coverLetterPath,
          status: data.status,
          automationSessionId: data.automationSessionId,
          screenshotPaths: data.screenshotPaths,
          confirmationNumber: data.confirmationNumber,
          formAnswersSnapshot: data.formAnswersSnapshot as object,
          fingerprint: data.fingerprint,
          notes: data.notes,
          // matchScoreSnapshot written once here — never updated by this API (req 18.5)
          matchScoreSnapshot: data.matchScoreSnapshot as object,
        },
        include: INCLUDE_RELATIONS_FULL,
      });

      return reply.status(201).send(application);
    },
  );

  // ── PATCH /api/applications/:id/status ───────────────────────────────────
  app.patch(
    '/api/applications/:id/status',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const result = UpdateApplicationStatusRequest.safeParse(request.body);
      if (!result.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          details: result.error.flatten(),
        });
      }

      const { status: newStatus, triggeredBy, note } = result.data;

      try {
        const updated = await prisma.$transaction(async (tx) => {
          // (a) Read current status
          const current = await tx.applicationRecord.findFirst({
            where: { id, userId: request.user.id },
            select: { id: true, status: true, matchScoreSnapshot: true },
          });

          if (!current) {
            // Signal not-found inside transaction via thrown error
            const err = new Error('NOT_FOUND');
            throw err;
          }

          const currentStatus = current.status as ApplicationStatus;

          // (b) Validate the transition is not backward (req 18.4)
          if (isBackwardTransition(currentStatus, newStatus)) {
            const err = new Error('BACKWARD_TRANSITION');
            throw err;
          }

          // No-op if status is the same — still record a transition for audit trail
          // (allow callers to force a note without changing status)
          // Actually, skip creating a transition record if status is unchanged
          if (currentStatus === newStatus) {
            return await tx.applicationRecord.findFirst({
              where: { id },
              include: INCLUDE_RELATIONS_FULL,
            });
          }

          // (c) Update ApplicationRecord status
          // NOTE: matchScoreSnapshot is NOT touched here (req 18.5)
          await tx.applicationRecord.update({
            where: { id },
            data: { status: newStatus },
          });

          // (d) Insert immutable StatusTransition record (req 18.3)
          await tx.statusTransition.create({
            data: {
              applicationRecordId: id,
              from: currentStatus,
              to: newStatus,
              triggeredBy: triggeredBy ?? 'user',
              timestamp: new Date(),
              note: note ?? null,
            },
          });

          // Return the updated record with relations
          return await tx.applicationRecord.findFirst({
            where: { id },
            include: INCLUDE_RELATIONS_FULL,
          });
        });

        return reply.send(updated);
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === 'NOT_FOUND') {
            return reply.status(404).send({ error: 'Application not found' });
          }
          if (err.message === 'BACKWARD_TRANSITION') {
            return reply.status(422).send({
              error:
                `Cannot revert to an earlier status. ` +
                'This application has reached a stage from which backward transitions are not permitted.',
            });
          }
        }
        throw err;
      }
    },
  );

  // ── GET /api/applications/:id/screenshot-url ──────────────────────────────
  app.get(
    '/api/applications/:id/screenshot-url',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { key } = request.query as { key?: string };

      if (!key || key.trim() === '') {
        return reply.status(422).send({ error: 'Query param "key" is required' });
      }

      // Verify the application belongs to the requesting user and the key is in screenshotPaths
      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true, screenshotPaths: true },
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      if (!application.screenshotPaths.includes(key)) {
        return reply.status(403).send({ error: 'Screenshot key not associated with this application' });
      }

      try {
        const url = await generatePresignedUrl(key);
        return reply.send({ url });
      } catch {
        return reply.status(500).send({ error: 'Failed to generate pre-signed URL' });
      }
    },
  );

  // ── PATCH /api/applications/:id/notes ─────────────────────────────────────
  app.patch(
    '/api/applications/:id/notes',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { notes?: unknown };

      if (typeof body.notes !== 'string') {
        return reply.status(422).send({ error: 'Body must contain a "notes" string field' });
      }

      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true },
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      const updated = await prisma.applicationRecord.update({
        where: { id },
        data: { notes: body.notes },
        include: INCLUDE_RELATIONS_FULL,
      });

      return reply.send(updated);
    },
  );

  // ── GET /api/applications/:id/interview-prep ──────────────────────────────
  // Returns the stored InterviewPrepSheet for an application (req 19.3).
  // Returns 404 if not yet generated (caller should trigger generation first).
  app.get(
    '/api/applications/:id/interview-prep',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Verify application ownership
      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true },
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      const sheet = await prisma.interviewPrepSheet.findUnique({
        where: { applicationId: id },
      });

      if (!sheet) {
        return reply.status(404).send({ error: 'Interview prep sheet not yet generated for this application' });
      }

      return reply.send(sheet);
    },
  );

  // ── POST /api/applications/:id/interview-prep/questions ──────────────────
  // Adds a custom question to the interview prep sheet (req 19.3).
  // Body: { question: string; category?: 'behavioral' | 'technical' | 'culture' | 'system-design'; note?: string }
  app.post(
    '/api/applications/:id/interview-prep/questions',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        question?: unknown;
        category?: unknown;
        note?: unknown;
      };

      if (typeof body.question !== 'string' || body.question.trim() === '') {
        return reply.status(422).send({ error: 'Body must contain a non-empty "question" string field' });
      }

      const validCategories = ['behavioral', 'technical', 'culture', 'system-design'];
      const category: PrepQuestion['category'] =
        typeof body.category === 'string' && validCategories.includes(body.category)
          ? (body.category as PrepQuestion['category'])
          : 'technical';

      const note = typeof body.note === 'string' ? body.note : undefined;

      // Verify application ownership
      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true },
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      // Get or create a prep sheet record
      const existing = await prisma.interviewPrepSheet.findUnique({
        where: { applicationId: id },
      });

      const newQuestion: PrepQuestion & { note?: string } = {
        question: body.question.trim(),
        category,
        ...(note !== undefined ? { note } : {}),
      };

      if (!existing) {
        // Create a minimal sheet to hold the custom question
        const sheet = await prisma.interviewPrepSheet.create({
          data: {
            applicationId: id,
            behavioralQuestions: toJson(category === 'behavioral' ? [newQuestion] : []),
            technicalQuestions: toJson(category !== 'behavioral' ? [newQuestion] : []),
            companySummary: '',
            roleSpecificTips: toJson([]),
            generatedAt: new Date(),
          },
        });
        return reply.status(201).send(sheet);
      }

      // Append to the appropriate array
      const behavioralQuestions = (existing.behavioralQuestions as unknown) as Array<PrepQuestion & { note?: string }>;
      const technicalQuestions = (existing.technicalQuestions as unknown) as Array<PrepQuestion & { note?: string }>;

      if (category === 'behavioral') {
        behavioralQuestions.push(newQuestion);
      } else {
        technicalQuestions.push(newQuestion);
      }

      const updated = await prisma.interviewPrepSheet.update({
        where: { applicationId: id },
        data: {
          behavioralQuestions: toJson(behavioralQuestions),
          technicalQuestions: toJson(technicalQuestions),
        },
      });

      return reply.status(201).send(updated);
    },
  );

  // ── PATCH /api/applications/:id/interview-prep/questions/:index/note ─────
  // Updates the note on a specific question by index + category (req 19.3).
  // Body: { category: 'behavioral' | 'technical'; note: string }
  app.patch(
    '/api/applications/:id/interview-prep/questions/:index/note',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id, index: indexStr } = request.params as { id: string; index: string };
      const body = request.body as { category?: unknown; note?: unknown };

      const index = parseInt(indexStr, 10);
      if (Number.isNaN(index) || index < 0) {
        return reply.status(422).send({ error: 'Invalid question index' });
      }

      if (typeof body.note !== 'string') {
        return reply.status(422).send({ error: 'Body must contain a "note" string field' });
      }

      const validCategories = ['behavioral', 'technical', 'culture', 'system-design'];
      if (typeof body.category !== 'string' || !validCategories.includes(body.category)) {
        return reply.status(422).send({ error: 'Body must contain a valid "category" field' });
      }

      const isBehavioral = body.category === 'behavioral';

      // Verify application ownership
      const application = await prisma.applicationRecord.findFirst({
        where: { id, userId: request.user.id },
        select: { id: true },
      });

      if (!application) {
        return reply.status(404).send({ error: 'Application not found' });
      }

      const sheet = await prisma.interviewPrepSheet.findUnique({
        where: { applicationId: id },
      });

      if (!sheet) {
        return reply.status(404).send({ error: 'Interview prep sheet not found' });
      }

      const behavioralQuestions = (sheet.behavioralQuestions as unknown) as Array<PrepQuestion & { note?: string }>;
      const technicalQuestions = (sheet.technicalQuestions as unknown) as Array<PrepQuestion & { note?: string }>;
      const targetArray = isBehavioral ? behavioralQuestions : technicalQuestions;

      if (index >= targetArray.length) {
        return reply.status(404).send({ error: 'Question index out of range' });
      }

      targetArray[index] = { ...targetArray[index]!, note: body.note };

      const updated = await prisma.interviewPrepSheet.update({
        where: { applicationId: id },
        data: isBehavioral
          ? { behavioralQuestions: toJson(behavioralQuestions) }
          : { technicalQuestions: toJson(technicalQuestions) },
      });

      return reply.send(updated);
    },
  );
}
