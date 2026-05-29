'use client'

import { useEffect, useRef } from 'react'
import type { JobMatchWithPosting } from '@/lib/jobs-api'
import { formatDisqualifier } from './JobCard'

// ─── Score components config ───────────────────────────────────────────────────

const SCORE_COMPONENTS: Array<{
  key: keyof Pick<
    JobMatchWithPosting,
    'skillMatch' | 'experienceMatch' | 'locationMatch' | 'salaryMatch' | 'technologyMatch'
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

// The LLM holistic component is not stored as a separate field — show a derived
// value using the remaining weight (10%).  We approximate it from the overall
// after reversing the other components.
function deriveLlmHolistic(job: JobMatchWithPosting): number {
  if (job.disqualifiers.length > 0) return 0
  const weightedOthers =
    job.skillMatch * 0.35 +
    job.experienceMatch * 0.2 +
    job.locationMatch * 0.15 +
    job.salaryMatch * 0.1 +
    job.technologyMatch * 0.1
  // overall = weightedOthers + llm * 0.10 (before boost/clamp)
  // We can't fully recover the pre-boost overall, so derive a best-estimate
  const llm = (job.overall - weightedOthers) / 0.1
  return Math.max(0, Math.min(100, Math.round(llm)))
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

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
      <div className="w-full bg-gray-100 rounded-full h-2.5" role="progressbar" aria-valuenow={rounded} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${rounded}%`}>
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  )
}

// ─── Location helper ────────────────────────────────────────────────────────────

function locationLabel(job: JobMatchWithPosting): string {
  if (job.isRemote) return 'Remote'
  if (job.isHybrid) return 'Hybrid'
  if (job.location.length === 0) return 'Location unknown'
  return job.location.join(', ')
}

// ─── Salary helper ──────────────────────────────────────────────────────────────

function salaryLabel(job: JobMatchWithPosting): string | null {
  if (job.salaryMin == null && job.salaryMax == null) return null
  const currency = job.currency ?? 'USD'
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  if (job.salaryMin != null && job.salaryMax != null) return `${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}`
  if (job.salaryMin != null) return `From ${fmt(job.salaryMin)}`
  return `Up to ${fmt(job.salaryMax!)}`
}

// ─── Overall score ring ─────────────────────────────────────────────────────────

interface ScoreRingProps {
  score: number
}

function ScoreRing({ score }: ScoreRingProps) {
  const rounded = Math.round(score)
  let color: string
  if (rounded >= 70) color = 'text-green-600'
  else if (rounded >= 40) color = 'text-yellow-500'
  else color = 'text-red-500'

  return (
    <div className="flex flex-col items-center">
      <span className={`text-4xl font-bold ${color}`}>{rounded}%</span>
      <span className="text-xs text-gray-400 mt-0.5">Overall Match</span>
    </div>
  )
}

// ─── JobDetailDrawer ───────────────────────────────────────────────────────────

interface JobDetailDrawerProps {
  job: JobMatchWithPosting | null
  /** Whether the user's preferred companies list contains this job's company */
  isPreferredCompany?: boolean
  onClose: () => void
}

export function JobDetailDrawer({ job, isPreferredCompany = false, onClose }: JobDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Focus close button when drawer opens
  useEffect(() => {
    if (job) {
      closeBtnRef.current?.focus()
    }
  }, [job])

  // Trap focus within drawer and close on Escape
  useEffect(() => {
    if (!job) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const drawer = drawerRef.current
      if (!drawer) return
      const focusable = drawer.querySelectorAll<HTMLElement>(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [job, onClose])

  if (!job) return null

  const llmHolistic = deriveLlmHolistic(job)
  const salary = salaryLabel(job)
  const hasDisqualifiers = job.disqualifiers.length > 0

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${job.title} at ${job.company} — match details`}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{job.title}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{job.company}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-500">
              <span>📍 {locationLabel(job)}</span>
              {job.employmentType && (
                <span className="bg-gray-100 px-2 py-0.5 rounded-full">{job.employmentType}</span>
              )}
              {salary && <span className="text-gray-600 font-medium">{salary}</span>}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close job detail panel"
            className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Overall score */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
            <ScoreRing score={job.overall} />
            <div className="text-right text-xs text-gray-400 space-y-1">
              {job.workAuthMatch ? (
                <p className="text-green-600 font-medium">✓ Work auth compatible</p>
              ) : (
                <p className="text-red-500 font-medium">✗ Work auth incompatible</p>
              )}
              <p>Success probability: {Math.round(job.successProbability)}%</p>
            </div>
          </div>

          {/* Preferred company boost */}
          {isPreferredCompany && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
              <span>⭐</span>
              <span className="font-medium">Preferred Company Boost (1.2×)</span>
            </div>
          )}

          {/* Disqualifier badges */}
          {hasDisqualifiers && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Disqualifiers</h3>
              <div className="flex flex-wrap gap-2">
                {job.disqualifiers.map((d) => (
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

          {/* Score breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Score Breakdown</h3>
            <div className="space-y-3">
              {SCORE_COMPONENTS.map((c) => (
                <ProgressBar
                  key={c.key}
                  label={c.label}
                  weight={c.weight}
                  value={job[c.key]}
                />
              ))}
              {/* LLM holistic component */}
              <ProgressBar
                label="LLM Holistic Evaluation"
                weight="10%"
                value={llmHolistic}
              />
            </div>
          </div>

          {/* Skills */}
          {(job.requiredSkills.length > 0 || job.preferredSkills.length > 0) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Skills</h3>
              {job.requiredSkills.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-gray-400 mb-1.5">Required</p>
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
                  <p className="text-xs text-gray-400 mb-1.5">Preferred</p>
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

          {/* Experience */}
          {(job.yearsExperienceMin != null || job.yearsExperienceMax != null) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Experience Required</h3>
              <p className="text-sm text-gray-600">
                {job.yearsExperienceMin != null && job.yearsExperienceMax != null
                  ? `${job.yearsExperienceMin}–${job.yearsExperienceMax} years`
                  : job.yearsExperienceMin != null
                  ? `${job.yearsExperienceMin}+ years`
                  : `Up to ${job.yearsExperienceMax} years`}
              </p>
            </div>
          )}

          {/* Job description */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Job Description</h3>
            {job.descriptionHtml ? (
              <div
                className="prose prose-sm max-w-none text-gray-600 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
              />
            ) : (
              <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
                {job.description}
              </p>
            )}
          </div>
        </div>

        {/* Footer — apply button */}
        <div className="shrink-0 p-4 border-t border-gray-100 bg-white">
          <a
            href={job.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Apply to ${job.title} at ${job.company}`}
            className="flex items-center justify-center gap-2 w-full py-3 px-6 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Apply Now
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </>
  )
}
