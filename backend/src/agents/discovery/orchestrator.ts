/**
 * Discovery Orchestrator
 *
 * Iterates all enabled connectors, calls `discover()` on each, and yields
 * every `RawJobPosting` it receives.  Per-source errors are caught, logged,
 * and do NOT stop the remaining connectors from running.
 *
 * Requirements: 3.11
 */

import type { Logger } from 'pino';
import type { BaseJobDiscoveryConnector } from './base.js';
import type { JobPreferences, RawJobPosting } from './types.js';

/**
 * Iterate all enabled connectors and yield their discovered job postings.
 *
 * Error isolation guarantee:
 *   If a connector throws at any point during iteration, the error is caught
 *   and logged as a warning.  The orchestrator then moves on to the next
 *   connector without re-throwing, so one failing source never prevents
 *   the rest from being processed.
 *
 * @param connectors  - Array of enabled connector instances to run.
 * @param preferences - The user's job search preferences forwarded to each connector.
 * @param log         - Pino logger (or child logger) used for structured logging.
 * @yields            - Raw job postings from all connectors that succeed.
 */
export async function* runDiscovery(
  connectors: BaseJobDiscoveryConnector[],
  preferences: JobPreferences,
  log: Logger,
): AsyncGenerator<RawJobPosting> {
  for (const connector of connectors) {
    const sourceLog = log.child({ source: connector.sourceName });
    sourceLog.info('Starting discovery');

    try {
      for await (const posting of connector.discover(preferences)) {
        yield posting;
      }

      sourceLog.info('Discovery completed');
    } catch (err) {
      // Requirement 3.11: log the error, yield nothing from this source, and
      // continue processing remaining sources without raising an unhandled exception.
      sourceLog.warn(
        { err },
        `Discovery failed for source "${connector.sourceName}" — skipping to next source`,
      );
    }
  }
}
