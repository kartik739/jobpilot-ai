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
  /** Raw HTML content of the job posting page, if available. */
  rawHtml?: string;
  /** Which platform this posting came from. */
  platform: SupportedPlatform;
  /** Wall-clock time at which this posting was first fetched. */
  discoveredAt: Date;
}

// ─── Parsed job posting ───────────────────────────────────────────────────────

/**
 * The fully-structured result produced by the parser after extracting
 * all 16 required fields from the raw posting.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5
 */
export interface ParsedJobPosting {
  // ── Origin ────────────────────────────────────────────────────────────────
  /** Original source URL of the job posting. */
  sourceUrl: string;
  /** Which platform this posting came from. */
  platform: SupportedPlatform;
  /** Wall-clock time at which this posting was first fetched. */
  discoveredAt: Date;
  /** When the parsing was completed. */
  parsedAt: Date;

  // ── The 16 structured fields (null when not extractable) ─────────────────
  /** 1. Company name. */
  company: string | null;
  /** 2. Job title. */
  title: string | null;
  /** 3. List of explicitly required skills. */
  requiredSkills: string[] | null;
  /** 4. List of preferred / nice-to-have skills. */
  preferredSkills: string[] | null;
  /** 5. Minimum years of experience required. */
  yearsExperienceMin: number | null;
  /** 6. Maximum years of experience mentioned. */
  yearsExperienceMax: number | null;
  /** 7. List of work locations (city, country, or "Remote"). */
  location: string[] | null;
  /** 8. Whether the role is fully remote. */
  isRemote: boolean | null;
  /** 9. Whether the role is hybrid. */
  isHybrid: boolean | null;
  /** 10. Minimum salary figure. */
  salaryMin: number | null;
  /** 11. Maximum salary figure. */
  salaryMax: number | null;
  /** 12. Salary currency code, e.g. "USD". */
  currency: string | null;
  /** 13. Employment type, e.g. "full_time", "contract". */
  employmentType: string | null;
  /** 14. Visa / work-authorisation requirements. */
  visaRequirements: string[] | null;
  /** 15. Application deadline date. */
  applicationDeadline: Date | null;
  /** 16. Direct application URL. */
  applicationUrl: string | null;

  // ── Audit / auditability fields ───────────────────────────────────────────
  /**
   * Full raw JSON payload from the source, preserved verbatim.
   * Requirements: 6.3
   */
  rawJson: Record<string, unknown>;
  /**
   * Full raw HTML content from the source page, preserved verbatim.
   * Requirements: 6.3
   */
  rawHtml: string | null;

  // ── Embedding ─────────────────────────────────────────────────────────────
  /**
   * 384-dimensional sentence embedding produced by the all-MiniLM-L6-v2 model.
   * Present only when embedding generation succeeded (status='parsed').
   * Requirements: 27.2, 27.3
   */
  embedding?: number[];

  // ── Processing metadata ───────────────────────────────────────────────────
  /**
   * Processing status.
   * - 'parsed'            – successfully extracted ≥3 structured fields.
   * - 'parse_failed'      – fewer than 3 fields could be extracted; posting skipped.
   * - 'embedding_pending' – parsed successfully but embedding generation failed;
   *                         embedding can be retried later.
   * Requirements: 6.5, 6.4
   */
  status: 'parsed' | 'parse_failed' | 'embedding_pending';
}
