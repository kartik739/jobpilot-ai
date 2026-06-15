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
import type { StackPerformanceItem } from '@/lib/analytics-api'

// ─── Chart colours ─────────────────────────────────────────────────────────────

const BAR_COLOR = '#8b5cf6' // violet-500

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-64 bg-gray-50 rounded-lg animate-pulse flex items-end gap-2 px-4 pb-4">
      {[80, 65, 50, 90, 40, 70].map((h, i) => (
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
      <p className="text-3xl mb-2" aria-hidden="true">🛠</p>
      <p className="text-sm text-gray-500">No tech stack data yet</p>
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface StackChartProps {
  data: StackPerformanceItem[] | undefined
  isLoading: boolean
  isError: boolean
}

export function StackChart({ data, isLoading, isError }: StackChartProps) {
  if (isLoading) return <ChartSkeleton />

  if (isError) {
    return (
      <div
        role="alert"
        className="h-64 flex items-center justify-center text-sm text-red-600"
      >
        Failed to load tech stack data.
      </div>
    )
  }

  if (!data || data.length === 0) return <EmptyState />

  // Show top 10 skills
  const chartData = data.slice(0, 10).map((item) => ({
    name: capitalise(item.skill),
    count: item.applicationCount,
  }))

  return (
    <div
      role="img"
      aria-label="Bar chart showing application counts by tech stack"
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

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
