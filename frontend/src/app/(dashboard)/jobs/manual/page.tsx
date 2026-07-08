'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  submitManualJob,
  confirmManualJob,
  type SubmitManualJobResponse,
  type MatchScore,
  type ManualJobPreview,
} from '@/lib/manual-jobs-api'
import { formatDisqualifier } from '../components/JobCard'

// ─── Zod schema ───────────────────────────────────────────────────────────────

const UrlSchema = z.object({
  url: z
    .string()
    .min(1, 'Please enter a job posting URL')
    .url('Please enter a valid URL (e.g. https://jobs.example.com/software-engineer)'),
})

type UrlFormValues = z.infer<typeof UrlSchema>

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const rounded = Math.round(score)
  let colorClass: string
  if (rounded >= 70) colorClass = 'bg-green-100 text-green-800 border-green-200'
  else if (rounded >= 40) colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200'
  else colorClass = 'bg-red-100 text-red-800 border-red-200'

  return (
    <span
      className={`inline-flex items-center px-3 py-1.5 rounded-full text-lg font-bold border ${colorClass}`}
      aria-label={`Overall match score: ${rounded}%`}
    >
      {rounded}%
    </span>
  )
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

interface ProgressBarProps {
  label: string
  weight: string
  value: number
}

function ProgressBar({ label, weight, value }: ProgressBarProps) {
  const rounded = Math.max(0, Math.min(100, Math.round(value)))

  let barColor: string
  if (rounded >= 70) barColor = 'bg-green-500'
  else if (rounded >= 40) barColor = 'bg-yellow-400'
  else barColor = 'bg-red-400'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">
          {label}
          <span className="ml-1.5 text-xs font-normal text-gray-400">({weight})</span>
        </span>
        <span className="font-semibold text-gray-900">{rounded}%</span>
      </div>
      <div
        className="w-full bg-gray-100 rounded-full h-2.5"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${rounded}%`}
      >
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  )
}

// ─── Score breakdown component ────────────────────────────────────────────────

const SCORE_COMPONENTS: Array<{
  key: keyof Pick<
    MatchScore,
    | 'skillMatch'
    | 'experienceMatch'
    | 'locationMatch'
    | 'salaryMatch'
    | 'technologyMatch'
  >
  label: string
  weight: string
}> = [
  { key: 'skillMatch', label: 'Skill Match', weight: '35%' },
  { key: 'experienceMatch', label: 'Experience Match', weight: '20%' },
  { key: 'locationMatch', label: 'Location Match', weight: '15%' },
  { key: 'salaryMatch', label: 'Salary Match', weight: '10%' },
  { key: 'technologyMatch', label: 'Tech Stack Match', weight: '10%' },
]

interface ScoreBreakdownProps {
  matchScore: MatchScore
}

function ScoreBreakdown({ matchScore }: ScoreBreakdownProps) {
  const hasDisqualifiers = matchScore.disqualifiers.length > 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Match Score</h2>

      {/* Overall score */}
      <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 mb-4">
        <div className="flex flex-col">
          <ScoreBadge score={matchScore.overall} />
          <span className="text-xs text-gray-400 mt-1">Overall Match</span>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-1">
          {matchScore.workAuthMatch ? (
            <p className="text-green-600 font-medium">✓ Work auth compatible</p>
          ) : (
            <p className="text-red-500 font-medium">✗ Work auth incompatible</p>
          )}
          <p>Success probability: {Math.round(matchScore.successProbability)}%</p>
        </div>
      </div>

      {/* Disqualifier badges */}
      {hasDisqualifiers && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Disqualifiers</h3>
          <div className="flex flex-wrap gap-2">
            {matchScore.disqualifiers.map((d) => (
              <span
                key={d}
                role="status"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200"
              >
                <span aria-hidden="true">⚠</span>
                {formatDisqualifier(d)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Component bars */}
      <div className="space-y-3">
        {SCORE_COMPONENTS.map((c) => (
          <ProgressBar
            key={c.key}
            label={c.label}
            weight={c.weight}
            value={matchScore[c.key]}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Job preview component ────────────────────────────────────────────────────

interface JobPreviewProps {
  job: ManualJobPreview
  isDuplicate: boolean
}

function JobPreview({ job, isDuplicate }: JobPreviewProps) {
  const locationText = job.isRemote
    ? 'Remote'
    : job.isHybrid
    ? 'Hybrid'
    : job.location.length > 0
    ? job.location.join(', ')
    : 'Location unknown'

  const salaryText = (() => {
    if (job.salaryMin == null && job.salaryMax == null) return null
    const currency = job.currency ?? 'USD'
    const fmt = (n: number) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(n)
    if (job.salaryMin != null && job.salaryMax != null)
      return `${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}`
    if (job.salaryMin != null) return `From ${fmt(job.salaryMin)}`
    return `Up to ${fmt(job.salaryMax!)}`
  })()

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      {isDuplicate && (
        <div className="mb-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-800">
          <span aria-hidden="true">ℹ</span>
          <span>This job was already parsed. Showing cached match score.</span>
        </div>
      )}

      <h2 className="text-lg font-bold text-gray-900 leading-snug">{job.title}</h2>
      <p className="text-sm text-gray-500 mt-0.5">{job.company}</p>

      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-500">
        <span>📍 {locationText}</span>
        {job.employmentType && (
          <span className="bg-gray-100 px-2 py-0.5 rounded-full">{job.employmentType}</span>
        )}
        {salaryText && <span className="text-gray-600 font-medium">{salaryText}</span>}
      </div>

      {(job.requiredSkills.length > 0 || job.preferredSkills.length > 0) && (
        <div className="mt-3">
          {job.requiredSkills.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-gray-400 mb-1.5">Required skills</p>
              <div className="flex flex-wrap gap-1.5">
                {job.requiredSkills.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-xs font-medium"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {job.preferredSkills.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">Preferred skills</p>
              <div className="flex flex-wrap gap-1.5">
                {job.preferredSkills.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 bg-gray-50 text-gray-600 border border-gray-200 rounded-md text-xs"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Description snippet */}
      <div className="mt-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          Description
        </h3>
        {job.descriptionHtml ? (
          <div
            className="prose prose-sm max-w-none text-gray-600 text-sm leading-relaxed max-h-48 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
          />
        ) : (
          <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto">
            {job.description}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type PageState =
  | { phase: 'form' }
  | { phase: 'preview'; result: SubmitManualJobResponse }
  | { phase: 'success'; taskId: string }

export default function ManualJobPage() {
  const router = useRouter()
  const [state, setState] = useState<PageState>({ phase: 'form' })

  const {
    register,
    handleSubmit,
    formState: { errors },
    getValues,
  } = useForm<UrlFormValues>({
    resolver: zodResolver(UrlSchema),
  })

  // Submit URL mutation
  const submitMutation = useMutation({
    mutationFn: (url: string) => submitManualJob(url),
    onSuccess: (data) => {
      setState({ phase: 'preview', result: data })
    },
  })

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: (jobPostingId: string) => confirmManualJob(jobPostingId),
    onSuccess: (data) => {
      setState({ phase: 'success', taskId: data.taskId })
    },
  })

  const onSubmit = handleSubmit((values) => {
    submitMutation.mutate(values.url)
  })

  const handleConfirm = () => {
    if (state.phase !== 'preview') return
    confirmMutation.mutate(state.result.jobPostingId)
  }

  const handleCancel = () => {
    setState({ phase: 'form' })
    submitMutation.reset()
    confirmMutation.reset()
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (state.phase === 'success') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center text-center py-12">
          <span className="text-5xl mb-4" aria-hidden="true">
            🎉
          </span>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Application Queued</h1>
          <p className="text-gray-500 text-sm max-w-sm">
            Your job has been queued for application. You can track progress in the Applications
            dashboard.
          </p>
          <p className="text-xs text-gray-400 mt-2">Task ID: {state.taskId}</p>
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => router.push('/applications')}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              View Applications
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-5 py-2.5 text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              Submit Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Preview state ──────────────────────────────────────────────────────────
  if (state.phase === 'preview') {
    const { result } = state

    return (
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            aria-label="Back to URL form"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Review Job Match</h1>
          <p className="text-gray-500 text-sm mt-1">
            Review the parsed job and your match score before queuing for application.
          </p>
        </div>

        <div className="space-y-4">
          {/* Job preview */}
          <JobPreview job={result.job} isDuplicate={result.duplicate} />

          {/* Score breakdown */}
          <ScoreBreakdown matchScore={result.matchScore} />

          {/* Confirm/cancel actions */}
          <div
            className="flex gap-3 pt-1"
            role="group"
            aria-label="Application confirmation actions"
          >
            <button
              type="button"
              onClick={handleCancel}
              disabled={confirmMutation.isPending}
              className="flex-1 py-3 px-5 text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending}
              aria-busy={confirmMutation.isPending}
              className="flex-1 py-3 px-5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {confirmMutation.isPending ? 'Queueing…' : 'Confirm & Queue Application'}
            </button>
          </div>

          {/* Confirm error */}
          {confirmMutation.isError && (
            <div
              role="alert"
              className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
            >
              <span aria-hidden="true">⚠</span>
              <span>
                {(confirmMutation.error as { response?: { data?: { error?: string } } })?.response?.data
                  ?.error ?? 'Failed to queue application. Please try again.'}
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Submit a Job URL</h1>
        <p className="text-gray-500 text-sm mt-1">
          Paste a job posting URL to parse it and see your match score before applying.
        </p>
      </div>

      {/* URL paste form */}
      <form onSubmit={onSubmit} noValidate>
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <label
            htmlFor="job-url"
            className="block text-sm font-semibold text-gray-700 mb-2"
          >
            Job Posting URL
          </label>
          <input
            id="job-url"
            type="url"
            {...register('url')}
            placeholder="https://company.com/jobs/software-engineer"
            disabled={submitMutation.isPending}
            aria-describedby={errors.url ? 'url-error' : undefined}
            aria-invalid={!!errors.url}
            className="w-full px-4 py-3 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed placeholder-gray-400 transition-colors"
          />
          {errors.url && (
            <p
              id="url-error"
              role="alert"
              className="mt-2 text-sm text-red-600 flex items-center gap-1"
            >
              <span aria-hidden="true">⚠</span>
              {errors.url.message}
            </p>
          )}

          <p className="mt-2 text-xs text-gray-400">
            Supported: most public job boards, company career pages, LinkedIn, Greenhouse, Lever,
            and more.
          </p>
        </div>

        {/* API error */}
        {submitMutation.isError && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              ⚠
            </span>
            <span>
              {(
                submitMutation.error as {
                  response?: { data?: { error?: string } }
                }
              )?.response?.data?.error ??
                'Failed to process the job URL. Please check the URL and try again.'}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitMutation.isPending}
          aria-busy={submitMutation.isPending}
          className="mt-4 w-full py-3 px-6 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitMutation.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                aria-hidden="true"
              />
              Parsing job…
            </span>
          ) : (
            'Parse & Score Job'
          )}
        </button>
      </form>

      {/* Tip */}
      <p className="mt-4 text-xs text-center text-gray-400">
        After parsing, you&apos;ll see a preview and your match score before the job is queued
        for application.
      </p>
    </div>
  )
}
