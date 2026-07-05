/**
 * Prometheus metrics instrumentation
 *
 * Defines and exports all application-level Prometheus metrics:
 *   - jobpilot_jobs_discovered_total      — Counter (label: platform)
 *   - jobpilot_applications_submitted_total — Counter (label: status)
 *   - jobpilot_llm_call_duration_seconds  — Histogram (label: operation)
 *   - jobpilot_task_queue_depth           — Gauge (label: task_type)
 *
 * Also collects the default Node.js runtime metrics via collectDefaultMetrics().
 *
 * Requirements: 30.3
 */

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

// Use a dedicated registry so that tests can import this module without
// polluting the global default registry between test runs.
export const register = new Registry();

// Collect standard Node.js process metrics (memory, CPU, event-loop lag, etc.)
collectDefaultMetrics({ register });

// ─── Counters ─────────────────────────────────────────────────────────────────

/**
 * Total number of job listings discovered, labelled by source platform.
 *
 * Usage:
 *   jobsDiscoveredTotal.inc({ platform: 'linkedin' });
 */
export const jobsDiscoveredTotal = new Counter({
  name: 'jobpilot_jobs_discovered_total',
  help: 'Total number of job listings discovered from external sources',
  labelNames: ['platform'] as const,
  registers: [register],
});

/**
 * Total number of job applications submitted, labelled by outcome status.
 *
 * Suggested status values: 'submitted', 'failed', 'skipped'
 *
 * Usage:
 *   applicationsSubmittedTotal.inc({ status: 'submitted' });
 */
export const applicationsSubmittedTotal = new Counter({
  name: 'jobpilot_applications_submitted_total',
  help: 'Total number of job applications submitted',
  labelNames: ['status'] as const,
  registers: [register],
});

// ─── Histograms ───────────────────────────────────────────────────────────────

/**
 * Duration of LLM API calls in seconds, labelled by operation name.
 *
 * Buckets are chosen to cover the typical range of LLM latencies (50 ms – 30 s).
 *
 * Usage:
 *   const end = llmCallDurationSeconds.startTimer({ operation: 'cover_letter' });
 *   // ... await llm call ...
 *   end();
 */
export const llmCallDurationSeconds = new Histogram({
  name: 'jobpilot_llm_call_duration_seconds',
  help: 'Duration of LLM API calls in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30],
  registers: [register],
});

// ─── Gauges ───────────────────────────────────────────────────────────────────

/**
 * Current number of pending tasks in the job queue, labelled by task type.
 *
 * Suggested task_type values match the BullMQ queue names:
 *   'discovery', 'application', 'email', 'analytics', 'ranking'
 *
 * Usage:
 *   taskQueueDepth.set({ task_type: 'discovery' }, waitingCount);
 */
export const taskQueueDepth = new Gauge({
  name: 'jobpilot_task_queue_depth',
  help: 'Current number of pending tasks in the queue by task type',
  labelNames: ['task_type'] as const,
  registers: [register],
});
