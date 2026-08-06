/**
 * Tests for the Account Deletion endpoint
 *
 * DELETE /api/user/account
 *
 * Validates: Requirements 25.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';

// ─── Stub out heavy dependencies before any route imports ────────────────────

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
  createChildLogger: () => ({
    child: () => ({
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    }),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockRedis {
  scan: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a minimal Fastify test app with the account route registered,
 * using injected prisma mock, storage mock, and redis mock.
 */
async function buildTestApp(opts: {
  prismaResumeVersions?: { fileUrl: string }[];
  prismaApplications?: { coverLetterPath: string | null; screenshotPaths: string[] }[];
  deleteFileMock?: ReturnType<typeof vi.fn>;
  redisMock?: MockRedis;
}): Promise<{ app: FastifyInstance; redisMock: MockRedis }> {
  const {
    prismaResumeVersions = [],
    prismaApplications = [],
    deleteFileMock = vi.fn().mockResolvedValue(undefined),
  } = opts;

  // Set up the prisma mock
  const { prisma } = await import('../../db.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as unknown as Record<string, unknown>;

  p['resumeVersion'] = {
    findMany: vi.fn().mockResolvedValue(prismaResumeVersions),
    deleteMany: vi.fn().mockResolvedValue({ count: prismaResumeVersions.length }),
  };
  p['applicationRecord'] = {
    findMany: vi.fn().mockResolvedValue(prismaApplications),
    deleteMany: vi.fn().mockResolvedValue({ count: prismaApplications.length }),
  };
  p['statusTransition'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['interviewPrepSheet'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['notification'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['agentTask'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['jobMatch'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['reusableAnswer'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['jobSourceConfig'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['profile'] = {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
  p['user'] = {
    delete: vi.fn().mockResolvedValue({ id: 'user-1' }),
  };
  // $transaction: run all operations sequentially
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p['$transaction'] = vi.fn().mockImplementation(async (ops: any[]) => {
    return Promise.all(ops);
  });

  // Storage mock
  vi.doMock('../../services/storage.js', () => ({
    deleteFile: deleteFileMock,
  }));

  // Redis mock
  const redisMock: MockRedis = opts.redisMock ?? {
    scan: vi.fn().mockResolvedValue(['0', []]), // empty scan
    pipeline: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    del: vi.fn().mockResolvedValue(1),
  };

  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'test-secret' });

  const { accountRoutes } = await import('./account.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(accountRoutes, { redis: redisMock as any });
  await app.ready();

  return { app, redisMock };
}

/** Sign a JWT for a given userId so authenticate() passes */
function signToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ id: userId, email: 'test@example.com' });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DELETE /api/user/account', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── 1. Unauthenticated request returns 401 ────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const { app } = await buildTestApp({});

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 when an invalid JWT is provided', async () => {
    const { app } = await buildTestApp({});

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  // ── 2. Authenticated user can delete their account (HTTP 204) ─────────────

  it('returns 204 No Content when an authenticated user deletes their account', async () => {
    const { app } = await buildTestApp({
      prismaResumeVersions: [{ fileUrl: 'resumes/user-1/cv.pdf' }],
      prismaApplications: [
        {
          coverLetterPath: 'cover-letters/user-1/cl.pdf',
          screenshotPaths: ['screenshots/user-1/s1.png'],
        },
      ],
    });

    const token = signToken(app, 'user-1');
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    await app.close();
  });

  it('executes a prisma transaction to delete all user records', async () => {
    const { app } = await buildTestApp({});
    const { prisma } = await import('../../db.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactionMock = (prisma as any).$transaction as ReturnType<typeof vi.fn>;

    const token = signToken(app, 'user-1');
    await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    await app.close();
  });

  // ── 3. SeaweedFS deletion errors are logged but don't prevent 204 ─────────

  it('still returns 204 when SeaweedFS file deletion fails', async () => {
    const failingDeleteFile = vi
      .fn()
      .mockRejectedValue(new Error('SeaweedFS connection refused'));

    const { app } = await buildTestApp({
      prismaResumeVersions: [
        { fileUrl: 'resumes/user-1/cv1.pdf' },
        { fileUrl: 'resumes/user-1/cv2.pdf' },
      ],
      prismaApplications: [
        {
          coverLetterPath: 'cover-letters/user-1/cl.pdf',
          screenshotPaths: ['screenshots/user-1/s1.png', 'screenshots/user-1/s2.png'],
        },
      ],
      deleteFileMock: failingDeleteFile,
    });

    const token = signToken(app, 'user-1');
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    // Despite all file deletions failing, the endpoint must still return 204
    expect(response.statusCode).toBe(204);
    // All file keys were attempted
    expect(failingDeleteFile).toHaveBeenCalledTimes(5); // 2 resumes + 1 cover letter + 2 screenshots
    await app.close();
  });

  // ── 4. Redis tokens are revoked ───────────────────────────────────────────

  it('deletes the automation_paused Redis key for the user', async () => {
    const redisMock: MockRedis = {
      scan: vi.fn().mockResolvedValue(['0', []]), // no refresh tokens
      pipeline: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
      del: vi.fn().mockResolvedValue(1),
    };

    const { app } = await buildTestApp({ redisMock });

    const token = signToken(app, 'user-42');
    await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    // del should have been called with automation_paused:user-42
    expect(redisMock.del).toHaveBeenCalledWith('automation_paused:user-42');
    await app.close();
  });

  it('revokes refresh tokens belonging to the deleted user', async () => {
    const userId = 'user-99';
    const tokenKey = `refresh_token:abc123`;

    const redisMock: MockRedis = {
      // First scan returns one matching key, second scan ends cursor
      scan: vi.fn().mockResolvedValue(['0', [tokenKey]]),
      pipeline: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, userId]]), // key maps to our userId
      }),
      del: vi.fn().mockResolvedValue(2),
    };

    const { app } = await buildTestApp({ redisMock });

    const token = signToken(app, userId);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
    // Should have deleted the token key AND automation_paused key
    expect(redisMock.del).toHaveBeenCalledWith(tokenKey, `automation_paused:${userId}`);
    await app.close();
  });

  // ── 5. SeaweedFS file keys collected correctly ─────────────────────────────

  it('attempts to delete all resume, cover-letter, and screenshot files', async () => {
    const deleteFileMock = vi.fn().mockResolvedValue(undefined);

    const { app } = await buildTestApp({
      prismaResumeVersions: [{ fileUrl: 'resumes/user-1/r1.pdf' }],
      prismaApplications: [
        {
          coverLetterPath: 'cover-letters/user-1/cl.pdf',
          screenshotPaths: ['screenshots/user-1/s1.png', 'screenshots/user-1/s2.png'],
        },
        {
          coverLetterPath: null,
          screenshotPaths: ['screenshots/user-1/s3.png'],
        },
      ],
      deleteFileMock,
    });

    const token = signToken(app, 'user-1');
    await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    // 1 resume + 1 cover letter + 3 screenshots = 5 files
    expect(deleteFileMock).toHaveBeenCalledTimes(5);
    expect(deleteFileMock).toHaveBeenCalledWith('resumes/user-1/r1.pdf');
    expect(deleteFileMock).toHaveBeenCalledWith('cover-letters/user-1/cl.pdf');
    expect(deleteFileMock).toHaveBeenCalledWith('screenshots/user-1/s1.png');
    expect(deleteFileMock).toHaveBeenCalledWith('screenshots/user-1/s2.png');
    expect(deleteFileMock).toHaveBeenCalledWith('screenshots/user-1/s3.png');
    await app.close();
  });

  it('skips null coverLetterPaths and does not attempt to delete them', async () => {
    const deleteFileMock = vi.fn().mockResolvedValue(undefined);

    const { app } = await buildTestApp({
      prismaResumeVersions: [],
      prismaApplications: [
        { coverLetterPath: null, screenshotPaths: [] },
        { coverLetterPath: null, screenshotPaths: [] },
      ],
      deleteFileMock,
    });

    const token = signToken(app, 'user-1');
    await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    // No files to delete
    expect(deleteFileMock).not.toHaveBeenCalled();
    await app.close();
  });

  // ── 6. Redis failure does not prevent 204 ────────────────────────────────

  it('returns 204 even when Redis token revocation throws an error', async () => {
    const redisMock: MockRedis = {
      scan: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
      pipeline: vi.fn(),
      del: vi.fn(),
    };

    const { app } = await buildTestApp({ redisMock });

    const token = signToken(app, 'user-1');
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/user/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
    await app.close();
  });
});
