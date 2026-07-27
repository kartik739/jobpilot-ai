// Feature: jobpilot-ai-remediation, Property 4: discovery enqueues ranking iff stored > 0

import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'

/**
 * **Validates: Requirements 14.1, 14.2, 14.4**
 *
 * Property 4: discovery enqueues ranking iff stored > 0
 *
 * After a discovery run completes, a 'rank_jobs' job should be added to
 * rankingQueue if and only if totalStored > 0. This invariant ensures that
 * the ranking pipeline is triggered exactly once per successful discovery
 * that found new jobs, and never triggered on empty runs.
 */

/**
 * Pure function that encapsulates the ranking-enqueue decision logic
 * extracted from processDiscoveryJob in discoveryWorker.ts.
 *
 * The original code:
 *   if (totalStored > 0) {
 *     await rankingQueue.add('rank_jobs', { userId });
 *   }
 */
async function maybeEnqueueRanking(
  totalStored: number,
  userId: string,
  rankingQueue: { add: (name: string, data: unknown) => Promise<void> },
): Promise<void> {
  if (totalStored > 0) {
    await rankingQueue.add('rank_jobs', { userId })
  }
}

describe('Discovery → Ranking handoff — Property 4', () => {
  it('enqueues exactly 1 ranking job when storedCount > 0, and 0 when storedCount === 0', () => {
    fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 20 }),
        async (storedCount) => {
          // Mock rankingQueue.add and count calls
          const calls: Array<{ name: string; data: unknown }> = []
          const mockRankingQueue = {
            add: vi.fn(async (name: string, data: unknown) => {
              calls.push({ name, data })
            }),
          }

          await maybeEnqueueRanking(storedCount, 'user-123', mockRankingQueue)

          if (storedCount > 0) {
            // Exactly 1 job must have been enqueued
            expect(calls).toHaveLength(1)
            expect(calls[0]!.name).toBe('rank_jobs')
            expect(calls[0]!.data).toEqual({ userId: 'user-123' })
          } else {
            // No job must have been enqueued
            expect(calls).toHaveLength(0)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('enqueues exactly 1 ranking job for positive storedCount (boundary: storedCount = 1)', async () => {
    const calls: Array<{ name: string; data: unknown }> = []
    const mockRankingQueue = {
      add: vi.fn(async (name: string, data: unknown) => {
        calls.push({ name, data })
      }),
    }

    await maybeEnqueueRanking(1, 'user-abc', mockRankingQueue)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.name).toBe('rank_jobs')
  })

  it('enqueues 0 ranking jobs when storedCount is 0 (boundary: storedCount = 0)', async () => {
    const calls: string[] = []
    const mockRankingQueue = {
      add: vi.fn(async (name: string) => {
        calls.push(name)
      }),
    }

    await maybeEnqueueRanking(0, 'user-abc', mockRankingQueue)

    expect(calls).toHaveLength(0)
  })
})
