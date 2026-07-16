import { PrismaClient } from '@prisma/client';
import { applyEncryptionMiddleware } from './core/encryption.js';

const prisma = new PrismaClient();

// applyEncryptionMiddleware expects the legacy Prisma $use middleware API.
// Cast to satisfy the type while the middleware wiring is in place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
applyEncryptionMiddleware(prisma as any);

export { prisma };
