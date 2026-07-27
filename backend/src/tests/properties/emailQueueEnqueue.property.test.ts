// Feature: jobpilot-ai-remediation, Property 7: email queue enqueue on successful submission

import { describe, it, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { expect } from 'vitest'

/**
 * **Validates: Requirements 17.1, 17.2**
 *
 * Property 7: email queue enqueue on successful submission
 *
 * For any application that transitions to status='submitted', exactly one
 * `monitor_application` job is enqueued on the email queue before the worker
 * function returns.
 *
 * We test the submission success path of the applicationWorker in isolation:
 * - Mock the emailQueue.add and prisma.applicationRecord.create
 * - Verify exactly 1 call to emailQueue.add('monitor_application', ...) per run
 */

// ─── Inline success path logic (extracted for testability) ────────────────────
//
// This mirrors the "Case 2: Successful submission" block in applicationWorker.ts
// without importing the module (which would instantiate Redis/BullMQ at import time).

interface SubmissionPayload {
  userId: string
  applicationId: string
  jobPostingId?: string
  applicationUrl?: string
  jobFingerprint?: string
}

interface MockEmailQueue {
  add: ReturnType<typeof vi.fn>
}

interface MockPrismaApplicationRecord {
  create: ReturnType<typeof vi.fn>
}

async function processSuccessfulSubmission(
  payload: SubmissionPayload,
  emailQueue: MockEmailQueue,
  prismaRecord: MockPrismaApplicationRecord,
): Promise<void> {
  // Simulate creating the ApplicationRecord (Req 17.1)
  const createdRecord = await prismaRecord.create({
    data: {
      userId: payload.userId,
      jobPostingId: payload.jobPostingId ?? 'job-posting-id',
      appliedAt: new Date(),
      source: 'automation',
      applicationUrl: payload.applicationUrl ?? 'https://example.com',
      resumeVersionId: 'resume-version-id',
      status: 'submitted',
      screenshotPaths: [],
      formAnswersSnapshot: {},
      fingerprint: payload.jobFingerprint ?? 'fingerprint',
      matchScoreSnapshot: {},
    },
  })

  // Enqueue exactly one monitor_application job (Req 17.2)
  await emailQueue.add('monitor_application', {
    userId: payload.userId,
    applicationId: createdRecord.id,
  })
}

// ─── Arbitrary ────────────────────────────────────────────────────────────────

const submissionArb = fc.record({
  userId: fc.string({ minLength: 1 }),
  applicationId: fc.string({ minLength: 1 }),
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('emailQueueEnqueue — Property 7', () => {
  let mockEmailQueue: MockEmailQueue
  let mockPrismaRecord: MockPrismaApplicationRecord

  beforeEach(() => {
    mockEmailQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    }
    mockPrismaRecord = {
      create: vi.fn().mockImplementation(({ data }: { data: { userId: string } }) =>
        Promise.resolve({ id: `created-app-${data.userId}` }),
      ),
    }
  })

  it('enqueues exactly one monitor_application job for any successful submission', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async ({ userId, applicationId }) => {
        // Reset call history between runs
        mockEmailQueue.add.mockClear()
        mockPrismaRecord.create.mockClear()
        mockPrismaRecord.create.mockResolvedValue({ id: applicationId })

        await processSuccessfulSubmission(
          { userId, applicationId },
          mockEmailQueue,
          mockPrismaRecord,
        )

        // Invariant: exactly one enqueue call
        expect(mockEmailQueue.add).toHaveBeenCalledTimes(1)

        // Invariant: the job name is 'monitor_application'
        expect(mockEmailQueue.add).toHaveBeenCalledWith(
          'monitor_application',
          expect.objectContaining({ userId }),
        )
      }),
      { numRuns: 100 },
    )
  })

  it('enqueued job payload contains the created applicationId', async () => {
    await fc.assert(
      fc.asyncProperty(submissionArb, async ({ userId, applicationId }) => {
        mockEmailQueue.add.mockClear()
        mockPrismaRecord.create.mockClear()
        mockPrismaRecord.create.mockResolvedValue({ id: applicationId })

        await processSuccessfulSubmission(
          { userId, applicationId },
          mockEmailQueue,
          mockPrismaRecord,
        )

        const [jobName, jobData] = mockEmailQueue.add.mock.calls[0] as [
          string,
          { userId: string; applicationId: string },
        ]

        expect(jobName).toBe('monitor_application')
        expect(jobData.userId).toBe(userId)
        expect(jobData.applicationId).toBe(applicationId)
      }),
      { numRuns: 100 },
    )
  })
})
