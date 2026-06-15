'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getAnalyticsSummary,
  getAnalyticsSources,
  getAnalyticsStack,
  getAnalyticsKeywords,
  getAnalyticsResumeVersions,
  getAnalyticsWeeklyTrend,
} from '@/lib/analytics-api'
import { KpiCards } from './components/KpiCards'
import { SourcesChart } from './components/SourcesChart'
import { StackChart } from './components/StackChart'
import { WeeklyTrendChart } from './components/WeeklyTrendChart'
import { KeywordsTable } from './components/KeywordsTable'
import { ResumeVersionsTable } from './components/ResumeVersionsTable'
import { DateRangePicker } from './components/DateRangePicker'

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)

  // All queries use staleTime of 5 minutes for stale-while-revalidate behaviour
  const STALE_TIME = 5 * 60 * 1000

  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', days],
    queryFn: () => getAnalyticsSummary(days),
    staleTime: STALE_TIME,
  })

  const sourcesQuery = useQuery({
    queryKey: ['analytics', 'sources', days],
    queryFn: () => getAnalyticsSources(days),
    staleTime: STALE_TIME,
  })

  const stackQuery = useQuery({
    queryKey: ['analytics', 'stack', days],
    queryFn: () => getAnalyticsStack(days),
    staleTime: STALE_TIME,
  })

  const keywordsQuery = useQuery({
    queryKey: ['analytics', 'keywords'],
    queryFn: () => getAnalyticsKeywords(),
    staleTime: STALE_TIME,
  })

  const resumeVersionsQuery = useQuery({
    queryKey: ['analytics', 'resume-versions'],
    queryFn: () => getAnalyticsResumeVersions(),
    staleTime: STALE_TIME,
  })

  const trendQuery = useQuery({
    queryKey: ['analytics', 'weekly-trend'],
    queryFn: () => getAnalyticsWeeklyTrend(),
    staleTime: STALE_TIME,
  })

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">
            Track your job search performance and identify what works
          </p>
        </div>
        <DateRangePicker value={days} onChange={setDays} />
      </div>

      {/* KPI Summary Cards */}
      <section aria-labelledby="kpi-heading" className="mb-8">
        <h2 id="kpi-heading" className="sr-only">
          Key performance indicators
        </h2>
        <KpiCards
          data={summaryQuery.data}
          isLoading={summaryQuery.isLoading}
          isError={summaryQuery.isError}
        />
      </section>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        {/* Applications by source */}
        <section
          aria-labelledby="sources-heading"
          className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
        >
          <h2 id="sources-heading" className="text-base font-semibold text-gray-900 mb-4">
            Applications by Source
          </h2>
          <SourcesChart
            data={sourcesQuery.data}
            isLoading={sourcesQuery.isLoading}
            isError={sourcesQuery.isError}
          />
        </section>

        {/* Applications by tech stack */}
        <section
          aria-labelledby="stack-heading"
          className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
        >
          <h2 id="stack-heading" className="text-base font-semibold text-gray-900 mb-4">
            Applications by Tech Stack
          </h2>
          <StackChart
            data={stackQuery.data}
            isLoading={stackQuery.isLoading}
            isError={stackQuery.isError}
          />
        </section>
      </div>

      {/* Weekly trend — full width */}
      <section
        aria-labelledby="trend-heading"
        className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-8"
      >
        <h2 id="trend-heading" className="text-base font-semibold text-gray-900 mb-4">
          Weekly Application Trend (Last 12 Weeks)
        </h2>
        <WeeklyTrendChart
          data={trendQuery.data}
          isLoading={trendQuery.isLoading}
          isError={trendQuery.isError}
        />
      </section>

      {/* Tables row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Keyword effectiveness */}
        <section
          aria-labelledby="keywords-heading"
          className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
        >
          <h2 id="keywords-heading" className="text-base font-semibold text-gray-900 mb-4">
            Keyword Effectiveness
          </h2>
          <KeywordsTable
            data={keywordsQuery.data}
            isLoading={keywordsQuery.isLoading}
            isError={keywordsQuery.isError}
          />
        </section>

        {/* Resume version performance */}
        <section
          aria-labelledby="resume-heading"
          className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
        >
          <h2 id="resume-heading" className="text-base font-semibold text-gray-900 mb-4">
            Resume Version Performance
          </h2>
          <ResumeVersionsTable
            data={resumeVersionsQuery.data}
            isLoading={resumeVersionsQuery.isLoading}
            isError={resumeVersionsQuery.isError}
          />
        </section>
      </div>
    </div>
  )
}
