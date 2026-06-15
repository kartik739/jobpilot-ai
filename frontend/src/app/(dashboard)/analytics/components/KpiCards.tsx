'use client'

import type { AnalyticsSummary } from '@/lib/analytics-api'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ─── Single card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  description: string
  colorClass: string
  icon: string
}

function KpiCard({ label, value, description, colorClass, icon }: KpiCardProps) {
  return (
    <article
      aria-label={`${label}: ${value}`}
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{label}</span>
        <span className="text-xl" aria-hidden="true">{icon}</span>
      </div>
      <p className={`text-3xl font-bold ${colorClass}`}>{value}</p>
      <p className="text-xs text-gray-400">{description}</p>
    </article>
  )
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────

function KpiCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm animate-pulse flex flex-col gap-2">
      <div className="flex justify-between">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="h-6 w-6 bg-gray-200 rounded" />
      </div>
      <div className="h-8 bg-gray-200 rounded w-16" />
      <div className="h-3 bg-gray-100 rounded w-32" />
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface KpiCardsProps {
  data: AnalyticsSummary | undefined
  isLoading: boolean
  isError: boolean
}

export function KpiCards({ data, isLoading, isError }: KpiCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg"
      >
        <span aria-hidden="true">⚠</span>
        <span>Failed to load summary metrics.</span>
      </div>
    )
  }

  const cards: KpiCardProps[] = [
    {
      label: 'Total Applications',
      value: data.totalApplications.toLocaleString(),
      description: 'Applications submitted in this period',
      colorClass: 'text-gray-900',
      icon: '📋',
    },
    {
      label: 'Interview Rate',
      value: fmtPct(data.interviewRate),
      description: 'Applications that reached interview stage',
      colorClass: data.interviewRate >= 0.1 ? 'text-green-600' : 'text-yellow-600',
      icon: '🎯',
    },
    {
      label: 'Offer Rate',
      value: fmtPct(data.offerRate),
      description: 'Applications that resulted in an offer',
      colorClass: data.offerRate > 0 ? 'text-green-600' : 'text-gray-900',
      icon: '🏆',
    },
    {
      label: 'Pending',
      value: data.pendingCount.toLocaleString(),
      description: 'Applications awaiting a response',
      colorClass: 'text-blue-600',
      icon: '⏳',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((card) => (
        <KpiCard key={card.label} {...card} />
      ))}
    </div>
  )
}
