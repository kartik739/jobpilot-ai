import api from './api'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CoverLetterStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'auto_submitted'
  | 'timeout_submitted'

export interface ApplicationMaterials {
  applicationId: string
  jobTitle: string
  company: string
  /** Pre-signed URL for downloading the tailored resume PDF */
  resumeUrl: string | null
  resumeFileName: string | null
  /** Cover letter plain text */
  coverLetterText: string | null
  coverLetterStatus: CoverLetterStatus
  /** ISO timestamp of when the 24-hour review window expires */
  reviewDeadline: string | null
}

export interface ApproveCoverLetterPayload {
  /** If provided, overrides the generated cover letter text before approving */
  editedText?: string
}

export interface CoverLetterActionResponse {
  success: boolean
  message: string
  coverLetterStatus: CoverLetterStatus
}

// ─── API functions ─────────────────────────────────────────────────────────────

/**
 * GET /api/applications/:id/materials
 * Returns tailored resume pre-signed URL and cover letter for a specific application.
 */
export async function getApplicationMaterials(applicationId: string): Promise<ApplicationMaterials> {
  const { data } = await api.get<ApplicationMaterials>(
    `/api/applications/${applicationId}/materials`,
  )
  return data
}

/**
 * POST /api/applications/:id/cover-letter/approve
 * Approves the cover letter, optionally with an edited body.
 * Resolves the 24-hour wait immediately.
 */
export async function approveCoverLetter(
  applicationId: string,
  payload: ApproveCoverLetterPayload = {},
): Promise<CoverLetterActionResponse> {
  const { data } = await api.post<CoverLetterActionResponse>(
    `/api/applications/${applicationId}/cover-letter/approve`,
    payload,
  )
  return data
}

/**
 * POST /api/applications/:id/cover-letter/reject
 * Rejects the cover letter and cancels the pending application.
 * Resolves the 24-hour wait immediately.
 */
export async function rejectCoverLetter(
  applicationId: string,
): Promise<CoverLetterActionResponse> {
  const { data } = await api.post<CoverLetterActionResponse>(
    `/api/applications/${applicationId}/cover-letter/reject`,
  )
  return data
}
