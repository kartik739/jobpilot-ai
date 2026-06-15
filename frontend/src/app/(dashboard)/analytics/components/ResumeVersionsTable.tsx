'use client'

import type { ResumeVersionPerformanceItem } from '@/lib/analytics-api'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatSpecialization(s: string): string {
  const map: Record<string, string> = {
    backend: 'Backend',
    frontend: 'Frontend',
    fullstack: 'Full Stack',
    devops: 'DevOps',
    cloud: 'Cloud',
    ai_ml: 'AI/ML',
    mobile: 'Mobile',
    data: 'Data',
    general: 'General',
  }
  return map[s] ?? s
}

// ─── Rate badge ────────────────────────────────────────────────────────────────

function RateBadge({ rate }: { rate: number }) {
  let colorClass: string
  if (rate >= 0.3) colorClass = 'bg-green-100 text-green-800'
  else if (rate >= 0.1) colorClass = 'bg-yellow-100 text-yellow-800'
  else colorClass = 'bg-gray-100 text-gray-600'

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}
    >
      {fmtPct(rate)}
    </span>
  )
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-8 bg-gray-100 rounded" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-gray-50 rounded" />
      ))}
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface ResumeVersionsTableProps {
  data: ResumeVersionPerformanceItem[] | undefined
  isLoading: boolean
  isError: boolean
}

export function ResumeVersionsTable({ data, isLoading, isError }: ResumeVersionsTableProps) {
  if (isLoading) return <TableSkeleton />

  if (isError) {
    return (
      <div
        role="alert"
        className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3"
      >
        Failed to load resume version data.
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-2xl mb-2" aria-hidden="true">📄</p>
        <p className="text-sm text-gray-500">No resume version data yet</p>
      </div>
    )
  }

  // Sort by interview rate descending
  const rows = [...data].sort((a, b) => b.interviewRate - a.interviewRate)

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full text-sm" aria-label="Resume version performance">
        <thead>
          <tr className="border-b border-gray-100">
            <th
              scope="col"
              className="py-2 px-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              Resume
            </th>
            <th
              scope="col"
              className="py-2 px-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              Type
            </th>
            <th
              scope="col"
              className="py-2 px-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              Apps
            </th>
            <th
              scope="col"
              className="py-2 px-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              Interviews
            </th>
            <th
              scope="col"
              className="py-2 px-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide"
            >
              Rate
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((item) => (
            <tr key={item.resumeVersionId} className="hover:bg-gray-50 transition-colors">
              <td className="py-2 px-2 font-medium text-gray-900 truncate max-w-[100px]">
                {item.name}
              </td>
              <td className="py-2 px-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">
                  {formatSpecialization(item.specialization)}
                </span>
              </td>
              <td className="py-2 px-2 text-right text-gray-600">
                {item.totalApplications}
              </td>
              <td className="py-2 px-2 text-right text-gray-600">
                {item.interviewCount}
              </td>
              <td className="py-2 px-2 text-right">
                <RateBadge rate={item.interviewRate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
