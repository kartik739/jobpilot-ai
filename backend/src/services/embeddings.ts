/**
 * Embedding Service
 *
 * Loads the Xenova/all-MiniLM-L6-v2 feature-extraction model once at module
 * load (lazy singleton) and exposes a single public function for generating
 * 384-dimensional sentence embeddings.
 *
 * Requirements: 6.4, 6.6, 27.2, 27.3
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { createChildLogger } from '../core/logger.js';

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = createChildLogger({ component: 'embeddings' });

// ─── Model constants ──────────────────────────────────────────────────────────

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

// ─── Lazy singleton pipeline ──────────────────────────────────────────────────

/**
 * Module-level promise that resolves to the loaded pipeline.
 * Initialised on first call to `getPipeline()` so the model is not loaded
 * unless embeddings are actually requested.
 */
let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipelinePromise === null) {
    log.info({ model: MODEL_NAME }, 'Loading embedding pipeline (first use)');
    _pipelinePromise = pipeline('feature-extraction', MODEL_NAME).then((p) => {
      log.info({ model: MODEL_NAME }, 'Embedding pipeline loaded successfully');
      return p as FeatureExtractionPipeline;
    });
  }
  return _pipelinePromise;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a 384-dimensional embedding vector for the given text.
 *
 * Uses mean-pooling over the last hidden state to produce a single vector,
 * then converts the underlying Float32Array to a plain number[].
 *
 * @param text - The input text to embed.
 * @returns    - A plain `number[]` of exactly 384 elements.
 *
 * Requirements: 27.2, 27.3
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getPipeline();

  // pooling: 'mean' collapses token dimension → shape [1, 384]
  // normalize: true produces unit-norm vectors (cosine-similarity friendly)
  const output = await extractor(text, { pooling: 'mean', normalize: true });

  // The transformer library returns a Tensor-like object. Extract the
  // underlying typed array regardless of the exact wrapper type.
  const data: Float32Array =
    output.data instanceof Float32Array
      ? output.data
      : new Float32Array(output.data as ArrayLike<number>);

  // Slice to exactly EMBEDDING_DIMENSIONS in case the model ever changes shape
  const embedding = Array.from(data).slice(0, EMBEDDING_DIMENSIONS);

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding dimension: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}`,
    );
  }

  return embedding;
}
