/**
 * Job Posting Deduplication
 *
 * Provides fingerprint-based deduplication for job postings before DB insert.
 * The fingerprint is a SHA-256 hash of the normalised title, company, and URL,
 * which uniquely identifies a posting without storing its full content.
 *
 * Two-level dedup strategy (Requirements 7.1, 7.2, 7.4):
 *  1. In-memory: `deduplicatePostings` filters out duplicate fingerprints
 *     within a single batch, keeping the first occurrence.
 *  2. Database: a UNIQUE constraint on the fingerprint column acts as a
 *     second-level guard against race conditions between concurrent workers.
 *
 * Requirements: 7.1, 7.2, 7.4
 */

import { createHash } from 'crypto';
import type { ParsedJobPosting } from './types.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a stable SHA-256 fingerprint for a job posting.
 *
 * The input is `lowercase(title + '|' + company + '|' + url)`, making the
 * fingerprint case-insensitive and resistant to trivial cosmetic differences.
 *
 * @param title   - Job title (use empty string if null).
 * @param company - Company name (use empty string if null).
 * @param url     - Canonical source URL of the posting.
 * @returns       - 64-character lowercase hex string.
 */
export function computeFingerprint(
  title: string,
  company: string,
  url: string,
): string {
  const input = `${title}|${company}|${url}`.toLowerCase();
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Filter a batch of parsed job postings to unique fingerprints.
 *
 * When two postings share a fingerprint the first occurrence is kept and
 * subsequent duplicates are silently dropped.  The relative order of the
 * surviving postings is preserved.
 *
 * Apply this function before inserting postings into the database.  The DB
 * UNIQUE constraint on the fingerprint column handles the residual race
 * condition when multiple workers process overlapping batches concurrently.
 *
 * Requirements: 7.1, 7.2
 *
 * @param jobs - Array of parsed job postings (may contain duplicates).
 * @returns    - New array containing only the first occurrence of each unique
 *               fingerprint.
 */
export function deduplicatePostings(
  jobs: ParsedJobPosting[],
): ParsedJobPosting[] {
  const seen = new Set<string>();
  const result: ParsedJobPosting[] = [];

  for (const job of jobs) {
    const fingerprint = computeFingerprint(
      job.title ?? '',
      job.company ?? '',
      job.sourceUrl,
    );

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(job);
    }
  }

  return result;
}
