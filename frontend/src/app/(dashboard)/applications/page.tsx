'use client'

import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  getApplications,
  updateApplicationStatus,
  type ApplicationRecord,
  type ApplicationStatus,
} from '@/lib/applications-api'

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Visual groupings for the board columns */
const COLUMN_GROUPS: { label: string; statuses: ApplicationStatus[] }[] = [
  {
    label: 'Active Pipeline',
    statuses: ['draft', 'submitted', 'under_review', 'phone_screen', 'technical_interview', 'final_round'],
  },
  {
    label: 'Offers',
    statuses: ['offer_received', 'offer_accepted', 'offer_declined'],
  },
  {
    label: 'Closed',
    statuses: ['rejected', 'withdrawn', 'ghosted', 'failed_submission'],
  },
]

function formatStatus(status: ApplicationStatus): string {
  const map: Record<ApplicationStatus, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    under_review: 'Under Review',
    phone_screen: 'Phone Screen',
    technical_interview: 'Technical Interview',
    final_round: 'Final Round',
    offer_received: 'Offer Received',
    offer_accepted: 'Offer Accepted',
    offer_declined: 'Offer Declined',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    ghosted: 'Ghosted',
    failed_submission: 'Failed Submission',
  }
  return map[status] ?? status
}

function formatAppliedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | undefined }) {
  if (score === undefined || score === null) return null
  const rounded = Math.round(score)
  let colorClass: string
  if (rounded >= 70) colorClass = 'bg-green-100 text-green-800 border-green-200'
  else if (rounded >= 40) colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200'
  else colorClass = 'bg-red-100 text-red-800 border-red-200'

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${colorClass}`}
      aria-label={`Match score: ${rounded}%`}
    >
      {rounded}%
    </span>
  )
}

// ─── Application card ──────────────────────────────────────────────────────────

interface ApplicationCardProps {
  app: ApplicationRecord
  onDragStart: (e: React.DragEvent, app: ApplicationRecord) => void
}

function ApplicationCard({ app, onDragStart }: ApplicationCardProps) {
  const matchScore =
    app.matchScoreSnapshot && typeof app.matchScoreSnapshot === 'object'
      ? (app.matchScoreSnapshot as Record<string, unknown>).overall
      : undefined
  const score = typeof matchScore === 'number' ? matchScore : undefined
  const company = app.jobPosting?.company ?? '—'
  const title = app.jobPosting?.title ?? 'Unknown Role'

  return (
    <article
      draggable
      onDragStart={(e) => onDragStart(e, app)}
      aria-grabbed="false"
      role="listitem"
      aria-label={`${title} at ${company}`}
      className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing select-none"
    >
      {/* Top row: score + title */}
      <div className="flex items-start gap-2 mb-1.5">
        <ScoreBadge score={score} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug truncate">{title}</p>
          <p className="text-xs text-gray-500 truncate">{company}</p>
        </div>
      </div>

      {/* Applied date */}
      <p className="text-xs text-gray-400 mb-2">
        Applied {formatAppliedDate(app.appliedAt)}
      </p>

      {/* View details link */}
      <Link
        href={`/applications/${app.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-colors"
        aria-label={`View details for ${title} at ${company}`}
        draggable={false}
      >
        View Details →
      </Link>
    </article>
  )
}

// ─── Card skeleton ─────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm animate-pulse">
      <div className="flex items-start gap-2 mb-1.5">
        <div className="h-5 w-10 bg-gray-200 rounded-full shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="h-3.5 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded w-24 mb-2" />
      <div className="h-3 bg-blue-100 rounded w-20" />
    </div>
  )
}

// ─── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  status: ApplicationStatus
  apps: ApplicationRecord[]
  isLoading: boolean
  isDragOver: boolean
  onDragOver: (e: React.DragEvent, status: ApplicationStatus) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, status: ApplicationStatus) => void
  onDragStart: (e: React.DragEvent, app: ApplicationRecord) => void
}

function Column({
  status,
  apps,
  isLoading,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
}: ColumnProps) {
  const label = formatStatus(status)
  const columnId = `column-${status}`

  return (
    <div
      className={`flex flex-col min-w-[200px] w-52 flex-shrink-0 rounded-xl border transition-colors ${
        isDragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-200 bg-gray-100'
      }`}
      onDragOver={(e) => onDragOver(e, status)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, status)}
      aria-dropeffect="move"
    >
      {/* Column header */}
      <div className="px-3 py-2.5 border-b border-gray-200 bg-white rounded-t-xl flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">
          {label}
        </h2>
        {!isLoading && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-xs font-bold text-gray-600">
            {apps.length}
          </span>
        )}
      </div>

      {/* Cards */}
      <ul
        id={columnId}
        role="list"
        aria-label={`${label} applications`}
        className="flex flex-col gap-2 p-2 min-h-[80px] flex-1"
      >
        {isLoading
          ? [1, 2].map((i) => <li key={i}><CardSkeleton /></li>)
          : apps.length === 0
          ? (
            <li className="flex items-center justify-center py-4">
              <p className="text-xs text-gray-400 italic">No applications</p>
            </li>
          )
          : apps.map((app) => (
            <li key={app.id}>
              <ApplicationCard app={app} onDragStart={onDragStart} />
            </li>
          ))}
      </ul>
    </div>
  )
}

// ─── Board group ───────────────────────────────────────────────────────────────

interface BoardGroupProps {
  groupLabel: string
  statuses: ApplicationStatus[]
  appsByStatus: Record<string, ApplicationRecord[]>
  isLoading: boolean
  dragOverStatus: ApplicationStatus | null
  onDragOver: (e: React.DragEvent, status: ApplicationStatus) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, status: ApplicationStatus) => void
  onDragStart: (e: React.DragEvent, app: ApplicationRecord) => void
}

function BoardGroup({
  groupLabel,
  statuses,
  appsByStatus,
  isLoading,
  dragOverStatus,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
}: BoardGroupProps) {
  return (
    <section aria-labelledby={`group-${groupLabel.replace(/\s/g, '-').toLowerCase()}`} className="mb-8">
      <h2
        id={`group-${groupLabel.replace(/\s/g, '-').toLowerCase()}`}
        className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3"
      >
        {groupLabel}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((status) => (
          <Column
            key={status}
            status={status}
            apps={appsByStatus[status] ?? []}
            isLoading={isLoading}
            isDragOver={dragOverStatus === status}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const queryClient = useQueryClient()
  const [dragOverStatus, setDragOverStatus] = useState<ApplicationStatus | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Store dragged card info in a ref (not state — no re-render needed)
  const dragData = useRef<{ appId: string; fromStatus: ApplicationStatus } | null>(null)

  // Fetch all applications (up to 100 — board view)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['applications', 'board'],
    queryFn: () => getApplications({ pageSize: 100 }),
    retry: 1,
  })

  const applications: ApplicationRecord[] = data?.data ?? []

  // Group by status
  const appsByStatus = applications.reduce<Record<string, ApplicationRecord[]>>((acc, app) => {
    if (!acc[app.status]) acc[app.status] = []
    acc[app.status].push(app)
    return acc
  }, {})

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus }) =>
      updateApplicationStatus(id, { status }),
    onMutate: async ({ id, status }) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: ['applications', 'board'] })
      // Snapshot previous data for rollback
      const prev = queryClient.getQueryData(['applications', 'board'])
      // Optimistic update
      queryClient.setQueryData(['applications', 'board'], (old: typeof data) => {
        if (!old) return old
        return {
          ...old,
          data: old.data.map((app) => (app.id === id ? { ...app, status } : app)),
        }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      // Rollback
      if (context?.prev) {
        queryClient.setQueryData(['applications', 'board'], context.prev)
      }
      setErrorMessage('Failed to update application status. Please try again.')
      setTimeout(() => setErrorMessage(null), 4000)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['applications', 'board'] })
    },
  })

  // ── Drag handlers ────────────────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent, app: ApplicationRecord) => {
    dragData.current = { appId: app.id, fromStatus: app.status }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', app.id)
  }

  const handleDragOver = (e: React.DragEvent, status: ApplicationStatus) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStatus(status)
  }

  const handleDragLeave = () => {
    setDragOverStatus(null)
  }

  const handleDrop = (e: React.DragEvent, targetStatus: ApplicationStatus) => {
    e.preventDefault()
    setDragOverStatus(null)

    const { current } = dragData
    if (!current) return
    if (current.fromStatus === targetStatus) return

    statusMutation.mutate({ id: current.appId, status: targetStatus })
    dragData.current = null
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
        <p className="text-gray-500 text-sm mt-1">
          {isLoading ? 'Loading…' : `${applications.length} application${applications.length !== 1 ? 's' : ''} tracked`}
        </p>
      </div>

      {/* Error banner */}
      {(isError || errorMessage) && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4"
        >
          <span aria-hidden="true">⚠</span>
          <span>{errorMessage ?? 'Failed to load applications. Please refresh the page.'}</span>
        </div>
      )}

      {/* Kanban board */}
      {!isError && (
        <>
          {COLUMN_GROUPS.map((group) => (
            <BoardGroup
              key={group.label}
              groupLabel={group.label}
              statuses={group.statuses}
              appsByStatus={appsByStatus}
              isLoading={isLoading}
              dragOverStatus={dragOverStatus}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
            />
          ))}
        </>
      )}
    </div>
  )
}
