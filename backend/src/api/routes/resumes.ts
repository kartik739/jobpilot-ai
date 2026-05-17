import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { uploadFile, deleteFile, generatePresignedUrl } from '../../services/storage.js';
import { logger } from '../../core/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SPECIALIZATIONS = [
  'backend',
  'frontend',
  'fullstack',
  'devops',
  'cloud',
  'ai_ml',
  'mobile',
  'data',
  'general',
] as const;

type Specialization = (typeof VALID_SPECIALIZATIONS)[number];

function isValidSpecialization(value: unknown): value is Specialization {
  return typeof value === 'string' && (VALID_SPECIALIZATIONS as readonly string[]).includes(value);
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function resumeRoutes(app: FastifyInstance): Promise<void> {
  // Register @fastify/multipart scoped to this plugin only
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB max
      files: 1,
    },
  });

  // ── POST /api/profile/resumes ─────────────────────────────────────────────
  app.post(
    '/api/profile/resumes',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;

      // Collect all multipart parts
      const parts = request.parts();

      let fileBuffer: Buffer | null = null;
      let fileName = 'resume.pdf';
      let fileContentType = 'application/pdf';
      let name: string | null = null;
      let specialization: string | null = null;
      let isDefault = false;

      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          fileBuffer = Buffer.concat(chunks);
          fileName = part.filename ?? 'resume.pdf';
          fileContentType = part.mimetype ?? 'application/pdf';
        } else {
          // field
          const value = part.value as string;
          if (part.fieldname === 'name') {
            name = value;
          } else if (part.fieldname === 'specialization') {
            specialization = value;
          } else if (part.fieldname === 'isDefault') {
            isDefault = value === 'true' || value === '1';
          }
        }
      }

      // Validate required fields
      if (!fileBuffer || fileBuffer.length === 0) {
        return reply.status(422).send({ error: 'File is required' });
      }
      if (!name || name.trim() === '') {
        return reply.status(422).send({ error: 'name is required' });
      }
      if (!specialization) {
        return reply.status(422).send({ error: 'specialization is required' });
      }
      if (!isValidSpecialization(specialization)) {
        return reply.status(422).send({
          error: 'Invalid specialization',
          validValues: VALID_SPECIALIZATIONS,
        });
      }

      // Compute SHA-256 of the file buffer
      const fileHash = createHash('sha256').update(fileBuffer).digest('hex');

      // Determine file extension from original filename, default to .pdf
      const ext = path.extname(fileName) || '.pdf';
      const storageKey = `resumes/${userId}/${fileHash}${ext}`;

      // Upload to SeaweedFS
      await uploadFile(storageKey, fileBuffer, fileContentType);

      // Persist in DB — if isDefault, clear other defaults first (in a transaction)
      const resume = await prisma.$transaction(async (tx) => {
        if (isDefault) {
          await tx.resumeVersion.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return tx.resumeVersion.create({
          data: {
            userId,
            name: name!,
            specialization,
            fileUrl: storageKey,
            fileHash,
            isDefault,
          },
        });
      });

      return reply.status(201).send(resume);
    },
  );

  // ── GET /api/profile/resumes ──────────────────────────────────────────────
  app.get(
    '/api/profile/resumes',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;

      const resumes = await prisma.resumeVersion.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      return reply.status(200).send(resumes);
    },
  );

  // ── PUT /api/profile/resumes/:id ──────────────────────────────────────────
  app.put(
    '/api/profile/resumes/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        specialization?: string;
        isDefault?: boolean;
      };

      // Validate specialization if provided
      if (body.specialization !== undefined && !isValidSpecialization(body.specialization)) {
        return reply.status(422).send({
          error: 'Invalid specialization',
          validValues: VALID_SPECIALIZATIONS,
        });
      }

      // Verify the record exists and belongs to this user
      const existing = await prisma.resumeVersion.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return reply.status(404).send({ error: 'Resume not found' });
      }

      // Build update — if isDefault=true, clear other defaults in a transaction
      const updated = await prisma.$transaction(async (tx) => {
        if (body.isDefault === true) {
          await tx.resumeVersion.updateMany({
            where: { userId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }

        return tx.resumeVersion.update({
          where: { id },
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.specialization !== undefined && { specialization: body.specialization }),
            ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          },
        });
      });

      return reply.status(200).send(updated);
    },
  );

  // ── DELETE /api/profile/resumes/:id ──────────────────────────────────────
  app.delete(
    '/api/profile/resumes/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params as { id: string };

      // Verify the record exists and belongs to this user
      const existing = await prisma.resumeVersion.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) {
        return reply.status(404).send({ error: 'Resume not found' });
      }

      // Delete DB record first
      await prisma.resumeVersion.delete({ where: { id } });

      // Best-effort: delete file from SeaweedFS; log error but don't fail the request
      try {
        await deleteFile(existing.fileUrl);
      } catch (err) {
        logger.error({ err, key: existing.fileUrl }, 'Failed to delete resume file from storage');
      }

      return reply.status(204).send();
    },
  );

  // ── GET /api/profile/resumes/:id/download ─────────────────────────────────
  // Returns a pre-signed URL (valid 15 min) for the resume file.
  // Requirements: 24.5
  app.get(
    '/api/profile/resumes/:id/download',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params as { id: string };

      const resume = await prisma.resumeVersion.findUnique({ where: { id } });
      if (!resume || resume.userId !== userId) {
        return reply.status(404).send({ error: 'Resume not found' });
      }

      try {
        const url = await generatePresignedUrl(resume.fileUrl);
        return reply.status(200).send({ url });
      } catch (err) {
        logger.error({ err, key: resume.fileUrl }, 'Failed to generate pre-signed download URL');
        return reply.status(500).send({ error: 'Failed to generate download URL' });
      }
    },
  );
}
