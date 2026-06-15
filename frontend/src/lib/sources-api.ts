import api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SourceStatus = 'success' | 'error' | 'rate_limited' | 'never_run'

export interface JobSource {
  id: string
  userId: string
  platform: string
  enabled: boolean
  /** ISO timestamp or null if never run */
  lastRunAt: string | null
  lastRunStatus: SourceStatus
  lastRunJobsFound: number
  errorMessage: string | null
  createdAt: string
  /** True when a run-now task is currently in-progress */
  isRunning: boolean
}

export interface SourcesResponse {
  sources: JobSource[]
}

export interface RunNowResponse {
  message: string
  sourceId: string
  isRunning: boolean
}

// ─── API functions ──────────────────────────────────────────────────────────────

/**
 * GET /api/sources
 * Returns all configured job sources for the authenticated user.
 * Requirements: 22.1, 22.2
 */
export async function getSources(): Promise<JobSource[]> {
  const { data } = await api.get<SourcesResponse>('/api/sources')
  return data.sources
}

/**
 * POST /api/sources/:id/run-now
 * Triggers an immediate discovery run for the given source.
 * Requirements: 22.3
 */
export async function runSourceNow(sourceId: string): Promise<RunNowResponse> {
  const { data } = await api.post<RunNowResponse>(`/api/sources/${sourceId}/run-now`)
  return data
}
