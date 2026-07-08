/**
 * Property-based tests for the Data Export endpoint
 *
 * **Property 22: Data Export Completeness**
 * **Validates: Requirements 25.1, 25.2**
 *
 * Property: for any set of profile data, application records (with optional
 * coverLetterPaths and screenshotPaths), and resume versions, the ZIP produced
 * by GET /api/user/export must contain exactly the expected set of entries:
 *   - profile.json
 *   - applications.csv
 *   - one resumes/<filename> entry per ResumeVersion
 *   - one cover-letters/<basename> entry per ApplicationRecord with coverLetterPath
 *   - one screenshots/<basename> entry per screenshotPath across all applications
 */

import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';

// ─── Stub db.js before any route imports ─────────────────────────────────────
vi.mock('../../db.js', () => ({ prisma: {} }));
vi.mock('../../core/logger.js', () => ({
  logger: {
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse all entry names from a ZIP central directory.
 *
 * The ZIP central directory is located near the end of the archive.
 * Each record starts with the signature 0x02014b50 (PK\x01\x02).
 * The filename is stored at a fixed offset from the signature:
 *   - 28 bytes of fixed fields
 *   - 2 bytes: filename length (little-endian at offset 28)
 *   - filename follows at offset 46
 */
function parseZipEntryNames(buf: Buffer): string[] {
  const SIG = Buffer.from([0x50, 0x4b, 0x01, 0x02]); // PK\x01\x02
  const names: string[] = [];
  let pos = 0;

  while (pos < buf.length - 4) {
    // Scan for central directory signature
    const idx = buf.indexOf(SIG, pos);
    if (idx === -1) break;

    // filename length is at offset 28 from the signature
    if (idx + 46 > buf.length) break;
    const filenameLen = buf.readUInt16LE(idx + 28);
    const filenameStart = idx + 46;
    const filenameEnd = filenameStart + filenameLen;
    if (filenameEnd > buf.length) break;

    const name = buf.toString('utf8', filenameStart, filenameEnd);
    names.push(name);

    pos = idx + 46 + filenameLen;
  }

  return names;
}

/**
 * Build a minimal Fastify test instance with the export route registered.
 * Prisma and downloadFile are provided as mock implementations.
 */
async function buildTestApp(mocks: {
  prismaProfile: unknown;
  prismaApplications: ApplicationMock[];
  prismaResumeVersions: ResumeVersionMock[];
  downloadFile: (key: string) => Promise<Buffer>;
}): Promise<FastifyInstance> {
  // Re-mock prisma for each test scenario
  const { prisma } = await import('../../db.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as unknown as Record<string, unknown>;
  p['profile'] = {
    findUnique: vi.fn().mockResolvedValue(mocks.prismaProfile),
  };
  p['applicationRecord'] = {
    findMany: vi.fn().mockResolvedValue(mocks.prismaApplications),
  };
  p['resumeVersion'] = {
    findMany: vi.fn().mockResolvedValue(mocks.prismaResumeVersions),
  };

  // Re-mock the storage service's downloadFile
  vi.doMock('../../services/storage.js', () => ({
    downloadFile: mocks.downloadFile,
  }));

  const app = Fastify({ logger: false });

  // Register JWT so authenticate preHandler can verify tokens
  await app.register(jwt, {
    secret: 'test-secret',
  });

  // Import and register the export route fresh (bypasses module cache mock)
  const { exportRoutes } = await import('./export.js');
  await app.register(exportRoutes);

  await app.ready();
  return app;
}

/** Sign a JWT for a mock user so authenticate() passes */
function signToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ id: userId, email: 'test@example.com' });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApplicationMock {
  id: string;
  jobPostingId: string;
  appliedAt: Date;
  source: string;
  applicationUrl: string;
  resumeVersionId: string;
  status: string;
  fingerprint: string;
  confirmationNumber: string | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  coverLetterPath: string | null;
  screenshotPaths: string[];
}

interface ResumeVersionMock {
  id: string;
  userId: string;
  fileUrl: string;
  name: string;
  specialization: string;
  fileHash: string;
  isDefault: boolean;
  usageCount: number;
  successCount: number;
  lastUsedAt: Date | null;
  successRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const safeFilenameArb = fc
  .stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)
  .map((s) => `${s}.pdf`);

const resumeVersionArb = (userId: string): fc.Arbitrary<ResumeVersionMock> =>
  safeFilenameArb.map((filename) => ({
    id: `rv-${filename}`,
    userId,
    fileUrl: `resumes/${userId}/${filename}`,
    name: `Resume ${filename}`,
    specialization: 'general',
    fileHash: 'abc',
    isDefault: false,
    usageCount: 0,
    successCount: 0,
    lastUsedAt: null,
    successRate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

const applicationArb = (userId: string): fc.Arbitrary<ApplicationMock> =>
  fc.tuple(
    safeFilenameArb,
    fc.option(safeFilenameArb, { nil: null }),
    fc.array(safeFilenameArb, { minLength: 0, maxLength: 3 }),
  ).map(([id, coverLetter, screenshots]) => ({
    id: `app-${id}`,
    jobPostingId: `jp-${id}`,
    appliedAt: new Date(),
    source: 'manual',
    applicationUrl: 'https://example.com',
    resumeVersionId: `rv-${id}`,
    status: 'submitted',
    fingerprint: id,
    confirmationNumber: null,
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    coverLetterPath: coverLetter ? `cover-letters/${userId}/${coverLetter}` : null,
    screenshotPaths: screenshots.map((s) => `screenshots/${userId}/${s}`),
  }));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Property 22: Data Export Completeness', () => {
  const TEST_USER_ID = 'user-test-001';

  const mockProfile = {
    id: 'profile-1',
    userId: TEST_USER_ID,
    fullName: 'Test User',
    email: 'test@example.com',
    location: 'New York',
    workExperiences: [],
    educations: [],
    projects: [],
    skills: [],
    certifications: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // ── P22a: ZIP always contains profile.json and applications.csv ─────────────
  it('P22a — ZIP always contains profile.json and applications.csv', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(resumeVersionArb(TEST_USER_ID), { minLength: 0, maxLength: 3 }),
        fc.array(applicationArb(TEST_USER_ID), { minLength: 0, maxLength: 3 }),
        async (resumeVersions, applications) => {
          const app = await buildTestApp({
            prismaProfile: mockProfile,
            prismaApplications: applications,
            prismaResumeVersions: resumeVersions,
            downloadFile: async (_key: string) => Buffer.from('fake-file-content'),
          });

          const token = signToken(app, TEST_USER_ID);
          const response = await app.inject({
            method: 'GET',
            url: '/api/user/export',
            headers: { authorization: `Bearer ${token}` },
          });

          expect(response.statusCode).toBe(200);
          expect(response.headers['content-type']).toContain('application/zip');
          expect(response.headers['content-disposition']).toContain('jobpilot-export.zip');

          const zipBuf = response.rawPayload;
          expect(zipBuf.length).toBeGreaterThan(0);

          const entries = parseZipEntryNames(zipBuf);
          expect(entries).toContain('profile.json');
          expect(entries).toContain('applications.csv');

          await app.close();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── P22b: ZIP contains one resume entry per ResumeVersion ───────────────────
  it('P22b — ZIP contains one resume entry per ResumeVersion', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(resumeVersionArb(TEST_USER_ID), { minLength: 1, maxLength: 4 }),
        async (resumeVersions) => {
          const app = await buildTestApp({
            prismaProfile: mockProfile,
            prismaApplications: [],
            prismaResumeVersions: resumeVersions,
            downloadFile: async (_key: string) => Buffer.from('resume-bytes'),
          });

          const token = signToken(app, TEST_USER_ID);
          const response = await app.inject({
            method: 'GET',
            url: '/api/user/export',
            headers: { authorization: `Bearer ${token}` },
          });

          expect(response.statusCode).toBe(200);

          const entries = parseZipEntryNames(response.rawPayload);
          const resumeEntries = entries.filter((e) => e.startsWith('resumes/'));

          // Each resume version should produce exactly one entry
          expect(resumeEntries.length).toBe(resumeVersions.length);

          // Each entry should match the basename of the resume's fileUrl
          for (const rv of resumeVersions) {
            const expectedName = `resumes/${path.basename(rv.fileUrl)}`;
            expect(entries).toContain(expectedName);
          }

          await app.close();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── P22c: ZIP contains one cover-letter entry per application with coverLetterPath
  it('P22c — ZIP contains one cover-letter entry per application with coverLetterPath', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(applicationArb(TEST_USER_ID), { minLength: 1, maxLength: 5 }),
        async (applications) => {
          const app = await buildTestApp({
            prismaProfile: mockProfile,
            prismaApplications: applications,
            prismaResumeVersions: [],
            downloadFile: async (_key: string) => Buffer.from('cover-letter-bytes'),
          });

          const token = signToken(app, TEST_USER_ID);
          const response = await app.inject({
            method: 'GET',
            url: '/api/user/export',
            headers: { authorization: `Bearer ${token}` },
          });

          expect(response.statusCode).toBe(200);

          const entries = parseZipEntryNames(response.rawPayload);
          const coverLetterEntries = entries.filter((e) =>
            e.startsWith('cover-letters/'),
          );

          const appsWithCoverLetter = applications.filter(
            (a) => a.coverLetterPath !== null,
          );
          expect(coverLetterEntries.length).toBe(appsWithCoverLetter.length);

          for (const a of appsWithCoverLetter) {
            const expectedName = `cover-letters/${path.basename(a.coverLetterPath!)}`;
            expect(entries).toContain(expectedName);
          }

          await app.close();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── P22d: ZIP contains one screenshot entry per screenshotPath across all apps
  it('P22d — ZIP contains one screenshot entry per screenshotPath across all applications', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(applicationArb(TEST_USER_ID), { minLength: 1, maxLength: 4 }),
        async (applications) => {
          const app = await buildTestApp({
            prismaProfile: mockProfile,
            prismaApplications: applications,
            prismaResumeVersions: [],
            downloadFile: async (_key: string) => Buffer.from('screenshot-bytes'),
          });

          const token = signToken(app, TEST_USER_ID);
          const response = await app.inject({
            method: 'GET',
            url: '/api/user/export',
            headers: { authorization: `Bearer ${token}` },
          });

          expect(response.statusCode).toBe(200);

          const entries = parseZipEntryNames(response.rawPayload);
          const screenshotEntries = entries.filter((e) =>
            e.startsWith('screenshots/'),
          );

          const allScreenshots = applications.flatMap((a) => a.screenshotPaths);
          expect(screenshotEntries.length).toBe(allScreenshots.length);

          for (const screenshotPath of allScreenshots) {
            const expectedName = `screenshots/${path.basename(screenshotPath)}`;
            expect(entries).toContain(expectedName);
          }

          await app.close();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── P22e: Failed file downloads are skipped, export continues ──────────────
  it('P22e — failed SeaweedFS downloads are skipped and the export still returns a valid ZIP', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(resumeVersionArb(TEST_USER_ID), { minLength: 2, maxLength: 4 }),
        async (resumeVersions) => {
          let callCount = 0;
          // Fail every other download to simulate partial failures
          const downloadFile = async (_key: string): Promise<Buffer> => {
            callCount++;
            if (callCount % 2 === 0) {
              throw new Error('Simulated download failure');
            }
            return Buffer.from('file-bytes');
          };

          const app = await buildTestApp({
            prismaProfile: mockProfile,
            prismaApplications: [],
            prismaResumeVersions: resumeVersions,
            downloadFile,
          });

          const token = signToken(app, TEST_USER_ID);
          const response = await app.inject({
            method: 'GET',
            url: '/api/user/export',
            headers: { authorization: `Bearer ${token}` },
          });

          // Export must still succeed — partial downloads don't abort the archive
          expect(response.statusCode).toBe(200);
          expect(response.headers['content-type']).toContain('application/zip');

          const entries = parseZipEntryNames(response.rawPayload);
          // Mandatory entries must always be present
          expect(entries).toContain('profile.json');
          expect(entries).toContain('applications.csv');

          await app.close();
        },
      ),
      { numRuns: 10 },
    );
  });

  // ── P22f: Unauthenticated requests are rejected ──────────────────────────
  it('P22f — unauthenticated requests receive HTTP 401', async () => {
    const app = await buildTestApp({
      prismaProfile: mockProfile,
      prismaApplications: [],
      prismaResumeVersions: [],
      downloadFile: async () => Buffer.from(''),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/user/export',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
