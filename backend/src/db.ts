import { PrismaClient } from '@prisma/client';
import { applyEncryptionMiddleware } from './core/encryption.js';
import { createChildLogger } from './core/logger.js';

const log = createChildLogger({ module: 'db' });

const prisma = new PrismaClient();

// applyEncryptionMiddleware expects the legacy Prisma $use middleware API.
// Cast to satisfy the type while the middleware wiring is in place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
applyEncryptionMiddleware(prisma as any);

// ─── Resume version success count middleware ──────────────────────────────────

/**
 * Statuses that represent a successful advancement past the submitted stage.
 * Requirement 20.7
 */
const SUCCESS_ADVANCEMENT_STATUSES = new Set([
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
]);

/**
 * Prisma middleware that intercepts `applicationRecord.update` operations and
 * increments `successCount` on the linked ResumeVersion when the application
 * status transitions to a success-advancement status.
 *
 * Requirements: 20.7
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(prisma as any).$use(async (params: any, next: any) => {
  if (params.model !== 'ApplicationRecord' || params.action !== 'update') {
    return next(params);
  }

  const args = params.args as {
    where?: { id?: string };
    data?: { status?: string };
  };

  const newStatus = args.data?.status;

  // Only act when the update includes a status field that is an advancement status
  if (!newStatus || !SUCCESS_ADVANCEMENT_STATUSES.has(newStatus)) {
    return next(params);
  }

  // Fetch the current record to check resumeVersionId
  const applicationId = args.where?.id;
  if (!applicationId) {
    return next(params);
  }

  const current = await prisma.applicationRecord.findUnique({
    where: { id: applicationId },
    select: { status: true, resumeVersionId: true },
  });

  // Proceed with the update first
  const result = await next(params);

  // Only increment if the status actually changed (avoid double-counting re-updates)
  if (current && current.status !== newStatus && current.resumeVersionId) {
    try {
      await prisma.resumeVersion.update({
        where: { id: current.resumeVersionId },
        data: { successCount: { increment: 1 } },
      });

      log.info(
        {
          applicationId,
          resumeVersionId: current.resumeVersionId,
          fromStatus: current.status,
          toStatus: newStatus,
        },
        'Incremented resumeVersion.successCount on status advancement',
      );
    } catch (err) {
      // Non-fatal: log and continue — don't fail the status update
      log.warn(
        {
          applicationId,
          resumeVersionId: current.resumeVersionId,
          err,
        },
        'Failed to increment resumeVersion.successCount — continuing',
      );
    }
  }

  return result;
});

export { prisma };
