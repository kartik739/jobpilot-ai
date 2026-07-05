/**
 * LLM Provider configuration module
 *
 * Supports multiple OpenAI-compatible providers (Ollama, Gemini, Groq, OpenRouter,
 * and any custom endpoint) selectable via the LLM_PROVIDER environment variable.
 * Runtime switching is supported via setLLMConfig() without a server restart.
 *
 * Requirements: 26.1, 26.2, 26.3, 26.4
 */

import OpenAI from 'openai';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ module: 'llmProvider' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type LLMProvider = 'ollama' | 'gemini' | 'groq' | 'openrouter' | 'custom';

export interface LLMConfig {
  provider: LLMProvider;
  baseURL: string;
  apiKey: string;
  model: string;
}

// ─── Provider presets ─────────────────────────────────────────────────────────

const PROVIDER_PRESETS: Record<
  Exclude<LLMProvider, 'custom'>,
  { baseURL: string; apiKeyEnv: string; defaultApiKey?: string }
> = {
  ollama: {
    baseURL: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultApiKey: 'ollama', // placeholder — Ollama doesn't require a real key
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
};

// ─── Runtime config state ─────────────────────────────────────────────────────

/**
 * Module-level mutable config. When non-null, overrides env-var resolution.
 * Updated by setLLMConfig() to support runtime provider switching.
 */
let runtimeConfig: LLMConfig | null = null;

// ─── Config resolution ────────────────────────────────────────────────────────

/**
 * Builds an LLMConfig from environment variables.
 * Reads LLM_PROVIDER (defaults to 'ollama') and the corresponding API key env var.
 */
export function resolveConfigFromEnv(): LLMConfig {
  const provider = (process.env['LLM_PROVIDER'] ?? 'ollama') as LLMProvider;
  const model = process.env['LLM_MODEL'] ?? 'llama3.2';

  if (provider === 'custom') {
    const baseURL = process.env['LLM_BASE_URL'] ?? '';
    const apiKey = process.env['LLM_API_KEY'] ?? '';

    if (!baseURL) {
      log.warn('LLM_PROVIDER=custom but LLM_BASE_URL is not set; falling back to Ollama');
      return resolvePreset('ollama', model);
    }

    return { provider: 'custom', baseURL, apiKey, model };
  }

  const preset = PROVIDER_PRESETS[provider as Exclude<LLMProvider, 'custom'>];
  if (!preset) {
    log.warn({ provider }, 'Unknown LLM_PROVIDER; falling back to Ollama');
    return resolvePreset('ollama', model);
  }

  return resolvePreset(provider as Exclude<LLMProvider, 'custom'>, model);
}

function resolvePreset(
  provider: Exclude<LLMProvider, 'custom'>,
  model: string,
): LLMConfig {
  const preset = PROVIDER_PRESETS[provider];
  const apiKey =
    process.env[preset.apiKeyEnv] ?? preset.defaultApiKey ?? '';

  return { provider, baseURL: preset.baseURL, apiKey, model };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Override the active LLM configuration at runtime.
 * Calling this updates the provider immediately without a server restart.
 */
export function setLLMConfig(config: LLMConfig): void {
  log.info(
    { provider: config.provider, baseURL: config.baseURL, model: config.model },
    'LLM provider config updated at runtime',
  );
  runtimeConfig = config;
}

/**
 * Returns the currently active LLMConfig.
 * Prefers runtimeConfig if set (via PUT endpoint), otherwise resolves from env vars.
 */
export function getActiveLLMConfig(): LLMConfig {
  return runtimeConfig ?? resolveConfigFromEnv();
}

/**
 * Creates and returns a configured OpenAI-compatible client.
 * The client's baseURL and apiKey come from the active LLM config.
 */
export function getLLMClient(): OpenAI {
  const config = getActiveLLMConfig();
  return new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });
}

/**
 * Returns the active model name.
 * Prefers runtimeConfig.model if set, otherwise LLM_MODEL env var, then 'llama3.2'.
 */
export function getLLMModel(): string {
  return runtimeConfig?.model ?? (process.env['LLM_MODEL'] ?? 'llama3.2');
}

/**
 * Resets the runtime config back to env-var-based resolution.
 * Useful for testing or resetting to defaults.
 */
export function resetLLMConfig(): void {
  runtimeConfig = null;
  log.info('LLM provider config reset to environment defaults');
}
