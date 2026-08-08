import api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MatchScore {
  overall: number
  skillMatch: number
  experienceMatch: number
  locationMatch: number
  salaryMatch: number
  technologyMatch: number
  workAuthMatch: boolean
  successProbability: number
  disqualifiers: string[]
}

export interface ManualJobPreview {
  id: string
  title: string
  company: string
  location: string[]
  isRemote: boolean
  isHybrid: boolean
  description: string
  descriptionHtml: string | null
  requiredSkills: string[]
  preferredSkills: string[]
  yearsExperienceMin: number | null
  yearsExperienceMax: number | null
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  employmentType: string | null
  applicationUrl: string
}

export interface SubmitManualJobResponse {
  jobPostingId: string
  duplicate: boolean
  matchScore: MatchScore
  job: ManualJobPreview
}

export interface ConfirmManualJobResponse {
  taskId: string
  status: string
  message: string
}

// ─── API functions ─────────────────────────────────────────────────────────────

/**
 * POST /api/jobs/manual
 * Submits a job URL for parsing and scoring.
 * Returns the parsed job preview and match score.
 */
export async function submitManualJob(url: string): Promise<SubmitManualJobResponse> {
  const { data } = await api.post<SubmitManualJobResponse>('/api/jobs/manual', { url })
  return data
}

/**
 * POST /api/jobs/manual/:id/confirm
 * Confirms the user wants to queue this job for application.
 * Returns the BullMQ task ID.
 */
export async function confirmManualJob(jobPostingId: string): Promise<ConfirmManualJobResponse> {
  const { data } = await api.post<ConfirmManualJobResponse>(
    `/api/jobs/manual/${jobPostingId}/confirm`,
    { confirmed: true },
  )
  return data
}
