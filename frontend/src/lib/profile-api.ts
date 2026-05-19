import api from './api'

export interface WorkExperiencePayload {
  company: string
  title: string
  location?: string
  startDate: string
  endDate?: string
  isCurrent?: boolean
  description?: string
  bullets?: string[]
  skills?: string[]
}

export interface EducationPayload {
  institution: string
  degree: string
  field?: string
  startDate: string
  endDate?: string
  gpa?: number
  description?: string
}

export interface ProjectPayload {
  name: string
  description?: string
  url?: string
  repoUrl?: string
  skills?: string[]
  startDate?: string
  endDate?: string
  isCurrent?: boolean
  highlights?: string[]
}

export interface SkillPayload {
  name: string
  category?: string
  proficiency?: string
  yearsOfExp?: number
}

export interface CertificationPayload {
  name: string
  issuer?: string
  issueDate?: string
  expiryDate?: string
  credentialId?: string
  credentialUrl?: string
}

export interface ProfilePayload {
  fullName: string
  email: string
  phone?: string
  location: string
  linkedinUrl?: string
  githubUrl?: string
  portfolioUrl?: string
  websiteUrl?: string
  workAuthorization: string[]
  requiresSponsorship?: boolean
  noticePeriod: number
  remotePreference?: string
  targetRoles: string[]
  preferredLocations: string[]
  salaryMin?: number
  salaryMax?: number
  currency?: string
  employmentTypes?: string[]
  excludedCompanies?: string[]
  preferredCompanies?: string[]
  dailyApplyLimit?: number
  coverLetterReviewMode?: string
  workExperiences?: WorkExperiencePayload[]
  educations?: EducationPayload[]
  projects?: ProjectPayload[]
  skills?: SkillPayload[]
  certifications?: CertificationPayload[]
}

/** Partial payload for PUT /api/profile (all fields optional) */
export type UpdateProfilePayload = Partial<ProfilePayload>

export interface ProfileResponse {
  id: string
  userId: string
  profileCompleteness: number
  fullName: string
  email: string
  [key: string]: unknown
}

/** Convert a "YYYY-MM" month string to an ISO datetime string (first of the month, midnight UTC) */
export function monthToIso(month?: string): string {
  if (!month) return new Date().toISOString()
  const [year, mon] = month.split('-')
  return new Date(`${year}-${mon}-01T00:00:00.000Z`).toISOString()
}

/** POST /api/profile — creates or replaces the user profile */
export async function createProfile(payload: ProfilePayload): Promise<ProfileResponse> {
  const { data } = await api.post<ProfileResponse>('/api/profile', payload)
  return data
}

/** GET /api/profile — fetches the current user's profile */
export async function getProfile(): Promise<ProfileResponse> {
  const { data } = await api.get<ProfileResponse>('/api/profile')
  return data
}

/** PUT /api/profile — partial update of the user profile */
export async function updateProfile(payload: UpdateProfilePayload): Promise<ProfileResponse> {
  const { data } = await api.put<ProfileResponse>('/api/profile', payload)
  return data
}

/** Shape returned by 422 Unprocessable Entity responses */
export interface ValidationError {
  error: string
  details?: {
    fieldErrors?: Record<string, string[]>
    formErrors?: string[]
  }
}

// ─── Resume Versions ──────────────────────────────────────────────────────────

export interface ResumeVersion {
  id: string
  name: string
  specialization: string
  fileUrl: string
  fileHash: string
  isDefault: boolean
  usageCount: number
  lastUsedAt?: string
  successRate?: number
  createdAt: string
  updatedAt: string
}

export interface UpdateResumePayload {
  name?: string
  specialization?: string
  isDefault?: boolean
}

/** GET /api/profile/resumes — returns all resume versions */
export async function getResumes(): Promise<ResumeVersion[]> {
  const { data } = await api.get<ResumeVersion[]>('/api/profile/resumes')
  return data
}

/** POST /api/profile/resumes — multipart upload */
export async function uploadResume(formData: FormData): Promise<ResumeVersion> {
  const { data } = await api.post<ResumeVersion>('/api/profile/resumes', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/** PUT /api/profile/resumes/:id — update name, specialization, or isDefault */
export async function updateResume(id: string, payload: UpdateResumePayload): Promise<ResumeVersion> {
  const { data } = await api.put<ResumeVersion>(`/api/profile/resumes/${id}`, payload)
  return data
}

/** DELETE /api/profile/resumes/:id */
export async function deleteResume(id: string): Promise<void> {
  await api.delete(`/api/profile/resumes/${id}`)
}

/** GET /api/profile/resumes/:id/download — returns a pre-signed URL string */
export async function getResumeDownloadUrl(id: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/api/profile/resumes/${id}/download`)
  return data.url
}
