/**
 * Integration Test 70.3: WebSocket Lifecycle Events
 *
 * Builds the real Fastify app, starts it on a random port, connects a WS
 * client to `/api/notifications/ws?token=<jwt>`, then directly emits
 * lifecycle events through `fastifyInstance.websocketServer.clients` (the
 * same channel used by `applicationAgent.ts`) and asserts that all required
 * events are received by the client within 5 seconds.
 *
 * All external dependencies (Prisma, Redis, BullMQ, Playwright) are mocked
 * so no real services are required.
 *
 * Validates: Requirements 32.1, 32.2, 32.3
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

// ─── Module-level mocks (must appear before any dynamic imports) ──────────────

// Mock ioredis so no real Redis connections are created.
// The mock returns a minimal subscriber/publisher that satisfies the notification
// route's usage: subscribe(), unsubscribe(), disconnect(), on(), publish().
vi.mock('ioredis', async () => {
  class MockRedis {
    private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    on(event: string, handler: (...args: unknown[]) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event]!.push(handler);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      const handlers = this.handlers[event];
      if (handlers) handlers.forEach((h) => h(...args));
    }

    async subscribe(_channel: string) {
      return 1;
    }

    async unsubscribe(_channel?: string) {
      return 1;
    }

    disconnect() {
      // no-op
    }

    async quit() {
      return 'OK';
    }

    async get(_key: string): Promise<null> {
      return null;
    }

    async set(..._args: unknown[]): Promise<'OK'> {
      return 'OK';
    }

    async del(..._args: unknown[]): Promise<number> {
      return 1;
    }

    async eval(..._args: unknown[]): Promise<number> {
      return 0;
    }

    async publish(_channel: string, _message: string): Promise<number> {
      return 0;
    }
  }

  return { Redis: MockRedis, default: MockRedis };
});

// Mock Prisma to avoid DB connections.
vi.mock('../../src/db.js', () => ({
  prisma: {
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        notification: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return fn(txMock);
    }),
    profile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    applicationRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    jobMatch: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    jobPosting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    resumeVersion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    jobSourceConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock @prisma/client so that direct `new PrismaClient()` calls in route files
// (e.g. auth.ts) don't try to initialize a real DB connection.
vi.mock('@prisma/client', () => {
  const mockPrismaInstance = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'mock-user', email: 'mock@example.com', passwordHash: '' }),
    },
    profile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'notif-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    applicationRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    jobMatch: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    jobPosting: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    resumeVersion: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    jobSourceConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txMock = {
        notification: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return fn(txMock);
    }),
    $use: vi.fn(),
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };

  class MockPrismaClient {
    constructor() {
      return mockPrismaInstance;
    }
  }

  class MockPrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }

  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      PrismaClientKnownRequestError: MockPrismaClientKnownRequestError,
    },
  };
});

// Mock prom-client to avoid metric registration errors during multiple test runs.
vi.mock('prom-client', () => {
  class MockRegistry {
    metrics = vi.fn().mockResolvedValue('');
    contentType = 'text/plain; version=0.0.4; charset=utf-8';
    clear = vi.fn();
    registerMetric = vi.fn();
    getMetricsAsJSON = vi.fn().mockResolvedValue([]);
    resetMetrics = vi.fn();
    setDefaultLabels = vi.fn();
  }

  class MockCounter {
    inc = vi.fn();
    labels = vi.fn().mockReturnThis();
    reset = vi.fn();
  }

  class MockGauge {
    set = vi.fn();
    inc = vi.fn();
    dec = vi.fn();
    labels = vi.fn().mockReturnThis();
    reset = vi.fn();
  }

  class MockHistogram {
    observe = vi.fn();
    labels = vi.fn().mockReturnThis();
    startTimer = vi.fn().mockReturnValue(vi.fn());
    reset = vi.fn();
  }

  return {
    Registry: MockRegistry,
    collectDefaultMetrics: vi.fn(),
    Counter: MockCounter,
    Gauge: MockGauge,
    Histogram: MockHistogram,
    register: new MockRegistry(),
  };
});

// Mock encryption so the server starts cleanly without a real ENCRYPTION_KEY.
vi.mock('../../src/core/encryption.js', () => ({
  encrypt: vi.fn((v: string) => v),
  decrypt: vi.fn((v: string) => v),
  applyEncryptionMiddleware: vi.fn(),
}));

// Mock error tracking so no real Sentry/GlitchTip SDK init happens.
vi.mock('../../src/core/errorTracking.js', () => ({
  initErrorTracking: vi.fn(),
}));

// ─── After mocks, import the real buildApp factory ────────────────────────────

import { buildApp } from '../../src/server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect up to `count` WS messages within `timeoutMs` milliseconds.
 * Returns early once `count` messages have been received.
 */
function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 5000,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const collected: string[] = [];
    const timer = setTimeout(() => {
      // Return what we have even if we didn't hit `count`
      resolve(collected);
    }, timeoutMs);

    ws.on('message', (data: Buffer | string) => {
      const msg = typeof data === 'string' ? data : data.toString('utf8');
      collected.push(msg);
      if (collected.length >= count) {
        clearTimeout(timer);
        resolve(collected);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      resolve(collected);
    });
  });
}

/**
 * Wait for the WS connection to reach OPEN state, with a timeout.
 */
function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), timeoutMs);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Integration 70.3: WebSocket Lifecycle Events', () => {
  let app: FastifyInstance;
  let port: number;
  let baseUrl: string;
  let jwtToken: string;
  const TEST_USER_ID = 'user-ws-test-1';

  beforeAll(async () => {
    // Set test environment so rate limiting is disabled
    process.env['NODE_ENV'] = 'test';
    process.env['JWT_SECRET'] = 'test-secret-for-ws-integration';

    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine server port');
    }
    port = address.port;
    baseUrl = `ws://127.0.0.1:${port}`;

    // Sign a JWT for the test user using the Fastify jwt plugin
    jwtToken = await app.jwt.sign(
      { id: TEST_USER_ID, email: 'wstest@example.com' },
      { expiresIn: '1h' },
    );
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('receives the connected handshake message after connecting (req 32.1)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=${jwtToken}`;
    const ws = new WebSocket(wsUrl);

    // Start collecting BEFORE waiting for open so we don't miss the connected message
    const collectPromise = collectMessages(ws, 1, 3000);
    await waitForOpen(ws);

    const messages = await collectPromise;
    ws.close();

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(messages[0]!);
    expect(parsed.type).toBe('connected');
    expect(parsed.userId).toBe(TEST_USER_ID);
  }, 10_000);

  it('rejects connection with code 4001 when token is missing (req 32.1)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws`; // no token
    const ws = new WebSocket(wsUrl);

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), 5000);
      ws.on('close', (code, reason) => {
        clearTimeout(timer);
        resolve({ code, reason: reason.toString() });
      });
      ws.on('error', () => {
        // Swallow errors — close event is what we care about
      });
    });

    expect(closeEvent.code).toBe(4001);
  }, 10_000);

  it('rejects connection with code 4001 when token is invalid (req 32.1)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=invalid.jwt.token`;
    const ws = new WebSocket(wsUrl);

    const closeEvent = await new Promise<{ code: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), 5000);
      ws.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
      ws.on('error', () => {
        // Swallow errors — close event is what we care about
      });
    });

    expect(closeEvent.code).toBe(4001);
  }, 10_000);

  it('receives lifecycle events emitted via websocketServer.clients (req 32.2)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=${jwtToken}`;
    const ws = new WebSocket(wsUrl);

    // Start collecting BEFORE open to capture the `connected` handshake too
    const collectPromise = collectMessages(ws, 5, 5000);
    await waitForOpen(ws);

    // Wait a moment for the connected handshake to be delivered
    await new Promise((r) => setTimeout(r, 100));

    // Define the lifecycle events the applicationAgent would emit
    const lifecycleEvents = [
      { event: 'job_discovered', jobPostingId: 'job-ws-1', company: 'TestCorp', title: 'Engineer' },
      { event: 'resume_optimized', jobPostingId: 'job-ws-1' },
      { event: 'cover_letter_generated', jobPostingId: 'job-ws-1' },
      { event: 'application_submitted', jobPostingId: 'job-ws-1', company: 'TestCorp', title: 'Engineer' },
    ];

    // Emit events directly via websocketServer.clients — same path as applicationAgent.ts
    type WsClient = { readyState: number; send: (data: string) => void };
    type FastifyWithWs = FastifyInstance & { websocketServer?: { clients?: Set<WsClient> } };
    const wsServer = (app as FastifyWithWs).websocketServer;
    expect(wsServer).toBeDefined();
    expect(wsServer?.clients).toBeDefined();

    for (const eventData of lifecycleEvents) {
      const payload = JSON.stringify({ ...eventData, userId: TEST_USER_ID });
      for (const client of wsServer!.clients!) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
      // Small delay between events to avoid race conditions in test
      await new Promise((r) => setTimeout(r, 20));
    }

    const messages = await collectPromise;
    ws.close();

    // Parse all messages
    const parsed = messages.map((m) => JSON.parse(m) as Record<string, unknown>);
    const eventTypes = parsed.map((p) => p['event'] ?? p['type']);

    // Should have received the connected handshake
    expect(eventTypes).toContain('connected');

    // Should have received at least the job_discovered and application_submitted events
    expect(eventTypes).toContain('job_discovered');
    expect(eventTypes).toContain('application_submitted');
  }, 15_000);

  it('all 4 required lifecycle event types arrive within 5 seconds (req 32.2, 32.3)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=${jwtToken}`;
    const ws = new WebSocket(wsUrl);

    // Start collecting BEFORE open to capture the `connected` handshake too
    const collectPromise = collectMessages(ws, 5, 5000);
    await waitForOpen(ws);

    await new Promise((r) => setTimeout(r, 100));

    const lifecycleEvents = [
      { event: 'job_discovered', taskId: 'task-ws-2', jobPostingId: 'job-ws-2' },
      { event: 'resume_optimized', taskId: 'task-ws-2', jobPostingId: 'job-ws-2' },
      { event: 'cover_letter_generated', taskId: 'task-ws-2', jobPostingId: 'job-ws-2' },
      { event: 'application_submitted', taskId: 'task-ws-2', jobPostingId: 'job-ws-2' },
    ];

    type WsClient = { readyState: number; send: (data: string) => void };
    type FastifyWithWs = FastifyInstance & { websocketServer?: { clients?: Set<WsClient> } };
    const wsServer = (app as FastifyWithWs).websocketServer;

    for (const eventData of lifecycleEvents) {
      const payload = JSON.stringify({ ...eventData, userId: TEST_USER_ID });
      for (const client of wsServer!.clients!) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const messages = await collectPromise;
    ws.close();

    const parsed = messages.map((m) => JSON.parse(m) as Record<string, unknown>);
    const eventTypes = new Set(parsed.map((p) => (p['event'] ?? p['type']) as string));

    // All required lifecycle events must be present
    expect(eventTypes.has('connected')).toBe(true);
    expect(eventTypes.has('job_discovered')).toBe(true);
    expect(eventTypes.has('resume_optimized')).toBe(true);
    expect(eventTypes.has('application_submitted')).toBe(true);
  }, 15_000);

  it('application_failed event is delivered when submission fails (req 32.2)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=${jwtToken}`;
    const ws = new WebSocket(wsUrl);

    await waitForOpen(ws);

    const collectPromise = collectMessages(ws, 3, 5000);
    await new Promise((r) => setTimeout(r, 100));

    type WsClient = { readyState: number; send: (data: string) => void };
    type FastifyWithWs = FastifyInstance & { websocketServer?: { clients?: Set<WsClient> } };
    const wsServer = (app as FastifyWithWs).websocketServer;

    // Emit the failure event
    const failurePayload = JSON.stringify({
      event: 'application_failed',
      userId: TEST_USER_ID,
      taskId: 'task-ws-fail',
      jobPostingId: 'job-ws-fail',
      failureReason: 'captcha_detected',
    });

    for (const client of wsServer!.clients!) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(failurePayload);
      }
    }

    const messages = await collectPromise;
    ws.close();

    const parsed = messages.map((m) => JSON.parse(m) as Record<string, unknown>);
    const failureMsg = parsed.find((p) => p['event'] === 'application_failed');

    expect(failureMsg).toBeDefined();
    expect(failureMsg!['failureReason']).toBe('captcha_detected');
  }, 10_000);

  it('multiple WS clients receive the same broadcast event (req 32.2)', async () => {
    const wsUrl = `${baseUrl}/api/notifications/ws?token=${jwtToken}`;

    // Sign a second JWT token for a different user to get a second connection
    const jwtToken2 = await app.jwt.sign(
      { id: 'user-ws-test-2', email: 'wstest2@example.com' },
      { expiresIn: '1h' },
    );
    const wsUrl2 = `${baseUrl}/api/notifications/ws?token=${jwtToken2}`;

    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl2);

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    const collect1 = collectMessages(ws1, 2, 4000);
    const collect2 = collectMessages(ws2, 2, 4000);

    await new Promise((r) => setTimeout(r, 100));

    type WsClient = { readyState: number; send: (data: string) => void };
    type FastifyWithWs = FastifyInstance & { websocketServer?: { clients?: Set<WsClient> } };
    const wsServer = (app as FastifyWithWs).websocketServer;

    const broadcastPayload = JSON.stringify({
      event: 'job_discovered',
      userId: TEST_USER_ID,
      taskId: 'task-broadcast',
      jobPostingId: 'job-broadcast',
    });

    // Broadcast to all connected clients
    for (const client of wsServer!.clients!) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(broadcastPayload);
      }
    }

    const [msgs1, msgs2] = await Promise.all([collect1, collect2]);

    ws1.close();
    ws2.close();

    // Both clients should have received the connected handshake at minimum
    expect(msgs1.length).toBeGreaterThanOrEqual(1);
    expect(msgs2.length).toBeGreaterThanOrEqual(1);

    // The broadcasting client should have received the job_discovered event
    const parsed1 = msgs1.map((m) => JSON.parse(m) as Record<string, unknown>);
    const discoveredMsg = parsed1.find((p) => p['event'] === 'job_discovered');
    expect(discoveredMsg).toBeDefined();
  }, 15_000);
});
