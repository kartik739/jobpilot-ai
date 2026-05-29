'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getJobs, type JobMatchWithPosting } from '@/lib/jobs-api'
import { JobCard } from './components/JobCard'
import { JobDetailDrawer } from './components/JobDetailDrawer'

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function JobCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-8 w-12 bg-gray-200 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-3 bg-gray-100 rounded w-16" />
        <div className="h-3 bg-gray-100 rounded w-20" />
      </div>
      <div className="mt-3 flex gap-1.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-5 w-16 bg-gray-100 rounded-md" />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-9 flex-1 bg-gray-100 rounded-lg" />
        <div className="h-9 flex-1 bg-blue-100 rounded-lg" />
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] text-center border-2 border-dashed border-gray-200 rounded-xl py-12 px-6">
      <div className="text-5xl mb-4" aria-hidden="true">🔍</div>
      <p className="text-gray-700 font-semibold text-lg">No job matches yet</p>
      <p className="text-gray-400 text-sm mt-2 max-w-sm">
        Job matches will appear here once the discovery and ranking agents have run.
        Complete your profile to get better results.
      </p>
    </div>
  )
}

// ─── Pagination controls ───────────────────────────────────────────────────────

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <nav
      className="flex items-center justify-center gap-2 mt-6"
      aria-label="Job results pagination"
    >
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        ← Prev
      </button>

      {/* Page numbers — show up to 5 around current page */}
      {buildPageNumbers(page, totalPages).map((item, i) =>
        item === '…' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm select-none">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item as number)}
            aria-label={`Page ${item}`}
            aria-current={item === page ? 'page' : undefined}
            className={`px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
              item === page
                ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        Next →
      </button>
    </nav>
  )
}

function buildPageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: Array<number | '…'> = [1]

  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p)
  }
  if (current < total - 2) pages.push('…')

  pages.push(total)
  return pages
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 20

export default function JobsPage() {
  const [page, setPage] = useState(1)
  const [selectedJob, setSelectedJob] = useState<JobMatchWithPosting | null>(null)

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['jobs', page],
    queryFn: () => getJobs({ page, limit: PAGE_LIMIT }),
    placeholderData: (prev) => prev,
    retry: 1,
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_LIMIT) : 0

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Matches</h1>
          <p className="text-gray-500 text-sm mt-1">
            {data
              ? `${data.total.toLocaleString()} matched job${data.total !== 1 ? 's' : ''}, ranked by match score`
              : 'Ranked by match score'}
          </p>
        </div>
        {isFetching && !isLoading && (
          <span className="text-xs text-gray-400 mt-1.5 animate-pulse">Refreshing…</span>
        )}
      </div>

      {/* Content */}
      {isLoading && <LoadingState />}

      {isError && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
        >
          <span aria-hidden="true">⚠</span>
          <span>Failed to load job matches. Please refresh the page.</span>
        </div>
      )}

      {!isLoading && !isError && data?.jobs.length === 0 && <EmptyState />}

      {!isLoading && !isError && data && data.jobs.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.jobs.map((job) => (
              <JobCard key={job.id} job={job} onViewDetails={setSelectedJob} />
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </>
      )}

      {/* Job detail drawer */}
      <JobDetailDrawer
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
      />
    </div>
  )
}
