import api from './api'

// ─── Cover letter types (existing) ─────────────────────────────────────────────

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

// ─── Application tracker types ─────────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'phone_screen'
  | 'technical_interview'
  | 'final_round'
  | 'offer_received'
  | 'offer_accepted'
  | 'offer_declined'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'failed_submission'

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'rejected',
  'withdrawn',
  'ghosted',
  'failed_submission',
]

export interface MatchScoreSnapshot {
  overall: number
  skillMatch: number
  experienceMatch: number
  locationMatch: number
  salaryMatch: number
  technologyMatch: number
  workAuthMatch: boolean
  disqualifiers: string[]
}

export interface StatusTransition {
  id: string
  applicationRecordId: string
  from: string
  to: string
  triggeredBy: string
  timestamp: string
  note: string | null
}

export interface ApplicationRecord {
  id: string
  userId: string
  jobPostingId: string
  appliedAt: string
  source: string
  applicationUrl: string
  resumeVersionId: string
  coverLetterPath: string | null
  status: ApplicationStatus
  automationSessionId: string | null
  screenshotPaths: string[]
  confirmationNumber: string | null
  formAnswersSnapshot: Record<string, unknown>
  fingerprint: string
  rejectionReason: string | null
  notes: string
  matchScoreSnapshot: MatchScoreSnapshot | Record<string, unknown>
  createdAt: string
  updatedAt: string
  jobPosting: { title: string; company: string } | null
  resumeVersion: { name: string; specialization: string } | null
  transitions: StatusTransition[]
}

export interface ApplicationsResponse {
  data: ApplicationRecord[]
  pagination: {
    total: number
    page: number
    pageSize: number
    totalPages: number
  }
}

// ─── Application tracker API functions ────────────────────────────────────────

/**
 * GET /api/applications
 * Returns paginated list of applications, optionally filtered by status.
 */
export async function getApplications(params?: {
  status?: ApplicationStatus
  page?: number
  pageSize?: number
}): Promise<ApplicationsResponse> {
  const { data } = await api.get<ApplicationsResponse>('/api/applications', {
    params,
  })
  return data
}

/**
 * GET /api/applications/:id
 * Returns full application record with transitions, jobPosting, and resumeVersion.
 */
export async function getApplication(id: string): Promise<ApplicationRecord> {
  const { data } = await api.get<ApplicationRecord>(`/api/applications/${id}`)
  return data
}

/**
 * PATCH /api/applications/:id/status
 * Updates the application status and records a StatusTransition.
 */
export async function updateApplicationStatus(
  id: string,
  payload: { status: ApplicationStatus; note?: string },
): Promise<ApplicationRecord> {
  const { data } = await api.patch<ApplicationRecord>(
    `/api/applications/${id}/status`,
    payload,
  )
  return data
}

/**
 * PATCH /api/applications/:id/notes
 * Updates the notes field of an application.
 */
export async function updateApplicationNotes(
  id: string,
  notes: string,
): Promise<ApplicationRecord> {
  const { data } = await api.patch<ApplicationRecord>(
    `/api/applications/${id}/notes`,
    { notes },
  )
  return data
}

/**
 * GET /api/applications/:id/screenshot-url?key=<key>
 * Returns a pre-signed URL for a screenshot stored in SeaweedFS.
 */
export async function getScreenshotUrl(
  applicationId: string,
  key: string,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/api/applications/${applicationId}/screenshot-url`,
    { params: { key } },
  )
  return data.url
}

// ─── Cover letter API functions (existing) ─────────────────────────────────────

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
 */
export async function rejectCoverLetter(
  applicationId: string,
): Promise<CoverLetterActionResponse> {
  const { data } = await api.post<CoverLetterActionResponse>(
    `/api/applications/${applicationId}/cover-letter/reject`,
  )
  return data
}

// ─── Interview prep types ──────────────────────────────────────────────────────

export type QuestionCategory = 'behavioral' | 'technical' | 'culture' | 'system-design'

export interface PrepQuestion {
  question: string
  category: QuestionCategory
  suggestedAnswer?: string
  note?: string
}

export interface InterviewPrepSheet {
  id: string
  applicationId: string
  behavioralQuestions: PrepQuestion[]
  technicalQuestions: PrepQuestion[]
  companySummary: string
  roleSpecificTips: string[]
  generatedAt: string
}

export interface AddCustomQuestionPayload {
  question: string
  category?: QuestionCategory
  note?: string
}

export interface UpdateQuestionNotePayload {
  category: QuestionCategory
  note: string
}

// ─── Interview prep API functions ─────────────────────────────────────────────

/**
 * GET /api/applications/:id/interview-prep
 * Returns the stored interview prep sheet for an application.
 * Throws 404 if the sheet hasn't been generated yet.
 */
export async function getInterviewPrepSheet(applicationId: string): Promise<InterviewPrepSheet> {
  const { data } = await api.get<InterviewPrepSheet>(
    `/api/applications/${applicationId}/interview-prep`,
  )
  return data
}

/**
 * POST /api/applications/:id/interview-prep/questions
 * Adds a custom question to the interview prep sheet.
 */
export async function addCustomQuestion(
  applicationId: string,
  payload: AddCustomQuestionPayload,
): Promise<InterviewPrepSheet> {
  const { data } = await api.post<InterviewPrepSheet>(
    `/api/applications/${applicationId}/interview-prep/questions`,
    payload,
  )
  return data
}

/**
 * PATCH /api/applications/:id/interview-prep/questions/:index/note
 * Updates the note on a specific question by its index in the category array.
 */
export async function updateQuestionNote(
  applicationId: string,
  index: number,
  payload: UpdateQuestionNotePayload,
): Promise<InterviewPrepSheet> {
  const { data } = await api.patch<InterviewPrepSheet>(
    `/api/applications/${applicationId}/interview-prep/questions/${index}/note`,
    payload,
  )
  return data
}
