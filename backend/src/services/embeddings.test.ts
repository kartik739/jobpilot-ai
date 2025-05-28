/**
 * Property-based tests for the embedding service.
 *
 * Property 23: Embedding Dimensionality
 * **Validates: Requirements 27.3**
 *
 * For any non-empty string input, `generateEmbedding` must return an array
 * of exactly 384 numbers.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { generateEmbedding } from './embeddings.js';

describe('Embedding service — Property 23: Embedding Dimensionality', () => {
  it('returns exactly 384 dimensions for any non-empty string input', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (text) => {
        const emb = await generateEmbedding(text);
        return emb.length === 384;
      }),
      { numRuns: 10 },
    );
  }, 120_000); // allow up to 2 min for model load + 10 inference runs
});
