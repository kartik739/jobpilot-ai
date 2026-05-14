import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  storeRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
  authenticate,
  requireSameUser,
} from './auth.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

// ─── 1. Bcrypt hashing — never stores plaintext (Req 23.1) ───────────────────

describe('bcrypt password hashing (Req 23.1)', () => {
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword('secret');
  });

  it('hash is not equal to the plaintext password', () => {
    expect(hash).not.toBe('secret');
  });

  it('hash starts with bcrypt prefix $2', () => {
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifyPassword returns true for the correct password', async () => {
    const result = await verifyPassword('secret', hash);
    expect(result).toBe(true);
  });

  it('verifyPassword returns false for a wrong password', async () => {
    const result = await verifyPassword('wrong', hash);
    expect(result).toBe(false);
  });
});

// ─── 2. JWT expiry / authenticate hook (Req 23.2) ────────────────────────────

describe('authenticate hook (Req 23.2)', () => {
  it('calls reply.status(401).send when jwtVerify throws', async () => {
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });

    const request = {
      jwtVerify: vi.fn().mockRejectedValue(new Error('token expired')),
    } as unknown as FastifyRequest;

    const reply = {
      status: statusMock,
    } as unknown as FastifyReply;

    await authenticate(request, reply);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(sendMock).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('does NOT call reply.status with 401 when jwtVerify resolves', async () => {
    const statusMock = vi.fn();

    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
    } as unknown as FastifyRequest;

    const reply = {
      status: statusMock,
    } as unknown as FastifyReply;

    await authenticate(request, reply);

    expect(statusMock).not.toHaveBeenCalledWith(401);
  });
});

// ─── 3. Refresh token Redis TTL (Req 23.3) ───────────────────────────────────

describe('refresh token Redis operations (Req 23.3)', () => {
  const userId = 'user-123';
  const token = 'abc123token';

  it('storeRefreshToken calls redis.set with correct key, EX flag, and 7-day TTL', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;

    await storeRefreshToken(userId, token, redis);

    expect(redis.set).toHaveBeenCalledWith(
      `refresh_token:${token}`,
      userId,
      'EX',
      604800,
    );
  });

  it('validateRefreshToken calls redis.get with the correct key', async () => {
    const redis = { get: vi.fn().mockResolvedValue(userId) } as unknown as Redis;

    const result = await validateRefreshToken(token, redis);

    expect(redis.get).toHaveBeenCalledWith(`refresh_token:${token}`);
    expect(result).toBe(userId);
  });

  it('validateRefreshToken returns null when key does not exist', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null) } as unknown as Redis;

    const result = await validateRefreshToken(token, redis);

    expect(result).toBeNull();
  });

  it('deleteRefreshToken calls redis.del with the correct key', async () => {
    const redis = { del: vi.fn().mockResolvedValue(1) } as unknown as Redis;

    await deleteRefreshToken(token, redis);

    expect(redis.del).toHaveBeenCalledWith(`refresh_token:${token}`);
  });
});

// ─── 4. Role isolation — requireSameUser (Req 23.6) ──────────────────────────

describe('requireSameUser role isolation (Req 23.6)', () => {
  it('allows the request when user ID matches the route param', async () => {
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });

    const request = {
      user: { id: 'user-abc', email: 'a@test.com' },
      params: { userId: 'user-abc' },
    } as unknown as FastifyRequest;

    const reply = {
      status: statusMock,
    } as unknown as FastifyReply;

    const handler = requireSameUser('userId');
    await handler(request, reply);

    expect(statusMock).not.toHaveBeenCalledWith(403);
    expect(sendMock).not.toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 403 Forbidden when user ID does not match the route param', async () => {
    const sendMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ send: sendMock });

    const request = {
      user: { id: 'user-abc', email: 'a@test.com' },
      params: { userId: 'user-xyz' },
    } as unknown as FastifyRequest;

    const reply = {
      status: statusMock,
    } as unknown as FastifyReply;

    const handler = requireSameUser('userId');
    await handler(request, reply);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(sendMock).toHaveBeenCalledWith({ error: 'Forbidden' });
  });
});
