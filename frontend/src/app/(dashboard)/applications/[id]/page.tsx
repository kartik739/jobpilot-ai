'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  getApplication,
  updateApplicationNotes,
  getScreenshotUrl,
  type ApplicationRecord,
  type ApplicationStatus,
  type StatusTransition,
  type MatchScoreSnapshot,
} from '@/lib/applications-api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatStatus(status: ApplicationStatus | string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function statusBadgeColors(status: ApplicationStatus | string): string {
  if (['offer_accepted', 'offer_received'].includes(status)) return 'bg-green-100 text-green-800 border-green-200'
  if (['rejected', 'offer_declined', 'failed_submission'].includes(status)) return 'bg-red-100 text-red-800 border-red-200'
  if (['withdrawn', 'ghosted'].includes(status)) return 'bg-gray-100 text-gray-700 border-gray-200'
  if (['final_round', 'technical_interview', 'phone_screen'].includes(status)) return 'bg-blue-100 text-blue-800 border-blue-200'
  if (status === 'submitted' || status === 'under_review') return 'bg-indigo-100 text-indigo-800 border-indigo-200'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

/** Determine timeline dot color based on the transition's "to" status */
function timelineDotColor(to: string): string {
  if (['offer_accepted', 'offer_received', 'phone_screen', 'technical_interview', 'final_round'].includes(to))
    return 'bg-green-500'
  if (['rejected', 'offer_declined', 'failed_submission', 'withdrawn', 'ghosted'].includes(to))
    return 'bg-red-400'
  return 'bg-gray-400'
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading application details">
      <div className="h-7 w-72 bg-gray-200 rounded" />
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <div className="h-5 w-40 bg-gray-200 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-4 w-4 bg-gray-200 rounded-full mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-4 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4">
      <span aria-hidden="true" className="text-lg leading-none mt-0.5">⚠</span>
      <div>
        <p className="font-semibold text-sm">Failed to load application</p>
        <p className="text-sm mt-0.5 text-red-600">{message}</p>
      </div>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ApplicationStatus | string }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${statusBadgeColors(status)}`}
      aria-label={`Status: ${formatStatus(status)}`}
    >
      {formatStatus(status)}
    </span>
  )
}

// ─── Timeline section ─────────────────────────────────────────────────────────

function TimelineSection({ transitions }: { transitions: StatusTransition[] }) {
  const sorted = [...transitions].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )

  return (
    <section aria-labelledby="timeline-heading" className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 id="timeline-heading" className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span aria-hidden="true">🕐</span>
        Status History
      </h2>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No status transitions recorded yet.</p>
      ) : (
        <ol className="relative border-l border-gray-200 ml-2 space-y-5" aria-label="Application status timeline">
          {sorted.map((t) => (
            <li key={t.id} className="ml-4">
              {/* Timeline dot */}
              <span
                className={`absolute -left-2 flex items-center justify-center w-4 h-4 rounded-full ring-4 ring-white ${timelineDotColor(t.to)}`}
                aria-hidden="true"
              />

              <div className="pl-1">
                {/* Transition label */}
                <p className="text-sm font-semibold text-gray-800">
                  <span className="text-gray-500">{formatStatus(t.from)}</span>
                  <span className="mx-1.5 text-gray-400" aria-hidden="true">→</span>
                  <span>{formatStatus(t.to)}</span>
                </p>

                {/* Meta */}
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatTimestamp(t.timestamp)}
                  {t.triggeredBy && t.triggeredBy !== 'user' && (
                    <span className="ml-2 text-gray-400">via {t.triggeredBy}</span>
                  )}
                </p>

                {/* Optional note */}
                {t.note && (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 mt-1.5 italic">
                    {t.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ─── Match score section ──────────────────────────────────────────────────────

interface ScoreBarProps {
  label: string
  value: number
  weight: string
}

function ScoreBar({ label, value, weight }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value)))
  let barColor: string
  if (pct >= 70) barColor = 'bg-green-500'
  else if (pct >= 40) barColor = 'bg-yellow-400'
  else barColor = 'bg-red-400'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{weight}</span>
          <span className="text-sm font-semibold text-gray-800 w-10 text-right">{pct}%</span>
        </div>
      </div>
      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MatchScoreSection({ snapshot }: { snapshot: MatchScoreSnapshot | Record<string, unknown> }) {
  const s = snapshot as MatchScoreSnapshot

  const overall = typeof s.overall === 'number' ? s.overall : 0
  const skillMatch = typeof s.skillMatch === 'number' ? s.skillMatch : 0
  const experienceMatch = typeof s.experienceMatch === 'number' ? s.experienceMatch : 0
  const locationMatch = typeof s.locationMatch === 'number' ? s.locationMatch : 0
  const salaryMatch = typeof s.salaryMatch === 'number' ? s.salaryMatch : 0
  const technologyMatch = typeof s.technologyMatch === 'number' ? s.technologyMatch : 0
  const workAuthMatch = typeof s.workAuthMatch === 'boolean' ? s.workAuthMatch : null
  const disqualifiers: string[] = Array.isArray(s.disqualifiers) ? s.disqualifiers : []

  const hasAnyScore = [overall, skillMatch, experienceMatch, locationMatch, salaryMatch, technologyMatch].some((v) => v > 0)

  if (!hasAnyScore && disqualifiers.length === 0) {
    return (
      <section aria-labelledby="match-score-heading" className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 id="match-score-heading" className="text-base font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <span aria-hidden="true">📊</span>
          Match Score Breakdown
        </h2>
        <p className="text-sm text-gray-400 italic">No match score data available.</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="match-score-heading" className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 id="match-score-heading" className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span aria-hidden="true">📊</span>
        Match Score Breakdown
      </h2>

      {/* Overall score callout */}
      <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div
          className={`text-2xl font-bold ${Math.round(overall) >= 70 ? 'text-green-600' : Math.round(overall) >= 40 ? 'text-yellow-500' : 'text-red-500'}`}
          aria-label={`Overall match score: ${Math.round(overall)}%`}
        >
          {Math.round(overall)}%
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Overall Match</p>
          {workAuthMatch !== null && (
            <p className={`text-xs mt-0.5 ${workAuthMatch ? 'text-green-600' : 'text-red-500'}`}>
              Work authorization: {workAuthMatch ? '✓ Compatible' : '✗ Incompatible'}
            </p>
          )}
        </div>
      </div>

      {/* Breakdown bars */}
      <div className="space-y-3">
        <ScoreBar label="Skill Match" value={skillMatch} weight="35%" />
        <ScoreBar label="Experience Match" value={experienceMatch} weight="20%" />
        <ScoreBar label="Location Match" value={locationMatch} weight="15%" />
        <ScoreBar label="Salary Match" value={salaryMatch} weight="10%" />
        <ScoreBar label="Technology Match" value={technologyMatch} weight="10%" />
      </div>

      {/* Disqualifiers */}
      {disqualifiers.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">Disqualifiers</p>
          <div className="flex flex-wrap gap-1.5">
            {disqualifiers.map((d) => (
              <span
                key={d}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200"
              >
                {d.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Screenshot thumbnail ─────────────────────────────────────────────────────

function ScreenshotThumbnail({ applicationId, storageKey }: { applicationId: string; storageKey: string }) {
  const { data: url, isLoading, isError } = useQuery({
    queryKey: ['screenshotUrl', applicationId, storageKey],
    queryFn: () => getScreenshotUrl(applicationId, storageKey),
    staleTime: 10 * 60 * 1000, // 10 min — within 15-min presigned window
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="w-32 h-20 bg-gray-100 rounded-lg animate-pulse" aria-hidden="true" />
    )
  }

  if (isError || !url) {
    return (
      <div
        className="w-32 h-20 bg-gray-100 rounded-lg flex items-center justify-center border border-gray-200"
        role="img"
        aria-label="Screenshot unavailable"
      >
        <span className="text-xs text-gray-400">Unavailable</span>
      </div>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open screenshot in new tab (key: ${storageKey})`}
      className="block w-32 h-20 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Application screenshot — ${storageKey}`}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </a>
  )
}

function ScreenshotsSection({ applicationId, screenshotPaths }: { applicationId: string; screenshotPaths: string[] }) {
  return (
    <section aria-labelledby="screenshots-heading" className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 id="screenshots-heading" className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span aria-hidden="true">🖼</span>
        Screenshots
      </h2>

      {screenshotPaths.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No screenshots captured for this application.</p>
      ) : (
        <div className="flex flex-wrap gap-3" role="list" aria-label="Application screenshots">
          {screenshotPaths.map((key) => (
            <div key={key} role="listitem">
              <ScreenshotThumbnail applicationId={applicationId} storageKey={key} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Notes section ────────────────────────────────────────────────────────────

function NotesSection({ application }: { application: ApplicationRecord }) {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(application.notes ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const notesMutation = useMutation({
    mutationFn: (notes: string) => updateApplicationNotes(application.id, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application', application.id] })
      setIsEditing(false)
      setSaveError(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    },
    onError: (err: Error) => {
      setSaveError(err.message ?? 'Failed to save notes.')
    },
  })

  const handleSave = () => {
    setSaveError(null)
    notesMutation.mutate(draft)
  }

  const handleCancel = () => {
    setDraft(application.notes ?? '')
    setIsEditing(false)
    setSaveError(null)
  }

  return (
    <section aria-labelledby="notes-heading" className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 id="notes-heading" className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <span aria-hidden="true">📝</span>
          Notes
        </h2>
        {!isEditing && (
          <button
            type="button"
            onClick={() => { setIsEditing(true); setDraft(application.notes ?? '') }}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
            aria-label="Edit notes"
          >
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            disabled={notesMutation.isPending}
            aria-label="Application notes"
            placeholder="Add notes about this application…"
            className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-gray-300 rounded-lg leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />

          {saveError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={notesMutation.isPending}
              aria-busy={notesMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {notesMutation.isPending ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={notesMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {saveSuccess && (
            <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
              Notes saved successfully.
            </p>
          )}
          {application.notes ? (
            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{application.notes}</p>
          ) : (
            <p className="text-sm text-gray-400 italic">No notes yet. Click Edit to add some.</p>
          )}
        </div>
      )}
    </section>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ApplicationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : (params?.id?.[0] ?? '')

  const { data: application, isLoading, isError, error } = useQuery({
    queryKey: ['application', id],
    queryFn: () => getApplication(id),
    enabled: Boolean(id),
    retry: 1,
  })

  const title = application?.jobPosting?.title ?? 'Application'
  const company = application?.jobPosting?.company ?? ''

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
        aria-label="Go back to applications"
      >
        <span aria-hidden="true">←</span>
        Back to Applications
      </button>

      {isLoading && <LoadingSkeleton />}

      {isError && (
        <ErrorState message={(error as Error | null)?.message ?? 'An unexpected error occurred.'} />
      )}

      {!isLoading && !isError && application && (
        <>
          {/* Page header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
              {company && <p className="text-gray-500 text-sm mt-1">{company}</p>}
            </div>
            <StatusBadge status={application.status} />
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/applications/${id}/materials`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              <span aria-hidden="true">📎</span>
              View Materials
            </Link>
            {application.applicationUrl && (
              <a
                href={application.applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <span aria-hidden="true">↗</span>
                Job Posting
              </a>
            )}
          </div>

          {/* Timeline */}
          <TimelineSection transitions={application.transitions ?? []} />

          {/* Match score breakdown */}
          {application.matchScoreSnapshot && Object.keys(application.matchScoreSnapshot).length > 0 && (
            <MatchScoreSection snapshot={application.matchScoreSnapshot} />
          )}

          {/* Screenshots */}
          <ScreenshotsSection
            applicationId={id}
            screenshotPaths={application.screenshotPaths ?? []}
          />

          {/* Notes */}
          <NotesSection application={application} />
        </>
      )}
    </div>
  )
}
