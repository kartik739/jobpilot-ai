import api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────────

/** KPI summary metrics returned by GET /api/analytics/summary */
export interface AnalyticsSummary {
  totalApplications: number
  /** Interview rate as a fraction (0–1) */
  interviewRate: number
  /** Rejection rate as a fraction (0–1) */
  rejectionRate: number
  /** Offer rate as a fraction (0–1) */
  offerRate: number
  pendingCount: number
}

/** Single source platform item returned by GET /api/analytics/sources */
export interface SourcePerformanceItem {
  source: string
  applicationCount: number
}

/** Single tech-stack skill item returned by GET /api/analytics/stack */
export interface StackPerformanceItem {
  skill: string
  applicationCount: number
}

/** Single keyword effectiveness item returned by GET /api/analytics/keywords */
export interface KeywordEffectivenessItem {
  keyword: string
  totalApplications: number
  responseCount: number
  /** Response rate as a fraction (0–1) */
  responseRate: number
}

/** Single resume version performance item returned by GET /api/analytics/resume-versions */
export interface ResumeVersionPerformanceItem {
  resumeVersionId: string
  name: string
  specialization: string
  totalApplications: number
  interviewCount: number
  /** Interview rate as a fraction (0–1) */
  interviewRate: number
}

/** Single weekly trend data point returned by GET /api/analytics/weekly-trend */
export interface WeeklyTrendPoint {
  /** ISO 8601 date string for the Monday of the week (YYYY-MM-DD) */
  weekStart: string
  applicationCount: number
}

// ─── API functions ──────────────────────────────────────────────────────────────

/** GET /api/analytics/summary?days=<days> */
export async function getAnalyticsSummary(days = 30): Promise<AnalyticsSummary> {
  const { data } = await api.get<AnalyticsSummary>('/api/analytics/summary', {
    params: { days },
  })
  return data
}

/** GET /api/analytics/sources?days=<days> */
export async function getAnalyticsSources(days = 30): Promise<SourcePerformanceItem[]> {
  const { data } = await api.get<{ sources: SourcePerformanceItem[] }>(
    '/api/analytics/sources',
    { params: { days } },
  )
  return data.sources
}

/** GET /api/analytics/stack?days=<days> */
export async function getAnalyticsStack(days = 30): Promise<StackPerformanceItem[]> {
  const { data } = await api.get<{ stack: StackPerformanceItem[] }>(
    '/api/analytics/stack',
    { params: { days } },
  )
  return data.stack
}

/** GET /api/analytics/keywords */
export async function getAnalyticsKeywords(): Promise<KeywordEffectivenessItem[]> {
  const { data } = await api.get<{ keywords: KeywordEffectivenessItem[] }>(
    '/api/analytics/keywords',
  )
  return data.keywords
}

/** GET /api/analytics/resume-versions */
export async function getAnalyticsResumeVersions(): Promise<ResumeVersionPerformanceItem[]> {
  const { data } = await api.get<{ resumeVersions: ResumeVersionPerformanceItem[] }>(
    '/api/analytics/resume-versions',
  )
  return data.resumeVersions
}

/** GET /api/analytics/weekly-trend */
export async function getAnalyticsWeeklyTrend(): Promise<WeeklyTrendPoint[]> {
  const { data } = await api.get<{ trend: WeeklyTrendPoint[] }>(
    '/api/analytics/weekly-trend',
  )
  return data.trend
}
