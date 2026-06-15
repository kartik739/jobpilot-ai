'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { runSourceNow, type JobSource, type SourceStatus } from '@/lib/sources-api'

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable relative time, e.g. "2 hours ago" */
function relativeTime(isoTimestamp: string): string {
  const then = new Date(isoTimestamp).getTime()
  const now = Date.now()
  const diffMs = now - then

  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`

  const years = Math.floor(months / 12)
  return `${years} year${years !== 1 ? 's' : ''} ago`
}

/** Display label for platform identifiers */
function platformLabel(platform: string): string {
  const labels: Record<string, string> = {
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    ashby: 'Ashby',
    workday: 'Workday',
    smartrecruiters: 'SmartRecruiters',
    wellfound: 'Wellfound',
    ycombinator: 'Y Combinator Jobs',
    remoteok: 'RemoteOK',
    indeed: 'Indeed',
    naukri: 'Naukri',
    linkedin: 'LinkedIn',
    twitter_x: 'X / Twitter',
    custom_url: 'Custom URL',
  }
  return labels[platform] ?? platform
}

// ─── Status badge ──────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: SourceStatus
  isRunning: boolean
}

function StatusBadge({ status, isRunning }: StatusBadgeProps) {
  if (isRunning) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200"
        aria-label="Status: running"
      >
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
        Running…
      </span>
    )
  }

  const config: Record<SourceStatus, { label: string; className: string; dot: string }> = {
    success: {
      label: 'Active',
      className: 'bg-green-100 text-green-800 border-green-200',
      dot: 'bg-green-500',
    },
    rate_limited: {
      label: 'Rate Limited',
      className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      dot: 'bg-yellow-500',
    },
    error: {
      label: 'Error',
      className: 'bg-red-100 text-red-800 border-red-200',
      dot: 'bg-red-500',
    },
    never_run: {
      label: 'Never Run',
      className: 'bg-gray-100 text-gray-600 border-gray-200',
      dot: 'bg-gray-400',
    },
  }

  const { label, className, dot } = config[status] ?? config.never_run

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${className}`}
      aria-label={`Status: ${label}`}
    >
      <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}

// ─── Platform icon ─────────────────────────────────────────────────────────────

function PlatformIcon({ platform }: { platform: string }) {
  const icons: Record<string, string> = {
    greenhouse: '🌿',
    lever: '⚙',
    ashby: '🔮',
    workday: '💼',
    smartrecruiters: '🎯',
    wellfound: '🚀',
    ycombinator: '🦄',
    remoteok: '🌍',
    indeed: '🔍',
    naukri: '📋',
    linkedin: '🔗',
    twitter_x: '𝕏',
    custom_url: '🔧',
  }
  return (
    <span className="text-xl" aria-hidden="true">
      {icons[platform] ?? '📡'}
    </span>
  )
}

// ─── SourceCard ────────────────────────────────────────────────────────────────

interface SourceCardProps {
  source: JobSource
}

export function SourceCard({ source }: SourceCardProps) {
  const queryClient = useQueryClient()
  // Local optimistic running state for immediate UI feedback
  const [optimisticRunning, setOptimisticRunning] = useState(false)

  const isRunning = source.isRunning || optimisticRunning

  const runNowMutation = useMutation({
    mutationFn: () => runSourceNow(source.id),
    onMutate: () => {
      // Immediately disable the button for this card
      setOptimisticRunning(true)
    },
    onSuccess: () => {
      // Refetch sources list so isRunning flag from server is reflected
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: () => {
      // Reset optimistic state on error so user can retry
      setOptimisticRunning(false)
    },
  })

  const isButtonDisabled = isRunning || runNowMutation.isPending

  return (
    <article
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4"
      aria-label={`${platformLabel(source.platform)} source configuration`}
    >
      {/* Header row: icon + platform name + status badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <PlatformIcon platform={source.platform} />
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 text-base leading-tight truncate">
              {platformLabel(source.platform)}
            </h2>
            {!source.enabled && (
              <p className="text-xs text-gray-400 mt-0.5">Disabled</p>
            )}
          </div>
        </div>
        <StatusBadge status={source.lastRunStatus} isRunning={isRunning} />
      </div>

      {/* Stats row: last run + jobs found */}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Last Run</dt>
          <dd className="text-gray-800 mt-0.5 font-medium">
            {source.lastRunAt ? (
              <time
                dateTime={source.lastRunAt}
                title={new Date(source.lastRunAt).toLocaleString()}
              >
                {relativeTime(source.lastRunAt)}
              </time>
            ) : (
              <span className="text-gray-400">Never</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Jobs Found</dt>
          <dd className="text-gray-800 mt-0.5 font-medium">
            {source.lastRunAt ? source.lastRunJobsFound.toLocaleString() : '—'}
          </dd>
        </div>
      </dl>

      {/* Error message — only shown when status is 'error' (Requirement 22.2) */}
      {source.lastRunStatus === 'error' && source.errorMessage && (
        <div
          role="alert"
          aria-label="Source error"
          className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg"
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">⚠</span>
          <span className="break-words">{source.errorMessage}</span>
        </div>
      )}

      {/* Rate-limited info */}
      {source.lastRunStatus === 'rate_limited' && (
        <div
          role="status"
          className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs px-3 py-2 rounded-lg"
        >
          <span aria-hidden="true">⏳</span>
          <span>This source is rate limited. It will resume automatically.</span>
        </div>
      )}

      {/* Run Now button (Requirement 22.3, 22.4) */}
      <button
        type="button"
        onClick={() => runNowMutation.mutate()}
        disabled={isButtonDisabled}
        aria-label={
          isButtonDisabled
            ? `${platformLabel(source.platform)} is currently running`
            : `Run ${platformLabel(source.platform)} now`
        }
        className="w-full py-2 px-4 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 border-blue-600 text-blue-600 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-transparent"
      >
        {isButtonDisabled ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Running…
          </span>
        ) : (
          'Run Now'
        )}
      </button>

      {/* Mutation error feedback */}
      {runNowMutation.isError && (
        <p role="alert" className="text-xs text-red-600 text-center">
          Failed to trigger run. Please try again.
        </p>
      )}
    </article>
  )
}
