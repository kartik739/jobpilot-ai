'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Dot,
} from 'recharts'
import type { WeeklyTrendPoint } from '@/lib/analytics-api'

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-52 bg-gray-50 rounded-lg animate-pulse flex items-center justify-center">
      <div className="w-full h-full px-6 py-4 flex flex-col justify-end gap-1">
        <div className="h-px bg-gray-200 w-full" />
        <div className="flex justify-between">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-3 w-8 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="h-52 flex flex-col items-center justify-center text-center">
      <p className="text-3xl mb-2" aria-hidden="true">📈</p>
      <p className="text-sm text-gray-500">No trend data yet</p>
    </div>
  )
}

// ─── Tooltip ───────────────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-sm">
      <p className="font-medium text-gray-900">{formatWeek(label ?? '')}</p>
      <p className="text-blue-600">
        {payload[0]?.value ?? 0} application{(payload[0]?.value ?? 0) !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface WeeklyTrendChartProps {
  data: WeeklyTrendPoint[] | undefined
  isLoading: boolean
  isError: boolean
}

export function WeeklyTrendChart({ data, isLoading, isError }: WeeklyTrendChartProps) {
  if (isLoading) return <ChartSkeleton />

  if (isError) {
    return (
      <div
        role="alert"
        className="h-52 flex items-center justify-center text-sm text-red-600"
      >
        Failed to load weekly trend data.
      </div>
    )
  }

  if (!data || data.length === 0) return <EmptyState />

  const chartData = data.map((point) => ({
    week: point.weekStart,
    count: point.applicationCount,
    label: formatWeek(point.weekStart),
  }))

  return (
    <div
      role="img"
      aria-label="Line chart showing weekly application counts for the last 12 weeks"
      className="h-52"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, left: -8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            interval={1}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={<Dot r={3} fill="#3b82f6" />}
            activeDot={{ r: 5, fill: '#1d4ed8' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format an ISO date string (YYYY-MM-DD) as a short label like "Jan 6".
 */
function formatWeek(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso + 'T00:00:00Z')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
