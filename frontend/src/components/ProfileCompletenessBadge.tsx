'use client'

import { useQuery } from '@tanstack/react-query'
import { getProfile } from '@/lib/profile-api'

/** Circular SVG progress ring showing profile completeness */
function CircularProgress({ percent }: { percent: number }) {
  const size = 40
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  const color =
    percent >= 100
      ? '#16a34a'   // green-600
      : percent >= 70
      ? '#2563eb'   // blue-600
      : '#f59e0b'   // amber-500

  return (
    <div className="relative inline-flex items-center justify-center" aria-label={`Profile ${percent}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      {/* Percentage text in center */}
      <span
        className="absolute text-[9px] font-bold tabular-nums"
        style={{ color }}
      >
        {percent}%
      </span>
    </div>
  )
}

/** Skeleton placeholder shown while loading */
function SkeletonBadge() {
  return (
    <div className="flex items-center gap-2 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-gray-200" />
      <div className="w-20 h-3 rounded bg-gray-200 hidden sm:block" />
    </div>
  )
}

export default function ProfileCompletenessBadge() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

  // Loading state — show skeleton
  if (isLoading) return <SkeletonBadge />

  // Error or missing profile — hide gracefully
  if (isError || !data) return null

  const percent = typeof data.profileCompleteness === 'number' ? data.profileCompleteness : 0

  return (
    <div className="group relative flex items-center gap-2">
      <CircularProgress percent={percent} />

      {/* Label */}
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-xs font-medium text-gray-700 tabular-nums">
          {percent}% complete
        </span>
        {percent < 100 && (
          <span className="text-[10px] text-gray-400">Complete your profile</span>
        )}
        {percent === 100 && (
          <span className="text-[10px] text-green-600 font-medium">Profile complete ✓</span>
        )}
      </div>

      {/* Tooltip on hover (for mobile / condensed views) */}
      {percent < 100 && (
        <div
          className="absolute top-full right-0 mt-1.5 w-max max-w-[180px] px-3 py-2 text-xs text-white bg-gray-800 rounded-lg shadow-lg
            opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50"
          role="tooltip"
        >
          Complete your profile to unlock automation
        </div>
      )}
    </div>
  )
}
