/**
 * Job Description Parser
 *
 * Converts a RawJobPosting into a ParsedJobPosting by extracting all 16
 * structured fields defined in Requirement 6.1.
 *
 * Primary path  – LLM extraction with `response_format: { type: 'json_object' }`
 * Fallback path – Regex-based heuristics for remote flag and years of experience
 *                 when the LLM is unavailable (Requirement 6.2, 26.3).
 *
 * If fewer than 3 fields are extractable the posting is marked `parse_failed`
 * and the function returns null (Requirement 6.5).
 *
 * The full rawJson / rawHtml payloads are always stored alongside the parsed
 * fields for auditability (Requirement 6.3).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5, 26.3
 */

import { getLLMClient, getLLMModel } from '../../core/llmProvider.js';
import { createChildLogger } from '../../core/logger.js';
import { generateEmbedding } from '../../services/embeddings.js';
import type { ParsedJobPosting, RawJobPosting } from './types.js';

// ─── Logger ───────────────────────────────────────────────────────────────────

const log = createChildLogger({ component: 'job-parser' });

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum non-null structured fields required to consider parsing successful. */
const MIN_EXTRACTABLE_FIELDS = 3;

// ─── LLM prompt ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a structured job-posting data extractor.
Extract the following fields from the job description and return them as a
single JSON object. Use null for any field that cannot be determined.

Fields to extract:
- company          (string|null)  Company name
- title            (string|null)  Job title
- requiredSkills   (string[]|null) Explicitly required skills/technologies
- preferredSkills  (string[]|null) Preferred / nice-to-have skills
- yearsExperienceMin (number|null) Minimum years of experience
- yearsExperienceMax (number|null) Maximum years of experience
- location         (string[]|null) Work location(s); include "Remote" if applicable
- isRemote         (boolean|null) True if the role is fully remote
- isHybrid         (boolean|null) True if the role is hybrid
- salaryMin        (number|null)  Minimum salary (numeric only, no currency symbol)
- salaryMax        (number|null)  Maximum salary (numeric only, no currency symbol)
- currency         (string|null)  ISO 4217 currency code, e.g. "USD"
- employmentType   (string|null)  e.g. "full_time", "part_time", "contract", "internship"
- visaRequirements (string[]|null) Visa/work-authorisation requirements or restrictions
- applicationDeadline (string|null) ISO 8601 date string or null
- applicationUrl   (string|null)  Direct URL to apply

Respond ONLY with the JSON object; no markdown, no explanation.`;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of the JSON object we expect the LLM to return.
 * All values are nullable so TypeScript forces explicit null-checks.
 */
interface LlmExtracted {
  company: string | null;
  title: string | null;
  requiredSkills: string[] | null;
  preferredSkills: string[] | null;
  yearsExperienceMin: number | null;
  yearsExperienceMax: number | null;
  location: string[] | null;
  isRemote: boolean | null;
  isHybrid: boolean | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  employmentType: string | null;
  visaRequirements: string[] | null;
  applicationDeadline: string | null;
  applicationUrl: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the plain text content that the LLM should reason over.
 * Prefers rawHtml text stripped of tags; falls back to JSON-serialised rawJson.
 */
function buildInputText(raw: RawJobPosting): string {
  if (raw.rawHtml) {
    // Strip HTML tags and collapse whitespace for a cleaner prompt
    return raw.rawHtml
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 12_000); // keep within typical context limits
  }

  return JSON.stringify(raw.rawJson).slice(0, 12_000);
}

/**
 * Count non-null top-level field values in an LlmExtracted object.
 * Arrays count as non-null only when they contain at least one element.
 */
function countExtractedFields(fields: LlmExtracted): number {
  let count = 0;

  const scalar: (keyof LlmExtracted)[] = [
    'company',
    'title',
    'yearsExperienceMin',
    'yearsExperienceMax',
    'isRemote',
    'isHybrid',
    'salaryMin',
    'salaryMax',
    'currency',
    'employmentType',
    'applicationDeadline',
    'applicationUrl',
  ];

  for (const key of scalar) {
    if (fields[key] !== null && fields[key] !== undefined) count++;
  }

  const arrays: (keyof LlmExtracted)[] = [
    'requiredSkills',
    'preferredSkills',
    'location',
    'visaRequirements',
  ];

  for (const key of arrays) {
    const val = fields[key];
    if (Array.isArray(val) && val.length > 0) count++;
  }

  return count;
}

// ─── Regex-based fallback ─────────────────────────────────────────────────────

/**
 * Extract remote flag and years of experience using regex patterns.
 * Used when the LLM is unavailable (Requirement 6.2, 26.3).
 */
function regexFallbackExtract(
  text: string,
): Pick<LlmExtracted, 'isRemote' | 'yearsExperienceMin' | 'yearsExperienceMax'> {
  const lower = text.toLowerCase();

  // Remote detection – look for "remote" keyword
  const isRemote = /\bremote\b/.test(lower) ? true : null;

  // Years of experience patterns:
  //   "5+ years"  → min=5, max=null
  //   "3-5 years" → min=3, max=5
  //   "at least 2 years" → min=2, max=null
  let yearsExperienceMin: number | null = null;
  let yearsExperienceMax: number | null = null;

  const rangeMatch = lower.match(
    /(\d+)\s*[-–—to]+\s*(\d+)\s*\+?\s*years?/,
  );
  if (rangeMatch) {
    yearsExperienceMin = parseInt(rangeMatch[1]!, 10);
    yearsExperienceMax = parseInt(rangeMatch[2]!, 10);
  } else {
    const plusMatch = lower.match(/(\d+)\s*\+\s*years?/);
    if (plusMatch) {
      yearsExperienceMin = parseInt(plusMatch[1]!, 10);
    } else {
      const atLeastMatch = lower.match(
        /(?:at\s+least|minimum\s+of?|min\.?\s+)\s*(\d+)\s*years?/,
      );
      if (atLeastMatch) {
        yearsExperienceMin = parseInt(atLeastMatch[1]!, 10);
      }
    }
  }

  return { isRemote, yearsExperienceMin, yearsExperienceMax };
}

// ─── LLM extraction ──────────────────────────────────────────────────────────

async function extractViaLlm(inputText: string): Promise<LlmExtracted | null> {
  const client = getLLMClient();

  const response = await client.chat.completions.create({
    model: getLLMModel(),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: inputText },
    ],
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return null;

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;

  // Safely coerce the parsed object into LlmExtracted with null defaults
  const p = parsed as Record<string, unknown>;

  return {
    company: typeof p['company'] === 'string' ? p['company'] : null,
    title: typeof p['title'] === 'string' ? p['title'] : null,
    requiredSkills: Array.isArray(p['requiredSkills'])
      ? (p['requiredSkills'] as string[])
      : null,
    preferredSkills: Array.isArray(p['preferredSkills'])
      ? (p['preferredSkills'] as string[])
      : null,
    yearsExperienceMin:
      typeof p['yearsExperienceMin'] === 'number'
        ? p['yearsExperienceMin']
        : null,
    yearsExperienceMax:
      typeof p['yearsExperienceMax'] === 'number'
        ? p['yearsExperienceMax']
        : null,
    location: Array.isArray(p['location']) ? (p['location'] as string[]) : null,
    isRemote: typeof p['isRemote'] === 'boolean' ? p['isRemote'] : null,
    isHybrid: typeof p['isHybrid'] === 'boolean' ? p['isHybrid'] : null,
    salaryMin:
      typeof p['salaryMin'] === 'number' ? p['salaryMin'] : null,
    salaryMax:
      typeof p['salaryMax'] === 'number' ? p['salaryMax'] : null,
    currency: typeof p['currency'] === 'string' ? p['currency'] : null,
    employmentType:
      typeof p['employmentType'] === 'string' ? p['employmentType'] : null,
    visaRequirements: Array.isArray(p['visaRequirements'])
      ? (p['visaRequirements'] as string[])
      : null,
    applicationDeadline:
      typeof p['applicationDeadline'] === 'string'
        ? p['applicationDeadline']
        : null,
    applicationUrl:
      typeof p['applicationUrl'] === 'string' ? p['applicationUrl'] : null,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw job posting into a structured ParsedJobPosting.
 *
 * Returns null when the posting has fewer than 3 extractable structured fields
 * (Requirement 6.5 — parse_failed).
 *
 * @param raw - The minimally-processed raw job posting from a connector.
 * @returns   - A fully-structured ParsedJobPosting, or null on parse failure.
 */
export async function parseJobDescription(
  raw: RawJobPosting,
): Promise<ParsedJobPosting | null> {
  const parserLog = log.child({ sourceUrl: raw.sourceUrl, platform: raw.platform });
  const inputText = buildInputText(raw);

  let fields: LlmExtracted;
  let usedFallback = false;

  // ── Primary path: LLM extraction ─────────────────────────────────────────
  try {
    const llmResult = await extractViaLlm(inputText);

    if (llmResult !== null) {
      fields = llmResult;
    } else {
      // LLM returned empty content; use regex fallback
      parserLog.warn(
        'LLM returned no content — falling back to regex extraction',
      );
      usedFallback = true;
      const fallback = regexFallbackExtract(inputText);
      fields = buildEmptyFields(fallback);
    }
  } catch (err) {
    // ── Fallback path: regex extraction (Requirement 6.2, 26.3) ───────────
    parserLog.warn(
      { err },
      'LLM extraction failed — falling back to regex-based extraction (degraded mode)',
    );
    usedFallback = true;
    const fallback = regexFallbackExtract(inputText);
    fields = buildEmptyFields(fallback);
  }

  if (usedFallback) {
    parserLog.info(
      {
        isRemote: fields.isRemote,
        yearsExperienceMin: fields.yearsExperienceMin,
        yearsExperienceMax: fields.yearsExperienceMax,
      },
      'Degraded parse — only regex-extracted fields available',
    );
  }

  // ── Field count gate (Requirement 6.5) ────────────────────────────────────
  const extractedCount = countExtractedFields(fields);

  if (extractedCount < MIN_EXTRACTABLE_FIELDS) {
    parserLog.warn(
      { extractedCount, minRequired: MIN_EXTRACTABLE_FIELDS },
      'Insufficient extractable fields — marking parse_failed',
    );

    // Return a minimal ParsedJobPosting with parse_failed so callers can log
    // and discard cleanly; the function contract says return null here.
    return null;
  }

  // ── Assemble ParsedJobPosting ─────────────────────────────────────────────
  let applicationDeadline: Date | null = null;
  if (fields.applicationDeadline) {
    const parsed = Date.parse(fields.applicationDeadline);
    applicationDeadline = isNaN(parsed) ? null : new Date(parsed);
  }

  const posting: ParsedJobPosting = {
    // Origin
    sourceUrl: raw.sourceUrl,
    platform: raw.platform,
    discoveredAt: raw.discoveredAt,
    parsedAt: new Date(),

    // 16 structured fields
    company: fields.company,
    title: fields.title,
    requiredSkills: fields.requiredSkills,
    preferredSkills: fields.preferredSkills,
    yearsExperienceMin: fields.yearsExperienceMin,
    yearsExperienceMax: fields.yearsExperienceMax,
    location: fields.location,
    isRemote: fields.isRemote,
    isHybrid: fields.isHybrid,
    salaryMin: fields.salaryMin,
    salaryMax: fields.salaryMax,
    currency: fields.currency,
    employmentType: fields.employmentType,
    visaRequirements: fields.visaRequirements,
    applicationDeadline,
    applicationUrl: fields.applicationUrl ?? raw.sourceUrl,

    // Auditability (Requirement 6.3)
    rawJson: raw.rawJson,
    rawHtml: raw.rawHtml ?? null,

    // Processing metadata
    status: 'parsed',
  };

  parserLog.info({ extractedCount }, 'Job posting parsed successfully');

  // ── Embedding generation (Requirement 6.4, 27.2, 27.3) ───────────────────
  // Build the text corpus to embed: combine title, company, and raw input.
  const embedText = [
    fields.title ?? '',
    fields.company ?? '',
    inputText,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  try {
    posting.embedding = await generateEmbedding(embedText);
    parserLog.info({ dimensions: posting.embedding.length }, 'Embedding generated successfully');
  } catch (embErr) {
    parserLog.warn({ embErr }, 'Embedding generation failed — marking embedding_pending');
    posting.status = 'embedding_pending';
  }

  return posting;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build an all-null LlmExtracted object, overriding selected fields from a
 * regex fallback result.  Used when the LLM is unavailable.
 */
function buildEmptyFields(
  overrides: Partial<LlmExtracted>,
): LlmExtracted {
  return {
    company: null,
    title: null,
    requiredSkills: null,
    preferredSkills: null,
    yearsExperienceMin: null,
    yearsExperienceMax: null,
    location: null,
    isRemote: null,
    isHybrid: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    employmentType: null,
    visaRequirements: null,
    applicationDeadline: null,
    applicationUrl: null,
    ...overrides,
  };
}
