import { z } from 'zod/v4';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import {
  hashPassword,
  verifyPassword,
  generateRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
} from '../../core/auth.js';

// ─── Prisma singleton ─────────────────────────────────────────────────────────

const prisma = new PrismaClient();

// ─── Validation schemas ───────────────────────────────────────────────────────

const RegisterBody = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const LoginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const RefreshBody = z.object({
  refreshToken: z.string().min(1),
});

const LogoutBody = z.object({
  refreshToken: z.string().min(1),
});

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function authRoutes(
  app: FastifyInstance,
  options: { redis: Redis },
): Promise<void> {
  const { redis } = options;

  // POST /api/auth/register
  app.post('/api/auth/register', async (request, reply) => {
    const result = RegisterBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Validation failed', details: result.error.issues });
    }

    const { email, password } = result.data;
    const passwordHash = await hashPassword(password);

    let user: { id: string; email: string };
    try {
      user = await prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true },
      });
    } catch (err: unknown) {
      // Prisma unique constraint violation code
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return reply.status(409).send({ error: 'Email already in use' });
      }
      throw err;
    }

    const accessToken = await reply.jwtSign(
      { id: user.id, email: user.email },
      { expiresIn: '1h' },
    );
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, refreshToken, redis);

    reply.setCookie('access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: 3600,
    });

    return reply.status(201).send({ accessToken, refreshToken, user });
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    const result = LoginBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Validation failed', details: result.error.issues });
    }

    const { email, password } = result.data;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const accessToken = await reply.jwtSign(
      { id: user.id, email: user.email },
      { expiresIn: '1h' },
    );
    const refreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, refreshToken, redis);

    reply.setCookie('access_token', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: 3600,
    });

    return reply.send({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email },
    });
  });

  // POST /api/auth/refresh
  app.post('/api/auth/refresh', async (request, reply) => {
    const result = RefreshBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Validation failed', details: result.error.issues });
    }

    const { refreshToken } = result.data;
    const userId = await validateRefreshToken(refreshToken, redis);

    if (!userId) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'User not found' });
    }

    // Rotate: delete old token, issue new pair
    await deleteRefreshToken(refreshToken, redis);

    const accessToken = await reply.jwtSign(
      { id: user.id, email: user.email },
      { expiresIn: '1h' },
    );
    const newRefreshToken = generateRefreshToken();
    await storeRefreshToken(user.id, newRefreshToken, redis);

    return reply.send({ accessToken, refreshToken: newRefreshToken });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (request, reply) => {
    const result = LogoutBody.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Validation failed', details: result.error.issues });
    }

    const { refreshToken } = result.data;
    await deleteRefreshToken(refreshToken, redis);

    reply.clearCookie('access_token', { path: '/' });

    return reply.status(204).send();
  });
}
