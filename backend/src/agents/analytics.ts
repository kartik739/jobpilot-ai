/**
 * Analytics Agent
 *
 * Computes application metrics, keyword effectiveness, source performance,
 * ATS success rates, resume version performance, and weekly trends for the
 * Analytics Dashboard.
 *
 * All queries use Prisma ORM (groupBy, count, findMany) — no raw SQL.
 *
 * LLM usage: this agent does not make any LLM calls — all analytics are
 * computed directly from database queries. No getLLMClient() / getLLMModel()
 * imports or llmCallDurationSeconds metrics are needed here.
 * Reviewed for task 12.6 (Requirements: 18.2, 18.3, 19.3).
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8
 */

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'analyticsAgent' });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default look-back period in days (Req 20.1). */
const DEFAULT_PERIOD_DAYS = 30;

/** Maximum supported look-back period in days (Req 20.1). */
const MAX_PERIOD_DAYS = 365;

/** Number of weeks of trend data to return (Req 20.8). */
const TREND_WEEKS = 12;

/**
 * Statuses that count as an "interview" for rate calculations.
 * Requirement 20.1, 20.6
 */
const INTERVIEW_STATUSES = new Set([
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
]);

/**
 * Statuses that count as a "rejection".
 * Requirement 20.1
 */
const REJECTION_STATUSES = new Set(['rejected', 'withdrawn', 'ghosted']);

/**
 * Statuses that count as an "offer".
 * Requirement 20.1
 */
const OFFER_STATUSES = new Set(['offer_received', 'offer_accepted']);

/**
 * Statuses that count as "pending" (still active / no outcome yet).
 * Requirement 20.1
 */
const PENDING_STATUSES = new Set(['submitted', 'under_review']);

/**
 * Statuses that count as "advanced past submitted" for ATS success rate.
 * Requirement 20.4
 */
const ATS_ADVANCED_STATUSES = new Set([
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
  'offer_declined',
]);

// ─── Domain types ─────────────────────────────────────────────────────────────

/** Date range filter (Req 20.1). */
export interface AnalyticsPeriod {
  startDate: Date;
  endDate: Date;
}

/**
 * Summary metrics for the configured date range.
 * Requirement 20.1
 */
export interface ApplicationSummary {
  totalApplications: number;
  interviewRate: number;   // 0–1
  rejectionRate: number;   // 0–1
  offerRate: number;        // 0–1
  pendingCount: number;
}

/**
 * Application count per source platform.
 * Requirement 20.2
 */
export interface SourcePerformanceItem {
  source: string;
  applicationCount: number;
}

/**
 * Application count per tech stack / required skill.
 * Requirement 20.3
 */
export interface StackPerformanceItem {
  skill: string;
  applicationCount: number;
}

/**
 * ATS success rate (0–1).
 * Requirement 20.4
 */
// exported as number from getAtsSuccessRate()

/**
 * Keyword with its associated response rate.
 * Requirement 20.5
 */
export interface KeywordEffectivenessItem {
  keyword: string;
  totalApplications: number;
  responseCount: number;
  responseRate: number; // 0–1
}

/**
 * Resume version performance.
 * Requirement 20.6
 */
export interface ResumeVersionPerformanceItem {
  resumeVersionId: string;
  name: string;
  specialization: string;
  totalApplications: number;
  interviewCount: number;
  interviewRate: number; // 0–1
}

/**
 * Weekly trend data point.
 * Requirement 20.8
 */
export interface WeeklyTrendPoint {
  /** ISO 8601 date string for the Monday of the week. */
  weekStart: string;
  applicationCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a default 30-day period ending now, clamped to the max of 365 days.
 */
function buildPeriod(period?: Partial<AnalyticsPeriod>): AnalyticsPeriod {
  const endDate = period?.endDate ?? new Date();
  let startDate = period?.startDate ?? new Date(endDate.getTime() - DEFAULT_PERIOD_DAYS * 86400_000);

  // Clamp to max 365 days
  const maxStart = new Date(endDate.getTime() - MAX_PERIOD_DAYS * 86400_000);
  if (startDate < maxStart) {
    startDate = maxStart;
  }

  return { startDate, endDate };
}

/**
 * Return the Monday (UTC) of the week containing `date`.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Format a Date as an ISO 8601 date string (YYYY-MM-DD) in UTC.
 */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── AnalyticsAgent ───────────────────────────────────────────────────────────

export class AnalyticsAgent {
  private readonly db: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.db = (prismaClient ?? defaultPrisma) as PrismaClient;
  }

  // ── getApplicationSummary ─────────────────────────────────────────────────

  /**
   * Return summary metrics for the given date range.
   *
   * Default period: last 30 days. Maximum period: 365 days.
   * Uses Prisma `groupBy` to count by status — no raw SQL.
   *
   * Requirements: 20.1
   */
  async getApplicationSummary(
    userId: string,
    period?: Partial<AnalyticsPeriod>,
  ): Promise<ApplicationSummary> {
    const { startDate, endDate } = buildPeriod(period);

    log.info({ userId, startDate, endDate }, 'Computing application summary');

    // Count applications in period, grouped by status
    const grouped = await this.db.applicationRecord.groupBy({
      by: ['status'],
      where: {
        userId,
        appliedAt: { gte: startDate, lte: endDate },
      },
      _count: { status: true },
    });

    let totalApplications = 0;
    let interviewCount = 0;
    let rejectionCount = 0;
    let offerCount = 0;
    let pendingCount = 0;

    for (const row of grouped) {
      const n = row._count.status;
      totalApplications += n;

      if (INTERVIEW_STATUSES.has(row.status)) interviewCount += n;
      if (REJECTION_STATUSES.has(row.status)) rejectionCount += n;
      if (OFFER_STATUSES.has(row.status)) offerCount += n;
      if (PENDING_STATUSES.has(row.status)) pendingCount += n;
    }

    const safeTotal = totalApplications > 0 ? totalApplications : 1;

    return {
      totalApplications,
      interviewRate: interviewCount / safeTotal,
      rejectionRate: rejectionCount / safeTotal,
      offerRate: offerCount / safeTotal,
      pendingCount,
    };
  }

  // ── getSourcePerformance ──────────────────────────────────────────────────

  /**
   * Count applications grouped by source platform.
   *
   * Requirements: 20.2
   */
  async getSourcePerformance(userId: string): Promise<SourcePerformanceItem[]> {
    log.info({ userId }, 'Computing source performance');

    const grouped = await this.db.applicationRecord.groupBy({
      by: ['source'],
      where: { userId },
      _count: { source: true },
      orderBy: { _count: { source: 'desc' } },
    });

    return grouped.map((row) => ({
      source: row.source,
      applicationCount: row._count.source,
    }));
  }

  // ── getStackPerformance ───────────────────────────────────────────────────

  /**
   * Count applications grouped by tech stack / required skills from matched jobs.
   *
   * Fetches all applications with their associated job postings and expands
   * the requiredSkills array to build per-skill counts.
   *
   * Requirements: 20.3
   */
  async getStackPerformance(userId: string): Promise<StackPerformanceItem[]> {
    log.info({ userId }, 'Computing stack performance');

    const applications = await this.db.applicationRecord.findMany({
      where: { userId },
      select: {
        jobPosting: {
          select: { requiredSkills: true },
        },
      },
    });

    const skillCounts = new Map<string, number>();

    for (const app of applications) {
      for (const skill of app.jobPosting.requiredSkills) {
        const normalized = skill.trim().toLowerCase();
        if (normalized) {
          skillCounts.set(normalized, (skillCounts.get(normalized) ?? 0) + 1);
        }
      }
    }

    return Array.from(skillCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([skill, applicationCount]) => ({ skill, applicationCount }));
  }

  // ── getAtsSuccessRate ─────────────────────────────────────────────────────

  /**
   * Return the proportion of ATS applications that advanced past `submitted`
   * status (i.e., reached phone_screen or beyond).
   *
   * ATS platforms are identified by the `source` field matching known ATS names.
   * Returns 0 when there are no ATS applications.
   *
   * Requirements: 20.4
   */
  async getAtsSuccessRate(userId: string): Promise<number> {
    log.info({ userId }, 'Computing ATS success rate');

    // All ATS sources — platforms that use Greenhouse, Lever, Ashby, Workday,
    // SmartRecruiters. Any source not flagged as a social/generic board is ATS.
    const NON_ATS_SOURCES = new Set(['linkedin', 'indeed', 'twitter_x', 'remoteok', 'naukri', 'wellfound', 'ycombinator']);

    const allApplications = await this.db.applicationRecord.findMany({
      where: { userId },
      select: { source: true, status: true },
    });

    const atsApps = allApplications.filter(
      (app) => !NON_ATS_SOURCES.has(app.source.toLowerCase()),
    );

    if (atsApps.length === 0) return 0;

    const advancedCount = atsApps.filter((app) =>
      ATS_ADVANCED_STATUSES.has(app.status),
    ).length;

    return advancedCount / atsApps.length;
  }

  // ── getKeywordEffectiveness ───────────────────────────────────────────────

  /**
   * Compute keyword effectiveness: keywords (from job requiredSkills) correlated
   * with higher response rates (i.e., reaching interview/offer status).
   *
   * For each keyword, count total applications featuring it and how many
   * resulted in a response (interview_statuses or offer).
   *
   * Requirements: 20.5
   */
  async getKeywordEffectiveness(userId: string): Promise<KeywordEffectivenessItem[]> {
    log.info({ userId }, 'Computing keyword effectiveness');

    const applications = await this.db.applicationRecord.findMany({
      where: { userId },
      select: {
        status: true,
        jobPosting: {
          select: { requiredSkills: true },
        },
      },
    });

    // keyword → { total, responses }
    const keywordStats = new Map<string, { total: number; responses: number }>();

    for (const app of applications) {
      const isResponse = INTERVIEW_STATUSES.has(app.status) || OFFER_STATUSES.has(app.status);

      for (const skill of app.jobPosting.requiredSkills) {
        const keyword = skill.trim().toLowerCase();
        if (!keyword) continue;

        const stats = keywordStats.get(keyword) ?? { total: 0, responses: 0 };
        stats.total += 1;
        if (isResponse) stats.responses += 1;
        keywordStats.set(keyword, stats);
      }
    }

    return Array.from(keywordStats.entries())
      .map(([keyword, stats]) => ({
        keyword,
        totalApplications: stats.total,
        responseCount: stats.responses,
        responseRate: stats.total > 0 ? stats.responses / stats.total : 0,
      }))
      .sort((a, b) => b.responseRate - a.responseRate || b.totalApplications - a.totalApplications);
  }

  // ── getResumeVersionPerformance ───────────────────────────────────────────

  /**
   * Compute interview rate per ResumeVersion.
   *
   * interviewRate = interview_count / total_applications for each resumeVersionId.
   *
   * Requirements: 20.6
   */
  async getResumeVersionPerformance(userId: string): Promise<ResumeVersionPerformanceItem[]> {
    log.info({ userId }, 'Computing resume version performance');

    // Get all resume versions for this user
    const resumeVersions = await this.db.resumeVersion.findMany({
      where: { userId },
      select: { id: true, name: true, specialization: true },
    });

    if (resumeVersions.length === 0) return [];

    // Count all applications grouped by resumeVersionId and status
    const grouped = await this.db.applicationRecord.groupBy({
      by: ['resumeVersionId', 'status'],
      where: { userId },
      _count: { status: true },
    });

    // Build per-version stats
    const versionStats = new Map<string, { total: number; interviews: number }>();

    for (const row of grouped) {
      const stats = versionStats.get(row.resumeVersionId) ?? { total: 0, interviews: 0 };
      stats.total += row._count.status;
      if (INTERVIEW_STATUSES.has(row.status)) {
        stats.interviews += row._count.status;
      }
      versionStats.set(row.resumeVersionId, stats);
    }

    return resumeVersions.map((rv) => {
      const stats = versionStats.get(rv.id) ?? { total: 0, interviews: 0 };
      return {
        resumeVersionId: rv.id,
        name: rv.name,
        specialization: rv.specialization,
        totalApplications: stats.total,
        interviewCount: stats.interviews,
        interviewRate: stats.total > 0 ? stats.interviews / stats.total : 0,
      };
    });
  }

  // ── getWeeklyTrend ────────────────────────────────────────────────────────

  /**
   * Return application counts for the last 12 weeks, grouped by week.
   *
   * Each data point is keyed by the Monday (UTC) of that week.
   * Weeks with zero applications are included with count 0.
   *
   * Requirements: 20.8
   */
  async getWeeklyTrend(userId: string): Promise<WeeklyTrendPoint[]> {
    log.info({ userId }, 'Computing weekly trend');

    const now = new Date();
    const startDate = new Date(now.getTime() - TREND_WEEKS * 7 * 86400_000);

    const applications = await this.db.applicationRecord.findMany({
      where: {
        userId,
        appliedAt: { gte: startDate },
      },
      select: { appliedAt: true },
    });

    // Build a map of weekStart ISO → count
    const weekCounts = new Map<string, number>();

    // Pre-populate all 12 weeks with 0
    for (let w = 0; w < TREND_WEEKS; w++) {
      const weekDate = new Date(now.getTime() - (TREND_WEEKS - 1 - w) * 7 * 86400_000);
      const key = toISODate(getWeekStart(weekDate));
      weekCounts.set(key, 0);
    }

    for (const app of applications) {
      const key = toISODate(getWeekStart(app.appliedAt));
      if (weekCounts.has(key)) {
        weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
      }
    }

    // Return sorted ascending by week
    return Array.from(weekCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, applicationCount]) => ({ weekStart, applicationCount }));
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

/** Default singleton analytics agent using the shared Prisma client. */
export const analyticsAgent = new AnalyticsAgent();
