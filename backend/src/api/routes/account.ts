/**
 * Account management routes
 *
 * DELETE /api/user/account
 *   Permanently deletes the authenticated user's account and purges all
 *   associated data from the database, SeaweedFS, and Redis.
 *
 * Requirements: 25.3
 */

import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { authenticate } from '../../core/auth.js';
import { prisma } from '../../db.js';
import { deleteFile } from '../../services/storage.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ module: 'accountRoutes' });

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function accountRoutes(
  app: FastifyInstance,
  options: { redis: Redis },
): Promise<void> {
  const { redis } = options;

  /**
   * DELETE /api/user/account
   *
   * Purges all data for the authenticated user:
   *   1. Collects all SeaweedFS file keys from the DB before deletion
   *   2. Executes a single Prisma transaction deleting all records in
   *      dependency order
   *   3. Deletes all collected SeaweedFS files (best-effort)
   *   4. Revokes all Redis tokens for the user
   *
   * Returns HTTP 204 No Content on success.
   *
   * Requirements: 25.3
   */
  app.delete(
    '/api/user/account',
    { preHandler: authenticate },
    async (request, reply) => {
      const userId = request.user.id;
      const reqLog = log.child({ fn: 'deleteAccount', userId });

      // ── Step 1: Collect all SeaweedFS file keys BEFORE deleting DB records ──

      const [resumeVersions, applications] = await Promise.all([
        prisma.resumeVersion.findMany({
          where: { userId },
          select: { fileUrl: true },
        }),
        prisma.applicationRecord.findMany({
          where: { userId },
          select: { coverLetterPath: true, screenshotPaths: true },
        }),
      ]);

      const fileKeysToDelete: string[] = [
        ...resumeVersions.map((rv) => rv.fileUrl),
        ...applications
          .filter((a) => a.coverLetterPath !== null)
          .map((a) => a.coverLetterPath as string),
        ...applications.flatMap((a) => a.screenshotPaths),
      ];

      reqLog.info(
        { fileCount: fileKeysToDelete.length },
        'Collected SeaweedFS file keys for deletion',
      );

      // ── Step 2: Delete all DB records in a single transaction ───────────────
      //
      // Deletion order respects foreign-key dependencies:
      //   StatusTransition → ApplicationRecord (clears FK on InterviewPrepSheet cascade)
      //   ResumeVersion
      //   Notification
      //   AgentTask
      //   JobMatch
      //   InterviewPrepSheet (cascades from ApplicationRecord via onDelete:Cascade)
      //   ReusableAnswer
      //   JobSourceConfig
      //   Profile (cascades WorkExperience, Education, Project, Skill, Certification)
      //   User

      await prisma.$transaction([
        // Children of ApplicationRecord
        prisma.statusTransition.deleteMany({
          where: { application: { userId } },
        }),
        prisma.interviewPrepSheet.deleteMany({
          where: { application: { userId } },
        }),
        prisma.applicationRecord.deleteMany({ where: { userId } }),

        // Direct children of User (no further child tables beyond those above)
        prisma.resumeVersion.deleteMany({ where: { userId } }),
        prisma.notification.deleteMany({ where: { userId } }),
        prisma.agentTask.deleteMany({ where: { userId } }),
        prisma.jobMatch.deleteMany({ where: { userId } }),
        prisma.reusableAnswer.deleteMany({ where: { userId } }),
        prisma.jobSourceConfig.deleteMany({ where: { userId } }),

        // Profile cascades its own children (WorkExperience, Education, etc.)
        prisma.profile.deleteMany({ where: { userId } }),

        // Finally, delete the user
        prisma.user.delete({ where: { id: userId } }),
      ]);

      reqLog.info('All database records deleted for user');

      // ── Step 3: Delete SeaweedFS files (best-effort) ─────────────────────────

      const deletionResults = await Promise.allSettled(
        fileKeysToDelete.map((key) => deleteFile(key)),
      );

      const failed = deletionResults.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        reqLog.warn(
          {
            failedCount: failed.length,
            errors: failed.map((r) =>
              r.status === 'rejected' ? String(r.reason) : '',
            ),
          },
          'Some SeaweedFS files could not be deleted — continuing',
        );
      } else {
        reqLog.info(
          { deletedCount: fileKeysToDelete.length },
          'All SeaweedFS files deleted',
        );
      }

      // ── Step 4: Revoke Redis tokens ──────────────────────────────────────────
      //
      // Refresh tokens are stored as:  refresh_token:{token} → userId
      // We must SCAN to find all keys whose value equals this userId.
      //
      // Automation-paused flag: automation_paused:{userId}

      try {
        // Scan for all refresh token keys that belong to this user
        const refreshTokenKeys = await scanRefreshTokensForUser(userId, redis);

        const keysToDelete = [
          ...refreshTokenKeys,
          `automation_paused:${userId}`,
        ];

        if (keysToDelete.length > 0) {
          await redis.del(...keysToDelete);
        }

        reqLog.info(
          { revokedTokenCount: refreshTokenKeys.length },
          'Redis tokens revoked for user',
        );
      } catch (err) {
        // Token revocation failure is logged but must not prevent 204 response.
        // The user's DB records are already gone, so access is effectively blocked.
        reqLog.error({ err }, 'Failed to revoke Redis tokens — continuing');
      }

      return reply.status(204).send();
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Scan Redis for all `refresh_token:*` keys whose value equals `userId`.
 * Uses cursor-based SCAN to avoid blocking the Redis server.
 */
async function scanRefreshTokensForUser(
  userId: string,
  redis: Redis,
): Promise<string[]> {
  const matchingKeys: string[] = [];
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      'refresh_token:*',
      'COUNT',
      100,
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      // Pipeline GET requests for efficiency
      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.get(key);
      }
      const results = await pipeline.exec();

      if (results) {
        for (let i = 0; i < keys.length; i++) {
          const [err, value] = results[i]!;
          if (!err && value === userId) {
            matchingKeys.push(keys[i]!);
          }
        }
      }
    }
  } while (cursor !== '0');

  return matchingKeys;
}
