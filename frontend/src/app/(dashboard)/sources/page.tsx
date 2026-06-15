'use client'

import { useQuery } from '@tanstack/react-query'
import { getSources } from '@/lib/sources-api'
import { SourceCard } from './components/SourceCard'

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function SourceCardSkeleton() {
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm animate-pulse"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-200 rounded-full" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-gray-100 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="space-y-1.5">
          <div className="h-3 w-16 bg-gray-100 rounded" />
          <div className="h-4 w-24 bg-gray-200 rounded" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-20 bg-gray-100 rounded" />
          <div className="h-4 w-10 bg-gray-200 rounded" />
        </div>
      </div>
      <div className="mt-4 h-9 bg-gray-100 rounded-lg" />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <SourceCardSkeleton key={i} />
      ))}
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] text-center border-2 border-dashed border-gray-200 rounded-xl py-12 px-6">
      <div className="text-5xl mb-4" aria-hidden="true">📡</div>
      <p className="text-gray-700 font-semibold text-lg">No sources configured</p>
      <p className="text-gray-400 text-sm mt-2 max-w-sm">
        Configure job sources during onboarding or in your preferences to start
        discovering opportunities automatically.
      </p>
    </div>
  )
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

interface SummaryBarProps {
  total: number
  active: number
  errors: number
  rateLimited: number
}

function SummaryBar({ total, active, errors, rateLimited }: SummaryBarProps) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Sources</dt>
        <dd className="text-2xl font-bold text-gray-900 mt-1">{total}</dd>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Active</dt>
        <dd className="text-2xl font-bold text-green-600 mt-1">{active}</dd>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Errors</dt>
        <dd className="text-2xl font-bold text-red-600 mt-1">{errors}</dd>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
        <dt className="text-xs text-gray-500 uppercase tracking-wide font-medium">Rate Limited</dt>
        <dd className="text-2xl font-bold text-yellow-600 mt-1">{rateLimited}</dd>
      </div>
    </dl>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const { data: sources, isLoading, isError, isFetching } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
    // Poll every 15 seconds to keep isRunning state fresh
    refetchInterval: 15_000,
    retry: 1,
  })

  const summary = sources
    ? {
        total: sources.length,
        active: sources.filter((s) => s.lastRunStatus === 'success').length,
        errors: sources.filter((s) => s.lastRunStatus === 'error').length,
        rateLimited: sources.filter((s) => s.lastRunStatus === 'rate_limited').length,
      }
    : null

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Source Health</h1>
          <p className="text-gray-500 text-sm mt-1">
            {sources
              ? `${sources.length} job source${sources.length !== 1 ? 's' : ''} configured`
              : 'Monitor and trigger your job discovery sources'}
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-gray-400 mt-1.5 animate-pulse" aria-live="polite">
            Refreshing…
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && <LoadingState />}

      {/* Error */}
      {isError && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
        >
          <span aria-hidden="true">⚠</span>
          <span>Failed to load sources. Please refresh the page.</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && sources?.length === 0 && <EmptyState />}

      {/* Sources list */}
      {!isLoading && !isError && sources && sources.length > 0 && (
        <>
          {/* Summary KPI bar */}
          {summary && (
            <SummaryBar
              total={summary.total}
              active={summary.active}
              errors={summary.errors}
              rateLimited={summary.rateLimited}
            />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
