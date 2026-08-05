/**
 * LLM Provider settings routes
 *
 * GET /api/settings/llm-provider  — returns the current active provider config
 * PUT /api/settings/llm-provider  — switches the provider at runtime (no restart needed)
 *
 * Requirements: 26.1, 26.2, 26.3, 26.4
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../core/auth.js';
import { createChildLogger } from '../../core/logger.js';
import {
  getActiveLLMConfig,
  setLLMConfig,
  type LLMConfig,
  type LLMProvider,
} from '../../core/llmProvider.js';

const log = createChildLogger({ module: 'llmProviderRoutes' });

// ─── Validation schema ────────────────────────────────────────────────────────

const SUPPORTED_PROVIDERS: [LLMProvider, ...LLMProvider[]] = [
  'ollama',
  'gemini',
  'groq',
  'openrouter',
  'custom',
];

const PutLLMProviderBody = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
  baseURL: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().min(1).optional(),
});

type PutLLMProviderInput = z.infer<typeof PutLLMProviderBody>;

// ─── Response shape ───────────────────────────────────────────────────────────

interface LLMProviderResponse {
  provider: LLMProvider;
  baseURL: string;
  model: string;
  /** True when an API key is configured (actual value is never returned) */
  hasApiKey: boolean;
}

// Provider default baseURLs used when switching providers without an explicit baseURL
const PROVIDER_BASE_URLS: Record<LLMProvider, string> = {
  ollama: 'http://localhost:11434/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  custom: '',
};

function toResponse(config: LLMConfig): LLMProviderResponse {
  return {
    provider: config.provider,
    baseURL: config.baseURL,
    model: config.model,
    hasApiKey: config.apiKey.length > 0 && config.apiKey !== 'ollama',
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function llmProviderRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /api/settings/llm-provider ────────────────────────────────────────
  /**
   * Returns the currently active LLM provider configuration.
   * The API key is never exposed — only a boolean `hasApiKey` is returned.
   *
   * Requirements: 26.1, 26.2
   */
  app.get(
    '/api/settings/llm-provider',
    { preHandler: authenticate },
    async (request, reply) => {
      const config = getActiveLLMConfig();

      log.info(
        { userId: request.user.id, provider: config.provider },
        'LLM provider settings retrieved',
      );

      return reply.status(200).send(toResponse(config));
    },
  );

  // ── PUT /api/settings/llm-provider ────────────────────────────────────────
  /**
   * Switches the active LLM provider at runtime without a server restart.
   * Validates the request body with Zod and returns 422 on invalid input.
   *
   * Requirements: 26.1, 26.2, 26.4
   */
  app.put(
    '/api/settings/llm-provider',
    { preHandler: authenticate },
    async (request, reply) => {
      // Zod validation
      const parseResult = PutLLMProviderBody.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          issues: parseResult.error.issues,
        });
      }

      const body: PutLLMProviderInput = parseResult.data;

      // For 'custom' provider, baseURL is required
      if (body.provider === 'custom' && !body.baseURL) {
        return reply.status(422).send({
          error: 'Validation failed',
          issues: [
            {
              path: ['baseURL'],
              message: 'baseURL is required when provider is "custom"',
            },
          ],
        });
      }

      // Build the new config, merging with current active config for unspecified fields
      const currentConfig = getActiveLLMConfig();

      const resolvedBaseURL =
        body.baseURL ?? PROVIDER_BASE_URLS[body.provider] ?? currentConfig.baseURL;

      const resolvedApiKey =
        body.apiKey !== undefined
          ? body.apiKey
          : body.provider === 'ollama'
            ? 'ollama'
            : '';

      const newConfig: LLMConfig = {
        provider: body.provider,
        baseURL: resolvedBaseURL,
        apiKey: resolvedApiKey,
        model: body.model ?? currentConfig.model,
      };

      setLLMConfig(newConfig);

      log.info(
        {
          userId: request.user.id,
          provider: newConfig.provider,
          baseURL: newConfig.baseURL,
          model: newConfig.model,
        },
        'LLM provider switched at runtime',
      );

      return reply.status(200).send(toResponse(newConfig));
    },
  );
}
