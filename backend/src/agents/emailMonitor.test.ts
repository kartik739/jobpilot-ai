/**
 * Property 18: Email Classification Safe Fallback
 * Validates: Requirements 16.4
 *
 * When the LLM is unavailable (throws on every call), processing any arbitrary
 * email must:
 *   1. Return a classification with `type === 'other'` and `confidence === 0`
 *   2. Never update application status (no Prisma writes occur)
 *   3. Never throw an unhandled exception
 *
 * The test wires the LLM stub directly into `processEmail` and asserts on the
 * safe-fallback contract defined in Req 16.4.  It also exercises the higher-
 * level `processAndUpdateFromEmail` to assert that no status updates are
 * triggered as a consequence of the fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type OpenAI from 'openai';

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Silence logger output during tests
vi.mock('../core/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the Gmail integration module (not needed for processEmail/processAndUpdateFromEmail)
vi.mock('../integrations/gmail.js', () => ({
  getOAuth2Client: vi.fn(),
  handleGmailAuthExpired: vi.fn(),
  GmailAuthError: class GmailAuthError extends Error {
    readonly name = 'GmailAuthError' as const;
  },
}));

// Mock the default Prisma client — we need to spy on whether it is ever called.
// The factory must be self-contained (hoisted); we retrieve the spy handles
// afterwards via vi.mocked() / the imported mock.
vi.mock('../db.js', () => ({
  prisma: {
    applicationRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    statusTransition: {
      create: vi.fn(),
    },
  },
}));

// Import the functions under test AFTER mocks are registered
import {
  processEmail,
  processAndUpdateFromEmail,
  type GmailMessage,
} from './emailMonitor.js';
import { prisma } from '../db.js';

// ─── LLM stub factory ─────────────────────────────────────────────────────────

/**
 * Build a minimal OpenAI-compatible client stub whose `chat.completions.create`
 * always rejects with a network-style error, simulating LLM unavailability.
 */
function makeUnavailableLlmClient(errorMessage = 'LLM service unavailable'): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error(errorMessage)),
      },
    },
  } as unknown as OpenAI;
}

/**
 * Build a stub that returns a malformed (non-JSON) response, another form of
 * LLM failure that should also produce the safe fallback.
 */
function makeMalformedLlmClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'this is NOT valid JSON }{' } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

/**
 * Build a stub that returns an empty `content` field, yet another edge case.
 */
function makeEmptyResponseLlmClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: null } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates an arbitrary GmailMessage representing a recruitment email.
 * All fields are arbitrary strings so the property holds for any input shape.
 */
const arbGmailMessage: fc.Arbitrary<GmailMessage> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 40 }),
  threadId: fc.string({ minLength: 0, maxLength: 40 }),
  subject: fc.string({ minLength: 0, maxLength: 200 }),
  from: fc.emailAddress(),
  body: fc.string({ minLength: 0, maxLength: 2000 }),
  receivedAt: fc.date(),
});

// ─── Unit tests — specific failure modes ─────────────────────────────────────

describe('processEmail — safe fallback on LLM unavailability (Req 16.4)', () => {
  it('returns type="other" and confidence=0 when LLM throws', async () => {
    const email: GmailMessage = {
      id: 'msg-001',
      threadId: 'thread-001',
      subject: 'Exciting opportunity at Acme!',
      from: 'recruiter@acme.com',
      body: 'We would like to invite you to an interview...',
      receivedAt: new Date(),
    };

    const result = await processEmail(email, makeUnavailableLlmClient());

    expect(result.type).toBe('other');
    expect(result.confidence).toBe(0);
  });

  it('returns type="other" and confidence=0 when LLM returns malformed JSON', async () => {
    const email: GmailMessage = {
      id: 'msg-002',
      threadId: 'thread-002',
      subject: 'Interview invitation from Beta Corp',
      from: 'hr@betacorp.io',
      body: 'Congratulations! We want to schedule a call.',
      receivedAt: new Date(),
    };

    const result = await processEmail(email, makeMalformedLlmClient());

    expect(result.type).toBe('other');
    expect(result.confidence).toBe(0);
  });

  it('returns type="other" and confidence=0 when LLM returns empty content', async () => {
    const email: GmailMessage = {
      id: 'msg-003',
      threadId: 'thread-003',
      subject: 'Application update',
      from: 'noreply@company.com',
      body: 'Your application status has been updated.',
      receivedAt: new Date(),
    };

    const result = await processEmail(email, makeEmptyResponseLlmClient());

    expect(result.type).toBe('other');
    expect(result.confidence).toBe(0);
  });

  it('does not throw even when LLM throws synchronously', async () => {
    const email: GmailMessage = {
      id: 'msg-004',
      threadId: 'thread-004',
      subject: 'Job offer',
      from: 'talent@startup.co',
      body: 'We are pleased to extend an offer.',
      receivedAt: new Date(),
    };

    const syncThrowingClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            throw new TypeError('Cannot read properties of undefined');
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(processEmail(email, syncThrowingClient)).resolves.toMatchObject({
      type: 'other',
      confidence: 0,
    });
  });
});

// ─── Property 18: Email Classification Safe Fallback ─────────────────────────
// **Validates: Requirements 16.4**

describe('Property 18: Email Classification Safe Fallback (Req 16.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.applicationRecord.findMany).mockResolvedValue([]);
  });

  it(
    'processEmail: type === "other" AND confidence === 0 for any email when LLM is unavailable',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbGmailMessage, async (email) => {
          const result = await processEmail(email, makeUnavailableLlmClient());
          expect(result.type).toBe('other');
          expect(result.confidence).toBe(0);
        }),
        { numRuns: 200 },
      );
    },
  );

  it(
    'processEmail: type === "other" AND confidence === 0 for any email when LLM returns malformed JSON',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbGmailMessage, async (email) => {
          const result = await processEmail(email, makeMalformedLlmClient());
          expect(result.type).toBe('other');
          expect(result.confidence).toBe(0);
        }),
        { numRuns: 200 },
      );
    },
  );

  it(
    'processEmail: type === "other" AND confidence === 0 for any email when LLM returns empty content',
    async () => {
      await fc.assert(
        fc.asyncProperty(arbGmailMessage, async (email) => {
          const result = await processEmail(email, makeEmptyResponseLlmClient());
          expect(result.type).toBe('other');
          expect(result.confidence).toBe(0);
        }),
        { numRuns: 200 },
      );
    },
  );

  it(
    'processEmail: never throws for any email regardless of LLM failure mode',
    async () => {
      const failureModes = [
        makeUnavailableLlmClient(),
        makeMalformedLlmClient(),
        makeEmptyResponseLlmClient(),
      ];

      await fc.assert(
        fc.asyncProperty(
          arbGmailMessage,
          fc.integer({ min: 0, max: failureModes.length - 1 }),
          async (email, modeIndex) => {
            const client = failureModes[modeIndex]!;
            await expect(processEmail(email, client)).resolves.toBeDefined();
          },
        ),
        { numRuns: 200 },
      );
    },
  );

  it(
    'processAndUpdateFromEmail: no application status updates occur when LLM is unavailable',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbGmailMessage,
          fc.uuid(), // userId
          async (email, userId) => {
            // Reset spy call counts for this iteration
            vi.mocked(prisma.applicationRecord.update).mockClear();
            vi.mocked(prisma.statusTransition.create).mockClear();

            const { classification, updated } = await processAndUpdateFromEmail(
              email,
              userId,
              makeUnavailableLlmClient(),
              // No prismaClient override needed — the module-level mock covers it
              undefined,
            );

            // Fallback classification asserted
            expect(classification.type).toBe('other');
            expect(classification.confidence).toBe(0);

            // Pipeline must report no update was made
            expect(updated).toBe(false);

            // No Prisma writes must have occurred
            expect(vi.mocked(prisma.applicationRecord.update)).not.toHaveBeenCalled();
            expect(vi.mocked(prisma.statusTransition.create)).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'processAndUpdateFromEmail: updated === false for all emails when LLM is unavailable',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbGmailMessage,
          fc.uuid(),
          async (email, userId) => {
            const { updated } = await processAndUpdateFromEmail(
              email,
              userId,
              makeUnavailableLlmClient(),
              undefined,
            );

            return updated === false;
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'processAndUpdateFromEmail: extractedEntities is always a plain object when LLM fails',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          arbGmailMessage,
          fc.uuid(),
          async (email, userId) => {
            const { classification } = await processAndUpdateFromEmail(
              email,
              userId,
              makeUnavailableLlmClient(),
              undefined,
            );

            expect(typeof classification.extractedEntities).toBe('object');
            expect(classification.extractedEntities).not.toBeNull();
            expect(Array.isArray(classification.extractedEntities)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
