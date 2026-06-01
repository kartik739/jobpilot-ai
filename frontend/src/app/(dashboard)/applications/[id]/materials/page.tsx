'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getApplicationMaterials,
  approveCoverLetter,
  rejectCoverLetter,
  type CoverLetterStatus,
} from '@/lib/applications-api'

// ─── Form schema ──────────────────────────────────────────────────────────────

const editCoverLetterSchema = z.object({
  editedText: z.string().min(1, 'Cover letter text cannot be empty'),
})

type EditCoverLetterFormValues = z.infer<typeof editCoverLetterSchema>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(status: CoverLetterStatus): string {
  switch (status) {
    case 'pending_review':
      return 'Pending Review'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'auto_submitted':
      return 'Auto-Submitted'
    case 'timeout_submitted':
      return 'Submitted (timeout)'
    default:
      return status
  }
}

function statusColors(status: CoverLetterStatus): string {
  switch (status) {
    case 'pending_review':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'approved':
    case 'auto_submitted':
    case 'timeout_submitted':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'rejected':
      return 'bg-red-100 text-red-800 border-red-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading application materials">
      <div className="h-7 w-64 bg-gray-200 rounded" />
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <div className="h-5 w-40 bg-gray-200 rounded" />
        <div className="h-10 w-48 bg-gray-100 rounded-lg" />
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <div className="h-5 w-36 bg-gray-200 rounded" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 bg-gray-100 rounded w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4"
    >
      <span aria-hidden="true" className="text-lg leading-none mt-0.5">
        ⚠
      </span>
      <div>
        <p className="font-semibold text-sm">Failed to load application materials</p>
        <p className="text-sm mt-0.5 text-red-600">{message}</p>
      </div>
    </div>
  )
}

// ─── Resume section ───────────────────────────────────────────────────────────

interface ResumeSectionProps {
  resumeUrl: string | null
  resumeFileName: string | null
}

function ResumeSection({ resumeUrl, resumeFileName }: ResumeSectionProps) {
  return (
    <section
      aria-labelledby="resume-section-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
    >
      <h2
        id="resume-section-heading"
        className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2"
      >
        <span aria-hidden="true">📄</span>
        Tailored Resume
      </h2>

      {resumeUrl ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-600 truncate">
              {resumeFileName ?? 'tailored_resume.pdf'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              Pre-signed download link (expires in 15 minutes)
            </p>
          </div>
          <a
            href={resumeUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download tailored resume PDF"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors shrink-0"
          >
            <span aria-hidden="true">⬇</span>
            Download
          </a>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">
          Tailored resume is not yet available for this application.
        </p>
      )}
    </section>
  )
}

// ─── Cover letter read-only view ──────────────────────────────────────────────

interface CoverLetterReadOnlyProps {
  text: string
  status: CoverLetterStatus
  reviewDeadline: string | null
}

function CoverLetterReadOnly({ text, status, reviewDeadline }: CoverLetterReadOnlyProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusColors(status)}`}
          aria-label={`Cover letter status: ${statusLabel(status)}`}
        >
          {statusLabel(status)}
        </span>
        {reviewDeadline && (
          <span className="text-xs text-gray-400">
            Review deadline: {formatDeadline(reviewDeadline)}
          </span>
        )}
      </div>

      <div
        className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-line leading-relaxed max-h-96 overflow-y-auto"
        aria-label="Cover letter text"
      >
        {text}
      </div>
    </div>
  )
}

// ─── Cover letter review form ─────────────────────────────────────────────────

interface CoverLetterReviewFormProps {
  applicationId: string
  initialText: string
  reviewDeadline: string | null
  onActionComplete: () => void
}

function CoverLetterReviewForm({
  applicationId,
  initialText,
  reviewDeadline,
  onActionComplete,
}: CoverLetterReviewFormProps) {
  const queryClient = useQueryClient()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<EditCoverLetterFormValues>({
    resolver: zodResolver(editCoverLetterSchema),
    defaultValues: { editedText: initialText },
  })

  const approveMutation = useMutation({
    mutationFn: (editedText?: string) =>
      approveCoverLetter(applicationId, editedText ? { editedText } : {}),
    onSuccess: (data) => {
      setSuccessMessage(data.message ?? 'Cover letter approved successfully.')
      queryClient.invalidateQueries({ queryKey: ['applicationMaterials', applicationId] })
      onActionComplete()
    },
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectCoverLetter(applicationId),
    onSuccess: (data) => {
      setSuccessMessage(data.message ?? 'Cover letter rejected.')
      queryClient.invalidateQueries({ queryKey: ['applicationMaterials', applicationId] })
      onActionComplete()
    },
  })

  const isBusy = approveMutation.isPending || rejectMutation.isPending

  const handleApprove = () => {
    // Approve with original text — no edit needed
    approveMutation.mutate(undefined)
  }

  const handleEditAndApprove = handleSubmit((values) => {
    approveMutation.mutate(values.editedText)
  })

  const handleReject = () => {
    rejectMutation.mutate()
  }

  const mutationError =
    (approveMutation.error as Error | null)?.message ??
    (rejectMutation.error as Error | null)?.message ??
    null

  return (
    <form onSubmit={handleEditAndApprove} noValidate className="space-y-4" aria-label="Review cover letter">
      {/* Deadline notice */}
      {reviewDeadline && (
        <div
          role="status"
          className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800"
        >
          <span aria-hidden="true" className="shrink-0 mt-0.5">
            ⏳
          </span>
          <span>
            Review deadline: <strong>{formatDeadline(reviewDeadline)}</strong>. If no action is
            taken, the original generated cover letter will be submitted automatically.
          </span>
        </div>
      )}

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-yellow-100 text-yellow-800 border-yellow-200"
          aria-label="Cover letter status: Pending Review"
        >
          Pending Review
        </span>
      </div>

      {/* Editable textarea */}
      <div className="space-y-1">
        <label htmlFor="cover-letter-text" className="block text-sm font-medium text-gray-700">
          Cover Letter Text
        </label>
        <textarea
          id="cover-letter-text"
          {...register('editedText')}
          rows={12}
          disabled={isBusy}
          aria-describedby={errors.editedText ? 'cover-letter-error' : undefined}
          className={`w-full px-3 py-2 text-sm text-gray-800 bg-white border rounded-lg leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
            errors.editedText ? 'border-red-400' : 'border-gray-300'
          }`}
        />
        {errors.editedText && (
          <p id="cover-letter-error" role="alert" className="text-xs text-red-600">
            {errors.editedText.message}
          </p>
        )}
        <p className="text-xs text-gray-400">
          Edit the text above if you want changes, then click "Edit &amp; Approve".
        </p>
      </div>

      {/* Error feedback */}
      {mutationError && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {mutationError}
        </div>
      )}

      {/* Success feedback */}
      {successMessage && (
        <div role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {successMessage}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleApprove}
          disabled={isBusy}
          aria-busy={approveMutation.isPending && !isDirty}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {approveMutation.isPending && !isDirty ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Approving…
            </>
          ) : (
            <>
              <span aria-hidden="true">✓</span>
              Approve
            </>
          )}
        </button>

        <button
          type="submit"
          disabled={isBusy}
          aria-busy={approveMutation.isPending && isDirty}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {approveMutation.isPending && isDirty ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Saving…
            </>
          ) : (
            <>
              <span aria-hidden="true">✏</span>
              Edit &amp; Approve
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleReject}
          disabled={isBusy}
          aria-busy={rejectMutation.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {rejectMutation.isPending ? (
            <>
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Rejecting…
            </>
          ) : (
            <>
              <span aria-hidden="true">✗</span>
              Reject
            </>
          )}
        </button>
      </div>
    </form>
  )
}

// ─── Cover letter section ─────────────────────────────────────────────────────

interface CoverLetterSectionProps {
  applicationId: string
  coverLetterText: string | null
  coverLetterStatus: CoverLetterStatus
  reviewDeadline: string | null
  onActionComplete: () => void
}

function CoverLetterSection({
  applicationId,
  coverLetterText,
  coverLetterStatus,
  reviewDeadline,
  onActionComplete,
}: CoverLetterSectionProps) {
  return (
    <section
      aria-labelledby="cover-letter-section-heading"
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
    >
      <h2
        id="cover-letter-section-heading"
        className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2"
      >
        <span aria-hidden="true">✉</span>
        Cover Letter
      </h2>

      {coverLetterText == null ? (
        <p className="text-sm text-gray-400 italic">
          No cover letter has been generated for this application.
        </p>
      ) : coverLetterStatus === 'pending_review' ? (
        <CoverLetterReviewForm
          applicationId={applicationId}
          initialText={coverLetterText}
          reviewDeadline={reviewDeadline}
          onActionComplete={onActionComplete}
        />
      ) : (
        <CoverLetterReadOnly
          text={coverLetterText}
          status={coverLetterStatus}
          reviewDeadline={reviewDeadline}
        />
      )}
    </section>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ApplicationMaterialsPage() {
  const params = useParams()
  const router = useRouter()
  const applicationId = typeof params?.id === 'string' ? params.id : (params?.id?.[0] ?? '')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['applicationMaterials', applicationId],
    queryFn: () => getApplicationMaterials(applicationId),
    enabled: Boolean(applicationId),
    retry: 1,
  })

  const handleActionComplete = () => {
    // Refetch to reflect new status after approve/reject
    refetch()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
        aria-label="Go back"
      >
        <span aria-hidden="true">←</span>
        Back
      </button>

      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Application Materials</h1>
        {data && (
          <p className="text-gray-500 text-sm mt-1">
            {data.jobTitle} · {data.company}
          </p>
        )}
      </div>

      {/* Content */}
      {isLoading && <LoadingSkeleton />}

      {isError && (
        <ErrorState message={(error as Error | null)?.message ?? 'An unexpected error occurred.'} />
      )}

      {!isLoading && !isError && data && (
        <>
          <ResumeSection
            resumeUrl={data.resumeUrl}
            resumeFileName={data.resumeFileName}
          />

          <CoverLetterSection
            applicationId={applicationId}
            coverLetterText={data.coverLetterText}
            coverLetterStatus={data.coverLetterStatus}
            reviewDeadline={data.reviewDeadline}
            onActionComplete={handleActionComplete}
          />
        </>
      )}
    </div>
  )
}
