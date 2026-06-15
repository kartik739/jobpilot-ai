'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { SourcePerformanceItem } from '@/lib/analytics-api'

// ─── Chart colours ─────────────────────────────────────────────────────────────

const BAR_COLOR = '#3b82f6' // blue-500

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-64 bg-gray-50 rounded-lg animate-pulse flex items-end gap-2 px-4 pb-4">
      {[60, 90, 45, 75, 55, 80].map((h, i) => (
        <div
          key={i}
          className="flex-1 bg-gray-200 rounded-t"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-center">
      <p className="text-3xl mb-2" aria-hidden="true">📊</p>
      <p className="text-sm text-gray-500">No source data yet</p>
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface SourcesChartProps {
  data: SourcePerformanceItem[] | undefined
  isLoading: boolean
  isError: boolean
}

export function SourcesChart({ data, isLoading, isError }: SourcesChartProps) {
  if (isLoading) return <ChartSkeleton />

  if (isError) {
    return (
      <div
        role="alert"
        className="h-64 flex items-center justify-center text-sm text-red-600"
      >
        Failed to load source data.
      </div>
    )
  }

  if (!data || data.length === 0) return <EmptyState />

  // Limit to top 10 sources for readability
  const chartData = data.slice(0, 10).map((item) => ({
    name: formatPlatform(item.source),
    count: item.applicationCount,
  }))

  return (
    <div
      role="img"
      aria-label="Bar chart showing application counts by source platform"
      className="h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 8, left: -8, bottom: 4 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={48}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            formatter={(value: number) => [value, 'Applications']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {chartData.map((_entry, index) => (
              <Cell key={`cell-${index}`} fill={BAR_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatPlatform(platform: string): string {
  const names: Record<string, string> = {
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    ashby: 'Ashby',
    workday: 'Workday',
    smartrecruiters: 'SmartRec.',
    wellfound: 'Wellfound',
    ycombinator: 'YC Jobs',
    remoteok: 'RemoteOK',
    indeed: 'Indeed',
    naukri: 'Naukri',
    linkedin: 'LinkedIn',
    twitter_x: 'X/Twitter',
    custom_url: 'Manual',
  }
  return names[platform.toLowerCase()] ?? platform
}
