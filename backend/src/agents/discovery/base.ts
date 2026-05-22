/**
 * Abstract base class for all Job Discovery connectors.
 *
 * Each platform connector (Greenhouse, Lever, RemoteOK, …) extends this class
 * and implements the `discover` generator method.  The orchestrator interacts
 * only with this base contract, making connectors interchangeable.
 *
 * Requirements: 3.11
 */

import type { JobPreferences, RateLimitConfig, RawJobPosting } from './types.js';

export abstract class BaseJobDiscoveryConnector {
  /**
   * Human-readable name of the source platform.
   * Used in log messages and error reporting.
   *
   * @example 'greenhouse', 'remoteok', 'linkedin'
   */
  abstract readonly sourceName: string;

  /**
   * Token-bucket rate-limit configuration for this connector.
   * The orchestrator (or the connector itself) uses these values to pace
   * outbound requests and stay within each platform's acceptable limits.
   */
  abstract readonly rateLimitConfig: RateLimitConfig;

  /**
   * Asynchronously yield raw job postings that match the given preferences.
   *
   * Implementations MUST:
   *  - Yield each `RawJobPosting` as soon as it is available (streaming).
   *  - Set `discoveredAt` to the current UTC time for every yielded posting.
   *  - Set `platform` to a value matching the connector's `sourceName`.
   *  - Respect `rateLimitConfig` when making outbound requests.
   *
   * Implementations MUST NOT:
   *  - Swallow errors silently — let them propagate so the orchestrator can
   *    catch, log, and continue with other connectors.
   *  - Block indefinitely; apply reasonable timeouts per request.
   *
   * @param preferences - The user's job search preferences used to scope queries.
   * @yields            - Individual raw job postings as they are fetched.
   */
  abstract discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting>;
}
