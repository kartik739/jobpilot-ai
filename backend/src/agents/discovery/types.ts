/**
 * Shared types for the Job Discovery subsystem.
 *
 * These types are consumed by:
 *  - BaseJobDiscoveryConnector (base.ts)
 *  - DiscoveryOrchestrator (orchestrator.ts)
 *  - Individual platform connectors (e.g. greenhouse.ts, remoteok.ts, …)
 */

// ─── Supported platforms ──────────────────────────────────────────────────────

export type SupportedPlatform =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'smartrecruiters'
  | 'wellfound'
  | 'ycombinator'
  | 'remoteok'
  | 'indeed'
  | 'naukri'
  | 'linkedin'
  | 'twitter_x'
  | 'custom_url';

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Token-bucket rate limit configuration for a connector.
 *
 * @property maxTokens  - Maximum number of tokens the bucket can hold.
 *                        Represents the burst capacity.
 * @property refillRate - Tokens added per second.
 */
export interface RateLimitConfig {
  /** Maximum burst capacity (token bucket ceiling). */
  maxTokens: number;
  /** Token refill rate in tokens per second. */
  refillRate: number;
}

// ─── Job preferences ─────────────────────────────────────────────────────────

/**
 * Subset of the user's profile preferences that each connector receives
 * to scope its discovery queries.
 *
 * Mirrors the preference fields in the UserProfile schema and the
 * CreateProfileRequest Zod schema (src/api/schemas/profile.ts).
 */
export interface JobPreferences {
  /** Roles the user is targeting, e.g. ['Backend Engineer', 'Senior SWE']. */
  targetRoles: string[];
  /** Preferred work locations, e.g. ['Remote', 'New York, NY']. */
  preferredLocations: string[];
  /** Remote-work preference. */
  remotePreference: 'remote_only' | 'hybrid' | 'onsite' | 'flexible';
  /** Minimum acceptable salary (optional). */
  salaryMin?: number;
  /** Maximum acceptable salary (optional). */
  salaryMax?: number;
  /** Currency code, e.g. 'USD'. */
  currency?: string;
  /** Desired employment types, e.g. ['full_time', 'contract']. */
  employmentTypes?: string[];
  /** Companies to exclude from results. */
  excludedCompanies?: string[];
  /** Companies to prioritise (boosted score). */
  preferredCompanies?: string[];
  /** Industries the user wants to work in. */
  targetIndustries?: string[];
  /** Preferred company sizes. */
  targetCompanySizes?: string[];
}

// ─── Raw job posting ─────────────────────────────────────────────────────────

/**
 * The minimally-processed result yielded by a connector before any
 * structured parsing occurs.  Parsing happens in a later pipeline stage.
 */
export interface RawJobPosting {
  /** Canonical URL pointing to the job posting on the source platform. */
  sourceUrl: string;
  /**
   * The raw payload returned by the source (JSON object, HTML string, etc.).
   * Preserved verbatim for auditability and re-parsing.
   */
  rawJson: Record<string, unknown>;
  /** Which platform this posting came from. */
  platform: SupportedPlatform;
  /** Wall-clock time at which this posting was first fetched. */
  discoveredAt: Date;
}
