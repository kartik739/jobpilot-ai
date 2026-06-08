import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { generatePresignedUrl } from '../../services/storage.js';
import {
  CreateApplicationRequest,
  UpdateApplicationStatusRequest,
  ListApplicationsQuerySchema,
  FORWARD_ONLY_STATUSES,
  STATUS_ORDER,
  type ApplicationStatus,
} from '../schemas/applications.js';

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
}
