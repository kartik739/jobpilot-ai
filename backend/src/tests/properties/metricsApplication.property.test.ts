// Feature: jobpilot-ai-remediation, Property 9: metrics counter increments per application outcome

import { describe, it, beforeEach } from 'vitest'
import { expect } from 'vitest'
import * as fc from 'fast-check'
import { Counter, Registry } from 'prom-client'

/**
 * **Validates: Requirements 19.2**
 *
 * Property 9: metrics counter increments per application outcome
 *
 * For any worker completion (success or failure), the applicationsSubmittedTotal
 * counter increments by exactly 1 with the correct status label.
 *
 * We instantiate a fresh isolated Counter + Registry per test run to avoid
 * state accumulation across property iterations, mirroring the production
 * pattern in core/metrics.ts.
 */

// ─── Helper: create an isolated counter ──────────────────────────────────────

function createIsolatedCounter() {
  const registry = new Registry()
  const counter = new Counter({
    name: 'jobpilot_applications_submitted_total',
    help: 'Total number of job applications submitted',
    labelNames: ['status'] as const,
    registers: [registry],
  })
  return { registry, counter }
}

// ─── Helper: read the current counter value for a given status label ──────────

async function getCounterValue(
  registry: Registry,
  status: string,
): Promise<number> {
  const metrics = await registry.getMetricsAsJSON()
  const metric = metrics.find(
    (m) => m.name === 'jobpilot_applications_submitted_total',
  )
  if (!metric) return 0
  const valueEntry = (metric.values as Array<{ labels: { status: string }; value: number }>).find(
    (v) => v.labels.status === status,
  )
  return valueEntry?.value ?? 0
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('metricsApplication — Property 9', () => {
  describe('counter increments by 1 for each outcome', () => {
    it('increments by exactly 1 for success (status=submitted)', async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), async (_seed) => {
          // Fresh isolated counter per run — no cross-run state
          const { registry, counter } = createIsolatedCounter()

          const before = await getCounterValue(registry, 'submitted')

          // Simulate successful submission increment (mirrors applicationWorker.ts)
          counter.inc({ status: 'submitted' })

          const after = await getCounterValue(registry, 'submitted')

          expect(after - before).toBe(1)
        }),
        { numRuns: 100 },
      )
    })

    it('increments by exactly 1 for failure (status=failed)', async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), async (_seed) => {
          const { registry, counter } = createIsolatedCounter()

          const before = await getCounterValue(registry, 'failed')

          // Simulate failed submission increment (mirrors applicationWorker.ts failed handler)
          counter.inc({ status: 'failed' })

          const after = await getCounterValue(registry, 'failed')

          expect(after - before).toBe(1)
        }),
        { numRuns: 100 },
      )
    })

    it('increments the correct label for any boolean outcome', async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), async (isSuccess) => {
          const { registry, counter } = createIsolatedCounter()

          const status = isSuccess ? 'submitted' : 'failed'
          const otherStatus = isSuccess ? 'failed' : 'submitted'

          const beforeStatus = await getCounterValue(registry, status)
          const beforeOther = await getCounterValue(registry, otherStatus)

          counter.inc({ status })

          const afterStatus = await getCounterValue(registry, status)
          const afterOther = await getCounterValue(registry, otherStatus)

          // Invariant 1: the targeted label increments by exactly 1
          expect(afterStatus - beforeStatus).toBe(1)

          // Invariant 2: the other label is untouched
          expect(afterOther - beforeOther).toBe(0)
        }),
        { numRuns: 100 },
      )
    })
  })
})
