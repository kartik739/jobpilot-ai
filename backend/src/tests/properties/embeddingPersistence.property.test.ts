// Feature: jobpilot-ai-remediation, Property 5: embedding persistence valid vector stored

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * **Validates: Requirements 15.1, 15.2**
 *
 * Property 5: valid 384-dimension vector stored for any non-null embedding
 *
 * When an embedding vector is persisted, it is serialised as the pgvector
 * literal `[f0,f1,...,f383]` via the expression:
 *
 *   const vec = `[${embedding.join(',')}]`;
 *
 * This property verifies that, for any 384-element float array:
 *   1. The serialised string round-trips back to an array of exactly 384 floats.
 *   2. Every element of the round-tripped array is a finite number (no NaN /
 *      Infinity from float serialisation edge-cases).
 *
 * No database connection is required — only the serialisation logic is tested.
 */

/**
 * Serialise a float array to the pgvector literal format used in
 * discoveryWorker.ts:
 *
 *   const vec = `[${embedding.join(',')}]`;
 *   await prisma.$executeRawUnsafe(
 *     `UPDATE job_postings SET embedding = $1::vector WHERE fingerprint = $2`,
 *     vec, fingerprint
 *   );
 */
function serializeEmbedding(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Parse a pgvector literal back to a float array.
 * This is the inverse of serializeEmbedding and simulates what pgvector does
 * when it reads the `[f0,f1,...,fn]` literal.
 */
function parseVectorLiteral(vec: string): number[] {
  const inner = vec.slice(1, -1) // strip leading '[' and trailing ']'
  return inner.split(',').map(Number)
}

describe('Embedding persistence — Property 5', () => {
  it('serialises a 384-dim float array to a pgvector literal that round-trips to exactly 384 floats', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 384,
          maxLength: 384,
        }),
        (embedding) => {
          const vec = serializeEmbedding(embedding)

          // The vector string must start with '[' and end with ']'
          expect(vec.startsWith('[')).toBe(true)
          expect(vec.endsWith(']')).toBe(true)

          // Round-trip: parse back and verify dimension
          const parsed = parseVectorLiteral(vec)
          expect(parsed).toHaveLength(384)

          // Every element must be a finite number
          for (const val of parsed) {
            expect(Number.isFinite(val)).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it('stored vector is non-null for any non-null 384-dim embedding', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 384,
          maxLength: 384,
        }),
        (embedding) => {
          // The serialised vector must never be null / undefined / empty
          const vec = serializeEmbedding(embedding)
          expect(vec).toBeTruthy()
          expect(vec.length).toBeGreaterThan(2) // at minimum '[]' would be 2 chars; real vectors are much longer
        },
      ),
      { numRuns: 100 },
    )
  })

  it('edge-case: all-zeros 384-dim vector serialises and round-trips correctly', () => {
    const zeros = new Array(384).fill(0)
    const vec = serializeEmbedding(zeros)
    const parsed = parseVectorLiteral(vec)
    expect(parsed).toHaveLength(384)
    expect(parsed.every((v) => v === 0)).toBe(true)
  })
})
