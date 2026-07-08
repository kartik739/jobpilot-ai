import api from './api'
import { getSources as getSourcesFromSourcesApi } from './sources-api'

// ─── Re-export sources helper ──────────────────────────────────────────────────

export { getSources } from './sources-api'
export type { JobSource } from './sources-api'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentStatus {
  paused: boolean
  todayApplicationCount: number
  dailyLimit: number
  remainingToday: number
  limitReached: boolean
}

export interface PauseResponse {
  paused: true
  message: string
}

export interface ResumeResponse {
  paused: false
  message: string
  todayApplicationCount: number
  dailyLimit: number
  remainingToday: number
}

export type LLMProvider = 'ollama' | 'gemini' | 'groq' | 'openrouter' | 'custom'

export interface LLMProviderConfig {
  provider: LLMProvider
  baseURL: string
  model: string
  /** True when an API key is configured — the actual key is never returned */
  hasApiKey: boolean
}

export interface UpdateLLMProviderPayload {
  provider: LLMProvider
  baseURL?: string
  apiKey?: string
  model?: string
}

// ─── Agent / Automation ────────────────────────────────────────────────────────

/**
 * GET /api/agent/status
 * Returns current automation status including pause state, today's count, and daily limit.
 * Requirements: 14.4
 */
export async function getAgentStatus(): Promise<AgentStatus> {
  const { data } = await api.get<AgentStatus>('/api/agent/status')
  return data
}

/**
 * POST /api/agent/pause
 * Pauses automation for the authenticated user.
 * Requirements: 14.4, 14.5, 14.6
 */
export async function pauseAutomation(): Promise<PauseResponse> {
  const { data } = await api.post<PauseResponse>('/api/agent/pause')
  return data
}

/**
 * POST /api/agent/resume
 * Resumes automation for the authenticated user.
 * Requirements: 14.4, 14.7
 */
export async function resumeAutomation(): Promise<ResumeResponse> {
  const { data } = await api.post<ResumeResponse>('/api/agent/resume')
  return data
}

// ─── LLM Provider ─────────────────────────────────────────────────────────────

/**
 * GET /api/settings/llm-provider
 * Returns the currently configured LLM provider (API key is never exposed).
 * Requirements: 26.1, 26.2
 */
export async function getLLMProvider(): Promise<LLMProviderConfig> {
  const { data } = await api.get<LLMProviderConfig>('/api/settings/llm-provider')
  return data
}

/**
 * PUT /api/settings/llm-provider
 * Switches the active LLM provider at runtime without a server restart.
 * Requirements: 26.1, 26.2
 */
export async function updateLLMProvider(payload: UpdateLLMProviderPayload): Promise<LLMProviderConfig> {
  const { data } = await api.put<LLMProviderConfig>('/api/settings/llm-provider', payload)
  return data
}

// ─── Sources ──────────────────────────────────────────────────────────────────

/**
 * PATCH /api/sources/:id — updates the enabled state of a job source.
 *
 * NOTE: The backend sources routes currently only expose GET (list) and
 * POST (run-now). Toggling enabled/disabled is not yet a dedicated endpoint.
 * This function calls PATCH /api/sources/:id which is the natural REST path;
 * once the backend adds that route it will work automatically. In the meantime
 * the UI optimistically reflects the change and will re-sync on next fetch.
 */
export async function updateSourceEnabled(id: string, enabled: boolean): Promise<void> {
  await api.patch(`/api/sources/${id}`, { enabled })
}

// ─── Data Export ──────────────────────────────────────────────────────────────

/**
 * GET /api/user/export
 * Streams a ZIP of all user data. Returns a Blob for triggering a file download.
 * Requirements: Task 65.1 (export)
 */
export async function exportData(): Promise<Blob> {
  const { data } = await api.get('/api/user/export', { responseType: 'blob' })
  return data as Blob
}

// ─── Account Deletion ─────────────────────────────────────────────────────────

/**
 * DELETE /api/user/account
 * Permanently deletes all user data. This action is irreversible.
 * Requirements: Task 66 (account deletion)
 */
export async function deleteAccount(): Promise<void> {
  await api.delete('/api/user/account')
}
