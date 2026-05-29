import api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface JobMatchWithPosting {
  id: string
  jobPostingId: string
  // Match score components (0-100)
  overall: number
  skillMatch: number
  experienceMatch: number
  locationMatch: number
  salaryMatch: number
  technologyMatch: number
  workAuthMatch: boolean
  successProbability: number
  disqualifiers: string[]
  // Job posting fields
  company: string
  title: string
  description: string
  descriptionHtml: string | null
  location: string[]
  isRemote: boolean
  isHybrid: boolean
  requiredSkills: string[]
  preferredSkills: string[]
  yearsExperienceMin: number | null
  yearsExperienceMax: number | null
  salaryMin: number | null
  salaryMax: number | null
  currency: string | null
  employmentType: string | null
  applicationUrl: string
  platform: string
  fingerprint: string
  status: string
  discoveredAt: string
  createdAt: string
}

export interface JobsResponse {
  jobs: JobMatchWithPosting[]
  total: number
  page: number
  limit: number
}

export interface GetJobsParams {
  page?: number
  limit?: number
  sortBy?: string
}

/** GET /api/jobs — fetch paginated ranked job matches */
export async function getJobs(params: GetJobsParams = {}): Promise<JobsResponse> {
  const { page = 1, limit = 20, sortBy = 'matchScore' } = params
  const { data } = await api.get<JobsResponse>('/api/jobs', {
    params: { page, limit, sortBy },
  })
  return data
}
