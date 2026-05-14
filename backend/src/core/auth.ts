import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

// ─── Type augmentation ────────────────────────────────────────────────────────
// Teach @fastify/jwt the shape of our JWT payload so that request.user is typed
// throughout the application.

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; email: string };
    user: { id: string; email: string };
  }
}

// ─── Password helpers ─────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Refresh token helpers ────────────────────────────────────────────────────

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

export async function storeRefreshToken(
  userId: string,
  token: string,
  redis: Redis,
): Promise<void> {
  await redis.set(
    `refresh_token:${token}`,
    userId,
    'EX',
    REFRESH_TOKEN_TTL_SECONDS,
  );
}

export async function validateRefreshToken(
  token: string,
  redis: Redis,
): Promise<string | null> {
  const userId = await redis.get(`refresh_token:${token}`);
  return userId ?? null;
}

export async function deleteRefreshToken(
  token: string,
  redis: Redis,
): Promise<void> {
  await redis.del(`refresh_token:${token}`);
}

// ─── Fastify hooks ────────────────────────────────────────────────────────────

/**
 * preHandler hook — validates the `Authorization: Bearer <jwt>` header and
 * decorates `request.user` with `{ id, email }`. Returns HTTP 401 on failure.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

/**
 * Factory that returns a preHandler hook enforcing that the authenticated user
 * matches the route parameter identified by `paramName`. Returns HTTP 403 when
 * the IDs differ.
 */
export function requireSameUser(
  paramName: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = request.params as Record<string, string>;
    if (request.user.id !== params[paramName]) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}
