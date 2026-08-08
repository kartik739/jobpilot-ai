/**
 * Property-based tests for security headers
 *
 * **Property 27: Security Headers Presence**
 * **Validates: Requirements 33.4**
 *
 * For every HTTP request path the Fastify server must include all four
 * mandatory security headers in the response:
 *   - Strict-Transport-Security
 *   - X-Content-Type-Options
 *   - X-Frame-Options
 *   - Content-Security-Policy
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { type FastifyInstance } from 'fastify';

// Stub heavy side-effectful modules that are imported transitively by server.ts
import { vi } from 'vitest';

// Set required env vars before any modules are imported, so that modules
// that validate env vars at initialisation time (e.g. encryption.ts) don't throw.
// A 32-byte value encoded as base64 (44 chars).
process.env['ENCRYPTION_KEY'] = Buffer.alloc(32).toString('base64');
process.env['FRONTEND_ORIGIN'] = 'http://localhost:3001';
process.env['JWT_SECRET'] = 'test-secret';
process.env['REDIS_URL'] = 'redis://localhost:6379';

// Mock Prisma so that routes creating `new PrismaClient()` don't try to
// connect to a real database during tests.
vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    user = { findUnique: vi.fn(), create: vi.fn() };
    $connect = vi.fn();
    $disconnect = vi.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

vi.mock('../../db.js', () => ({ prisma: {} }));

vi.mock('ioredis', () => {
  class Redis {
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    del = vi.fn().mockResolvedValue(1);
    quit = vi.fn().mockResolvedValue('OK');
    disconnect = vi.fn();
  }
  return { Redis };
});

vi.mock('bullmq', () => {
  class Queue {
    constructor() {}
    add = vi.fn().mockResolvedValue({ id: 'mock-job-id' });
    close = vi.fn().mockResolvedValue(undefined);
    getJobs = vi.fn().mockResolvedValue([]);
  }
  class Worker {
    constructor() {}
    close = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
  }
  return { Queue, Worker };
});

vi.mock('../../core/errorTracking.js', () => ({
  initErrorTracking: vi.fn(),
}));

// ─── Build a minimal Fastify instance with only helmet + cors ────────────────
// We build the full app so the plugin registration order is identical to
// production. The extra routes are irrelevant — we only care about the headers
// that helmet injects on every response.

async function buildTestApp(): Promise<FastifyInstance> {
  const { buildApp } = await import('../../server.js');
  return buildApp({ logger: false });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Property 27: Security Headers Presence', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * Property: for ANY request path, all four security headers are present.
   *
   * We use fc.webPath() to generate realistic URL path strings, but the
   * assertion must hold for every path — the headers are applied globally by
   * the helmet plugin, not route-by-route.
   */
  it('all four security headers are present on every response regardless of path', async () => {
    await fc.assert(
      fc.asyncProperty(
        // fc.webPath() generates valid URL path strings starting with "/".
        // We filter to non-empty paths to avoid inject() parsing errors on "".
        fc.webPath().filter((p) => p.length > 0),
        async (path) => {
          const response = await app.inject({
            method: 'GET',
            url: path,
          });

          // 1. Strict-Transport-Security
          expect(
            response.headers['strict-transport-security'],
            `Expected strict-transport-security header on GET ${path}`,
          ).toBeDefined();

          const hsts = response.headers['strict-transport-security'] as string;
          expect(hsts).toMatch(/max-age=63072000/);
          expect(hsts).toMatch(/includeSubDomains/i);

          // 2. X-Content-Type-Options
          expect(
            response.headers['x-content-type-options'],
            `Expected x-content-type-options header on GET ${path}`,
          ).toBeDefined();
          expect(response.headers['x-content-type-options']).toBe('nosniff');

          // 3. X-Frame-Options
          expect(
            response.headers['x-frame-options'],
            `Expected x-frame-options header on GET ${path}`,
          ).toBeDefined();
          expect(response.headers['x-frame-options']).toMatch(/^DENY$/i);

          // 4. Content-Security-Policy
          expect(
            response.headers['content-security-policy'],
            `Expected content-security-policy header on GET ${path}`,
          ).toBeDefined();

          const csp = response.headers['content-security-policy'] as string;
          expect(csp).toContain("default-src 'self'");
        },
      ),
      { numRuns: 50 },
    );
  });

  // ── Deterministic spot-checks ──────────────────────────────────────────────

  it('security headers are present on the root path "/"', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toMatch(/^DENY$/i);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('security headers are present on a deep nested path', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/some/nested/path' });

    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toMatch(/^DENY$/i);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('security headers are present on POST requests too', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/anything' });

    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toMatch(/^DENY$/i);
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
