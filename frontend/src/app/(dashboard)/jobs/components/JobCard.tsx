'use client'

import type { JobMatchWithPosting } from '@/lib/jobs-api'

// ─── Score badge ───────────────────────────────────────────────────────────────

interface ScoreBadgeProps {
  score: number
}

function ScoreBadge({ score }: ScoreBadgeProps) {
  const rounded = Math.round(score)

  let colorClass: string
  if (rounded >= 70) {
    colorClass = 'bg-green-100 text-green-800 border-green-200'
  } else if (rounded >= 40) {
    colorClass = 'bg-yellow-100 text-yellow-800 border-yellow-200'
  } else {
    colorClass = 'bg-red-100 text-red-800 border-red-200'
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold border ${colorClass}`}
      aria-label={`Match score: ${rounded}%`}
    >
      {rounded}%
    </span>
  )
}

// ─── Location label ────────────────────────────────────────────────────────────

function locationLabel(job: JobMatchWithPosting): string {
  if (job.isRemote) return 'Remote'
  if (job.isHybrid) return 'Hybrid'
  const locs = job.location
  if (locs.length === 0) return 'Location unknown'
  return locs.slice(0, 2).join(', ')
}

// ─── JobCard ───────────────────────────────────────────────────────────────────

interface JobCardProps {
  job: JobMatchWithPosting
  onViewDetails: (job: JobMatchWithPosting) => void
}

export function JobCard({ job, onViewDetails }: JobCardProps) {
  // Up to 5 skill chips: required skills first, then preferred
  const visibleSkills = [...job.requiredSkills, ...job.preferredSkills].slice(0, 5)
  const hasDisqualifiers = job.disqualifiers.length > 0

  return (
    <article
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
      aria-label={`${job.title} at ${job.company}`}
    >
      {/* Top row: score + title/company */}
      <div className="flex items-start gap-3">
        <ScoreBadge score={job.overall} />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900 text-base leading-snug truncate">
            {job.title}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{job.company}</p>
        </div>
      </div>

      {/* Location + employment type */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span aria-hidden="true">📍</span>
          {locationLabel(job)}
        </span>
        {job.employmentType && (
          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            {job.employmentType}
          </span>
        )}
        {job.isRemote && (
          <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Remote</span>
        )}
        {job.isHybrid && (
          <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">Hybrid</span>
        )}
      </div>

      {/* Disqualifier warning */}
      {hasDisqualifiers && (
        <div
          role="alert"
          className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5"
        >
          <span aria-hidden="true">⚠</span>
          <span>{job.disqualifiers.map(formatDisqualifier).join(' · ')}</span>
        </div>
      )}

      {/* Skill overlap chips */}
      {visibleSkills.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Matching skills">
          {visibleSkills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200"
            >
              {skill}
            </span>
          ))}
          {job.requiredSkills.length + job.preferredSkills.length > 5 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs text-gray-400">
              +{job.requiredSkills.length + job.preferredSkills.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={() => onViewDetails(job)}
          className="flex-1 py-2 px-4 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          View Details
        </button>
        <a
          href={job.applicationUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Apply to ${job.title} at ${job.company}`}
          className="flex-1 py-2 px-4 text-sm font-medium text-center text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          Apply
        </a>
      </div>
    </article>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function formatDisqualifier(d: string): string {
  switch (d) {
    case 'work_authorization_incompatible':
      return 'Work auth incompatible'
    case 'insufficient_required_skills':
      return 'Insufficient required skills'
    default:
      return d.replace(/_/g, ' ')
  }
}
