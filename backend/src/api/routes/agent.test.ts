/**
 * Property-based tests for the Profile Completeness Automation Gate
 *
 * **Property 2: Profile Completeness Automation Gate**
 * **Validates: Requirements 2.4, 2.5**
 *
 * Properties tested:
 *   P2 — Profiles scoring ≥ 70 (≥7 of 9 sections satisfied) pass the gate;
 *        profiles scoring < 70 (< 7 of 9 sections) are rejected.
 *
 * HTTP-level tests additionally confirm the POST /api/agent/start route
 * returns HTTP 422 for low-completeness profiles and HTTP 200 for sufficient
 * completeness profiles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';

// ─── Mock side-effect modules BEFORE any route/service imports ────────────────

vi.mock('../../db.js', () => ({ prisma: {} }));
vi.mock('../../workers/queue.js', () => ({
  discoveryQueue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/applyLimiter.js', () => ({
  pauseAutomation: vi.fn(),
  resumeAutomation: vi.fn(),
  isAutomationPaused: vi.fn().mockResolvedValue(false),
  getTodayApplicationCount: vi.fn().mockResolvedValue(0),
  DAILY_LIMIT_DEFAULT: 10,
}));
vi.mock('../../core/logger.js', () => ({
  logger: {
    child: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
  createChildLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { computeCompleteness, MINIMUM_COMPLETENESS } from '../../services/completeness.js';
import type { CompletenessProfile } from '../../services/completeness.js';

// ─── Profile building helpers ─────────────────────────────────────────────────

/**
 * The 9 sections in the order computeCompleteness evaluates them.
 * Each entry is a key and the satisfied value to inject into a profile.
 */
const ALL_SECTIONS = [
  { key: 'fullName', value: 'Jane Doe' },
  { key: 'email', value: 'jane@example.com' },
  { key: 'phone', value: '555-1234' },
  { key: 'location', value: 'NYC' },
  { key: 'workExperiences', value: [{}] },
  { key: 'skills', value: [{}] },
  { key: 'workAuthorization', value: ['US'] },
  { key: 'targetRoles', value: ['SWE'] },
  { key: 'preferredLocations', value: ['Remote'] },
] as const;

/**
 * Build a CompletenessProfile that satisfies exactly `n` of the 9 sections.
 * The first `n` sections from ALL_SECTIONS are populated; the rest are omitted.
 */
function buildProfileWithNSections(n: number): CompletenessProfile {
  const profile: Record<string, unknown> = {};
  for (let i = 0; i < n && i < ALL_SECTIONS.length; i++) {
    const section = ALL_SECTIONS[i]!;
    profile[section.key] = section.value;
  }
  return profile as CompletenessProfile;
}

// ─── Expected score for n satisfied sections ──────────────────────────────────
// Math.round((n / 9) * 100)
function expectedScore(n: number): number {
  return Math.round((n / 9) * 100);
}

// ─── Section 1: Deterministic boundary tests ──────────────────────────────────

describe('Profile completeness gate — deterministic boundary checks', () => {
  it('score = 0 for 0 satisfied sections → rejected (< 70)', () => {
    const profile = buildProfileWithNSections(0);
    const score = computeCompleteness(profile);
    expect(score).toBe(0);
    expect(score).toBeLessThan(MINIMUM_COMPLETENESS);
  });

  it('score = 67 for 6 satisfied sections → rejected (< 70)', () => {
    // Math.round(6/9 * 100) = 67
    const profile = buildProfileWithNSections(6);
    const score = computeCompleteness(profile);
    expect(score).toBe(67);
    expect(score).toBeLessThan(MINIMUM_COMPLETENESS);
  });

  it('score = 78 for 7 satisfied sections → accepted (≥ 70)', () => {
    // Math.round(7/9 * 100) = 78
    const profile = buildProfileWithNSections(7);
    const score = computeCompleteness(profile);
    expect(score).toBe(78);
    expect(score).toBeGreaterThanOrEqual(MINIMUM_COMPLETENESS);
  });

  it('score = 100 for all 9 satisfied sections → accepted (≥ 70)', () => {
    const profile = buildProfileWithNSections(9);
    const score = computeCompleteness(profile);
    expect(score).toBe(100);
    expect(score).toBeGreaterThanOrEqual(MINIMUM_COMPLETENESS);
  });

  it('MINIMUM_COMPLETENESS constant is 70', () => {
    expect(MINIMUM_COMPLETENESS).toBe(70);
  });

  it('sections 0–6 all produce scores below threshold', () => {
    for (let n = 0; n <= 6; n++) {
      const score = expectedScore(n);
      expect(score).toBeLessThan(70);
    }
  });

  it('sections 7–9 all produce scores at or above threshold', () => {
    for (let n = 7; n <= 9; n++) {
      const score = expectedScore(n);
      expect(score).toBeGreaterThanOrEqual(70);
    }
  });
});

// ─── Section 2: Property 2 — Profile Completeness Automation Gate ─────────────
// **Validates: Requirements 2.4, 2.5**

describe('Property 2: Profile Completeness Automation Gate (Req 2.4, 2.5)', () => {
  /**
   * P2a — For any profile with < 7 satisfied sections, computeCompleteness
   * returns a score < 70, meaning the gate must reject it (Req 2.4).
   */
  it('P2a — profiles with < 7 satisfied sections always score below 70 → gate rejects', () => {
    fc.assert(
      // Generate a count of satisfied sections in [0, 6]
      fc.property(fc.integer({ min: 0, max: 6 }), (sectionCount) => {
        const profile = buildProfileWithNSections(sectionCount);
        const score = computeCompleteness(profile);
        // The gate condition: score < MINIMUM_COMPLETENESS means rejected
        return score < MINIMUM_COMPLETENESS;
      }),
      { numRuns: 500 },
    );
  });

  /**
   * P2b — For any profile with ≥ 7 satisfied sections, computeCompleteness
   * returns a score ≥ 70, meaning the gate must accept it (Req 2.5).
   */
  it('P2b — profiles with ≥ 7 satisfied sections always score ≥ 70 → gate accepts', () => {
    fc.assert(
      // Generate a count of satisfied sections in [7, 9]
      fc.property(fc.integer({ min: 7, max: 9 }), (sectionCount) => {
        const profile = buildProfileWithNSections(sectionCount);
        const score = computeCompleteness(profile);
        // The gate condition: score >= MINIMUM_COMPLETENESS means accepted
        return score >= MINIMUM_COMPLETENESS;
      }),
      { numRuns: 300 },
    );
  });

  /**
   * P2c — The gate is monotone: adding more satisfied sections never lowers
   * the score below that of fewer satisfied sections.
   */
  it('P2c — score is monotonically non-decreasing as section count increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 9 }),
        (lower, delta) => {
          const higher = Math.min(lower + delta, 9);
          const scoreLower = computeCompleteness(buildProfileWithNSections(lower));
          const scoreHigher = computeCompleteness(buildProfileWithNSections(higher));
          return scoreHigher >= scoreLower;
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * P2d — The gate classification is binary and exhaustive: every possible
   * section count (0–9) yields either "rejected" or "accepted", never ambiguous.
   * Rejected iff score < 70; accepted iff score >= 70.
   */
  it('P2d — every section count maps to exactly one gate decision (no ambiguity)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (sectionCount) => {
        const score = computeCompleteness(buildProfileWithNSections(sectionCount));
        const rejected = score < MINIMUM_COMPLETENESS;
        const accepted = score >= MINIMUM_COMPLETENESS;
        // Exactly one of these must be true
        return rejected !== accepted;
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Section 3: HTTP-level tests ──────────────────────────────────────────────

/**
 * Build a minimal Fastify test app with agentRoutes registered.
 * Prisma's `profile.findUnique` is mocked to return the given profile data.
 */
async function buildAgentTestApp(prismaProfileOverride?: Record<string, unknown> | null): Promise<FastifyInstance> {
  const { prisma } = await import('../../db.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as unknown as Record<string, any>;

  p['profile'] = {
    findUnique: vi.fn().mockResolvedValue(prismaProfileOverride ?? null),
  };

  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: 'test-secret' });

  const { agentRoutes } = await import('./agent.js');

  const redisMock = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(agentRoutes, { redis: redisMock as any });
  await app.ready();

  return app;
}

/** Sign a JWT for a given userId */
function signToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ id: userId, email: 'test@example.com' });
}

describe('POST /api/agent/start — HTTP-level completeness gate (Req 2.4, 2.5)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ── Low completeness → 422 ────────────────────────────────────────────────

  it('returns 422 when profile is null (0 sections satisfied → score = 0)', async () => {
    const app = await buildAgentTestApp(null);
    const token = signToken(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('Profile completeness below minimum threshold');
    expect(body.completeness).toBe(0);
    expect(body.required).toBe(70);
    await app.close();
  });

  it('returns 422 when only 6 of 9 sections are satisfied (score = 67)', async () => {
    // fullName, email, phone, location, 1 workExperience, 1 skill → 6 sections → score 67
    const app = await buildAgentTestApp({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      location: 'NYC',
      workAuthorization: [],
      targetRoles: [],
      preferredLocations: [],
      workExperiences: [{ id: 'we-1' }],
      skills: [{ id: 'sk-1' }],
    });
    const token = signToken(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.completeness).toBe(67);
    expect(body.required).toBe(70);
    await app.close();
  });

  // ── Sufficient completeness → 200 ─────────────────────────────────────────

  it('returns 200 when 7 of 9 sections are satisfied (score = 78)', async () => {
    // fullName, email, phone, location, workExperiences, skills, workAuthorization → 7 sections → score 78
    const app = await buildAgentTestApp({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      location: 'NYC',
      workAuthorization: ['US'],
      targetRoles: [],
      preferredLocations: [],
      workExperiences: [{ id: 'we-1' }],
      skills: [{ id: 'sk-1' }],
    });
    const token = signToken(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.started).toBe(true);
    expect(body.completeness).toBe(78);
    await app.close();
  });

  it('returns 200 when all 9 sections are satisfied (score = 100)', async () => {
    const app = await buildAgentTestApp({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      location: 'NYC',
      workAuthorization: ['US'],
      targetRoles: ['SWE'],
      preferredLocations: ['Remote'],
      workExperiences: [{ id: 'we-1' }],
      skills: [{ id: 'sk-1' }],
    });
    const token = signToken(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.started).toBe(true);
    expect(body.completeness).toBe(100);
    await app.close();
  });

  // ── Unauthenticated → 401 ─────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const app = await buildAgentTestApp(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  // ── 422 response body structure is correct ───────────────────────────────

  it('422 response body contains error, completeness, and required fields', async () => {
    const app = await buildAgentTestApp(null); // score = 0
    const token = signToken(app, 'user-1');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/start',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('completeness');
    expect(body).toHaveProperty('required');
    expect(typeof body.completeness).toBe('number');
    expect(body.required).toBe(MINIMUM_COMPLETENESS);
    await app.close();
  });
});
