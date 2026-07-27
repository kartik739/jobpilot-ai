// Feature: jobpilot-ai-remediation, Property 3: CORS origin enforcement
// Validates: Requirements 7.1, 7.4, 7.5

/**
 * **Validates: Requirements 7.1, 7.4, 7.5**
 *
 * Property 3: CORS origin enforcement
 *
 * For any request origin equal to FRONTEND_ORIGIN, the response must include
 * an `Access-Control-Allow-Origin` header echoing that origin back.
 * For any non-matching origin, the `Access-Control-Allow-Origin` header must
 * NOT echo the request's origin (i.e. the origin is rejected by CORS policy).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { vi } from 'vitest'
import * as fc from 'fast-check'
import type { FastifyInstance } from 'fastify'

// ── Environment must be set before any modules are imported ──────────────────
const ALLOWED_ORIGIN = 'http://localhost:3002'
process.env['FRONTEND_ORIGIN'] = ALLOWED_ORIGIN
process.env['NODE_ENV'] = 'test'
process.env['JWT_SECRET'] = 'test-secret'
process.env['REDIS_URL'] = 'redis://localhost:6379'
process.env['ENCRYPTION_KEY'] = Buffer.alloc(32).toString('base64')

// ── Mock heavy side-effectful dependencies ───────────────────────────────────

vi.mock('@prisma/client', () => {
  class MockPrismaClient {
    user = { findUnique: vi.fn(), create: vi.fn() }
    $connect = vi.fn()
    $disconnect = vi.fn()
  }
  return { PrismaClient: MockPrismaClient }
})

vi.mock('../../db.js', () => ({ prisma: {} }))

vi.mock('ioredis', () => {
  class Redis {
    get = vi.fn().mockResolvedValue(null)
    set = vi.fn().mockResolvedValue('OK')
    del = vi.fn().mockResolvedValue(1)
    quit = vi.fn().mockResolvedValue('OK')
    disconnect = vi.fn()
    subscribe = vi.fn().mockResolvedValue(undefined)
    unsubscribe = vi.fn().mockResolvedValue(undefined)
    on = vi.fn()
    publish = vi.fn().mockResolvedValue(0)
  }
  return { Redis, default: Redis }
})

vi.mock('bullmq', () => {
  class Queue {
    constructor() {}
    add = vi.fn().mockResolvedValue({ id: 'mock-job-id' })
    close = vi.fn().mockResolvedValue(undefined)
    getJobs = vi.fn().mockResolvedValue([])
    getJobCounts = vi.fn().mockResolvedValue({ waiting: 0, active: 0 })
  }
  class Worker {
    constructor() {}
    close = vi.fn().mockResolvedValue(undefined)
    on = vi.fn()
  }
  return { Queue, Worker }
})

vi.mock('../../core/errorTracking.js', () => ({
  initErrorTracking: vi.fn(),
}))

// ── Test suite ────────────────────────────────────────────────────────────────

describe('CORS origin enforcement — Property 3', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../../server.js')
    app = await buildApp({ logger: false })
    await app.ready()
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  /**
   * Property: when the request origin matches FRONTEND_ORIGIN exactly,
   * the response MUST include Access-Control-Allow-Origin echoing that origin.
   */
  it('matching origin receives Access-Control-Allow-Origin header', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Always use the allowed origin — should always get CORS header back
        fc.constant(ALLOWED_ORIGIN),
        async (origin) => {
          const response = await app.inject({
            method: 'GET',
            url: '/health',
            headers: { origin },
          })
          expect(response.headers['access-control-allow-origin']).toBe(origin)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * Property: when the request origin does NOT match FRONTEND_ORIGIN,
   * the response MUST NOT echo the request origin in Access-Control-Allow-Origin.
   * @fastify/cors either omits the header or sets it to the configured origin —
   * in either case it must not be the non-matching request origin.
   */
  it('non-matching origin does not receive Access-Control-Allow-Origin echoing the request origin', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl().filter((url) => url !== ALLOWED_ORIGIN),
        async (origin) => {
          const response = await app.inject({
            method: 'GET',
            url: '/health',
            headers: { origin },
          })
          // For non-matching origins, the CORS header must NOT be set to the request origin
          expect(response.headers['access-control-allow-origin']).not.toBe(origin)
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * Deterministic spot-check: a clearly different origin is rejected.
   */
  it('a clearly different origin is not reflected in Access-Control-Allow-Origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.example.com' },
    })
    expect(response.headers['access-control-allow-origin']).not.toBe('http://evil.example.com')
  })

  /**
   * Deterministic spot-check: the allowed origin is accepted.
   */
  it('the configured FRONTEND_ORIGIN is accepted with correct CORS header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED_ORIGIN },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
  })
})
