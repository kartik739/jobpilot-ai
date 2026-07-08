/**
 * Data export route — GET /api/user/export
 *
 * Streams a ZIP archive containing:
 *  1. profile.json           — full user profile with relations
 *  2. applications.csv       — all ApplicationRecord rows
 *  3. resumes/<filename>     — all ResumeVersion files from SeaweedFS
 *  4. cover-letters/<name>   — cover letter files where coverLetterPath is set
 *  5. screenshots/<name>     — screenshot files for each application
 *
 * Requirements: 25.1, 25.2
 */

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ZipArchive } from 'archiver';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { downloadFile } from '../../services/storage.js';
import { logger } from '../../core/logger.js';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'id',
  'jobPostingId',
  'appliedAt',
  'source',
  'applicationUrl',
  'resumeVersionId',
  'status',
  'fingerprint',
  'confirmationNumber',
  'notes',
  'createdAt',
  'updatedAt',
] as const;

type CsvRow = Record<(typeof CSV_COLUMNS)[number], unknown>;

function escapeCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function buildCsv(rows: CsvRow[]): string {
  const header = CSV_COLUMNS.join(',');
  const dataRows = rows.map((row) =>
    CSV_COLUMNS.map((col) => escapeCell(row[col])).join(','),
  );
  return [header, ...dataRows].join('\n');
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/user/export',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const log = logger.child({ fn: 'exportRoutes', userId });

      // ── Set streaming response headers ──────────────────────────────────
      reply.raw.setHeader('Content-Type', 'application/zip');
      reply.raw.setHeader(
        'Content-Disposition',
        'attachment; filename="jobpilot-export.zip"',
      );

      // Prevent Fastify from serialising the response
      await reply.hijack();

      // ── Fetch all data from the DB ───────────────────────────────────────
      const [profile, applications, resumeVersions] = await Promise.all([
        prisma.profile.findUnique({
          where: { userId },
          include: {
            workExperiences: true,
            educations: true,
            projects: true,
            skills: true,
            certifications: true,
          },
        }),
        prisma.applicationRecord.findMany({
          where: { userId },
          select: {
            id: true,
            jobPostingId: true,
            appliedAt: true,
            source: true,
            applicationUrl: true,
            resumeVersionId: true,
            status: true,
            fingerprint: true,
            confirmationNumber: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
            coverLetterPath: true,
            screenshotPaths: true,
          },
        }),
        prisma.resumeVersion.findMany({ where: { userId } }),
      ]);

      // ── Create archive and pipe to response ──────────────────────────────
      const archive = new ZipArchive({ zlib: { level: 6 } });

      archive.on('error', (err: Error) => {
        log.error({ err }, 'Archive error during export');
        // Cannot send an HTTP error at this point — the headers are already sent.
        // End the response to avoid a hanging connection.
        reply.raw.end();
      });

      archive.pipe(reply.raw);

      // 1. profile.json
      const profileJson = JSON.stringify(profile ?? {}, null, 2);
      archive.append(Buffer.from(profileJson, 'utf8'), { name: 'profile.json' });

      // 2. applications.csv
      const csvRows: CsvRow[] = applications.map((a) => ({
        id: a.id,
        jobPostingId: a.jobPostingId,
        appliedAt: a.appliedAt.toISOString(),
        source: a.source,
        applicationUrl: a.applicationUrl,
        resumeVersionId: a.resumeVersionId,
        status: a.status,
        fingerprint: a.fingerprint,
        confirmationNumber: a.confirmationNumber ?? '',
        notes: a.notes,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      }));
      archive.append(Buffer.from(buildCsv(csvRows), 'utf8'), {
        name: 'applications.csv',
      });

      // 3. Resume files
      for (const resume of resumeVersions) {
        const filename = path.basename(resume.fileUrl);
        try {
          const buf = await downloadFile(resume.fileUrl);
          archive.append(buf, { name: `resumes/${filename}` });
        } catch (err) {
          log.error(
            { err, fileUrl: resume.fileUrl },
            'Failed to download resume file — skipping',
          );
        }
      }

      // 4. Cover letter files
      for (const app of applications) {
        if (!app.coverLetterPath) continue;
        const filename = path.basename(app.coverLetterPath);
        try {
          const buf = await downloadFile(app.coverLetterPath);
          archive.append(buf, { name: `cover-letters/${filename}` });
        } catch (err) {
          log.error(
            { err, coverLetterPath: app.coverLetterPath },
            'Failed to download cover letter — skipping',
          );
        }
      }

      // 5. Screenshot files
      for (const app of applications) {
        for (const screenshotPath of app.screenshotPaths) {
          const filename = path.basename(screenshotPath);
          try {
            const buf = await downloadFile(screenshotPath);
            archive.append(buf, { name: `screenshots/${filename}` });
          } catch (err) {
            log.error(
              { err, screenshotPath },
              'Failed to download screenshot — skipping',
            );
          }
        }
      }

      await archive.finalize();
    },
  );
}
