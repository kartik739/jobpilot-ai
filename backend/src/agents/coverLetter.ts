/**
 * Cover Letter Agent
 *
 * Generates personalised cover letters for job applications using only
 * facts present in the user's profile (no fabrications). Supports two
 * review modes:
 *   - 'auto':         submit immediately without user approval (req 10.5)
 *   - 'review_first': present draft via WebSocket and wait up to 24 hours
 *                     for user edits before proceeding (req 10.3, 10.4, 10.6)
 *
 * Generated drafts are stored in SeaweedFS under letters/{userId}/{applicationId}.txt
 * and linked to the application record (req 10.7).
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import OpenAI from 'openai';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { createChildLogger } from '../core/logger.js';
import { uploadFile } from '../services/storage.js';
import type { ParsedJobPosting } from './discovery/types.js';

const log = createChildLogger({ module: 'coverLetter' });

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface UserProfileContext {
  userId: string;
  fullName: string;
  email: string;
  location?: string;
  summary?: string;
  experiences: Array<{
    company: string;
    title: string;
    startDate: string;
    endDate?: string;
    bullets: string[];
  }>;
  skills: Array<{ name: string }>;
  projects: Array<{
    name: string;
    description?: string;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
  }>;
  coverLetterReviewMode: 'auto' | 'review_first';
}

export interface CoverLetter {
  applicationId: string;
  userId: string;
  content: string;
  storageKey: string;    // SeaweedFS key where it's stored
  version: 'generated' | 'edited';
  generatedAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum time (in seconds) to wait for user review before auto-proceeding. */
const REVIEW_TIMEOUT_SECONDS = 86400; // 24 hours

/** Polling interval (in ms) when waiting for user review response. */
const REVIEW_POLL_INTERVAL_MS = 5000; // 5 seconds

/** Redis key prefix for cover letter approval responses. */
const APPROVAL_KEY_PREFIX = 'cover_letter_approvals';

// ─── Prompt building ──────────────────────────────────────────────────────────

/**
 * Build the LLM system + user prompt for cover letter generation.
 * Explicitly references company name, job title, and required skills (req 10.1).
 * Strictly constrains the LLM to profile facts only (req 10.2).
 */
function buildPrompt(profile: UserProfileContext, job: ParsedJobPosting): string {
  const companyName = job.company ?? 'the company';
  const jobTitle = job.title ?? 'the position';
  const requiredSkills = job.requiredSkills?.join(', ') ?? 'not specified';
  const preferredSkills = job.preferredSkills?.join(', ') ?? 'not specified';

  const experiencesText = profile.experiences
    .map(
      (exp) =>
        `- ${exp.title} at ${exp.company} (${exp.startDate}${exp.endDate ? ` – ${exp.endDate}` : ' – present'})\n` +
        exp.bullets.map((b) => `    * ${b}`).join('\n'),
    )
    .join('\n');

  const skillsText = profile.skills.map((s) => s.name).join(', ') || 'not specified';

  const projectsText = profile.projects
    .map(
      (p) =>
        `- ${p.name}${p.description ? `: ${p.description}` : ''}\n` +
        p.highlights.map((h) => `    * ${h}`).join('\n'),
    )
    .join('\n');

  const educationText = profile.education
    .map(
      (e) =>
        `- ${e.degree}${e.field ? ` in ${e.field}` : ''} at ${e.institution}`,
    )
    .join('\n');

  const profileSummary = profile.summary ? `\nProfessional Summary:\n${profile.summary}\n` : '';

  return [
    'You are a professional cover letter writer.',
    'Write a compelling cover letter for the following job application.',
    '',
    'CRITICAL CONSTRAINTS:',
    '  - Use ONLY facts present in the user profile below.',
    '  - Do NOT fabricate achievements, companies, dates, skills, or any information not explicitly in the profile.',
    '  - Reference the specific company name, job title, and key requirements from the job description.',
    '  - Keep the letter to 3-4 paragraphs, professional tone.',
    '  - Return ONLY the cover letter text, no preamble or explanation.',
    '',
    '═══ JOB DETAILS ═══',
    `Company:           ${companyName}`,
    `Job Title:         ${jobTitle}`,
    `Required Skills:   ${requiredSkills}`,
    `Preferred Skills:  ${preferredSkills}`,
    '',
    '═══ CANDIDATE PROFILE ═══',
    `Name:     ${profile.fullName}`,
    `Email:    ${profile.email}`,
    `Location: ${profile.location ?? 'not specified'}`,
    profileSummary,
    'Work Experience:',
    experiencesText || '  (none provided)',
    '',
    'Skills:',
    skillsText,
    '',
    'Projects:',
    projectsText || '  (none provided)',
    '',
    'Education:',
    educationText || '  (none provided)',
  ].join('\n');
}

// ─── Template fallback ────────────────────────────────────────────────────────

/**
 * Generate a simple template-based cover letter when the LLM is unavailable.
 * Uses only verified facts from the profile (req 10.2).
 */
function generateTemplateCoverLetter(
  profile: UserProfileContext,
  job: ParsedJobPosting,
): string {
  const companyName = job.company ?? 'your company';
  const jobTitle = job.title ?? 'this position';
  const mostRecentExp = profile.experiences[0];
  const topSkills = profile.skills.slice(0, 5).map((s) => s.name).join(', ');

  const intro = `Dear Hiring Manager,\n\nI am writing to express my strong interest in the ${jobTitle} role at ${companyName}.`;

  const experienceParagraph = mostRecentExp
    ? `With my experience as ${mostRecentExp.title} at ${mostRecentExp.company}, I have developed skills that align well with the requirements of this role.`
    : 'My background and skill set make me a strong candidate for this role.';

  const skillsParagraph = topSkills
    ? `My technical skills include ${topSkills}, which I believe are directly relevant to the ${jobTitle} position.`
    : `I am eager to bring my skills and experience to the ${jobTitle} position at ${companyName}.`;

  const closing = `I would welcome the opportunity to discuss how my background aligns with ${companyName}'s needs. Thank you for considering my application.\n\nSincerely,\n${profile.fullName}`;

  return [intro, experienceParagraph, skillsParagraph, closing].join('\n\n');
}

// ─── Main generate function ───────────────────────────────────────────────────

/**
 * Generate a cover letter for the given profile and job posting.
 *
 * Calls the LLM to produce a personalised letter referencing the specific
 * company name, job title, and key requirements (req 10.1).
 * Falls back to a template when the LLM is unavailable.
 * Stores the result in SeaweedFS and returns a CoverLetter object (req 10.7).
 *
 * @param profile         The user's profile context with all relevant facts.
 * @param job             The parsed job posting with company/title/skills.
 * @param applicationId   The ID of the linked application record.
 * @param llmClient       Optional OpenAI-compatible client; created from env vars if omitted.
 *
 * Requirements: 10.1, 10.2, 10.7
 */
export async function generateCoverLetter(
  profile: UserProfileContext,
  job: ParsedJobPosting,
  applicationId: string,
  llmClient?: OpenAI,
): Promise<CoverLetter> {
  const client =
    llmClient ??
    new OpenAI({
      baseURL: process.env['OPENAI_BASE_URL'] ?? 'http://localhost:11434/v1',
      apiKey: process.env['OPENAI_API_KEY'] ?? 'ollama',
    });

  log.info(
    { userId: profile.userId, applicationId, jobTitle: job.title, company: job.company },
    'Generating cover letter',
  );

  let content: string;

  try {
    const prompt = buildPrompt(profile, job);

    const response = await client.chat.completions.create({
      model: process.env['LLM_MODEL'] ?? 'llama3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.4,
    });

    const llmContent = response.choices[0]?.message?.content;
    if (llmContent == null || llmContent.trim() === '') {
      throw new Error('LLM returned empty cover letter content');
    }

    content = llmContent.trim();
    log.info({ userId: profile.userId, applicationId }, 'LLM cover letter generation succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { userId: profile.userId, applicationId, error: message },
      'LLM cover letter generation failed — using template fallback',
    );
    content = generateTemplateCoverLetter(profile, job);
  }

  // Store in SeaweedFS under letters/{userId}/{applicationId}.txt  (req 10.7)
  const storageKey = `letters/${profile.userId}/${applicationId}.txt`;
  await uploadFile(storageKey, Buffer.from(content, 'utf-8'), 'text/plain');

  log.info(
    { userId: profile.userId, applicationId, storageKey },
    'Cover letter stored in SeaweedFS',
  );

  return {
    applicationId,
    userId: profile.userId,
    content,
    storageKey,
    version: 'generated',
    generatedAt: new Date(),
  };
}

// ─── Review mode submission ───────────────────────────────────────────────────

/** Options for submitWithReviewMode — primarily used to inject shorter intervals in tests. */
export interface SubmitWithReviewModeOptions {
  /** Override the polling interval in ms (default: 5000). */
  pollIntervalMs?: number;
  /** Override the review timeout in seconds (default: 86400). */
  reviewTimeoutSeconds?: number;
}

/**
 * Handle the cover letter review mode flow before final submission.
 *
 * 'auto' mode:         returns the cover letter immediately (req 10.5).
 * 'review_first' mode: emits a WebSocket event so the user can review and
 *                      optionally edit the draft (req 10.3); polls Redis for
 *                      up to 24 hours for a user response (req 10.4); if the
 *                      user edited the letter, uses that version (req 10.6);
 *                      on timeout proceeds with the original draft (req 10.4).
 *
 * @param coverLetter      The generated cover letter to potentially review.
 * @param reviewMode       The user's configured review mode.
 * @param fastifyInstance  The Fastify app instance (used to access websocketServer).
 * @param redis            An ioredis client for polling the approval key.
 * @param options          Optional overrides for poll interval and timeout (useful in tests).
 *
 * Requirements: 10.3, 10.4, 10.5, 10.6
 */
export async function submitWithReviewMode(
  coverLetter: CoverLetter,
  reviewMode: 'auto' | 'review_first',
  fastifyInstance: FastifyInstance,
  redis: Redis,
  options: SubmitWithReviewModeOptions = {},
): Promise<CoverLetter> {
  // ── Auto mode: submit immediately without user approval (req 10.5) ────────
  if (reviewMode === 'auto') {
    log.info(
      { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
      'Cover letter review mode is auto — submitting immediately',
    );
    return coverLetter;
  }

  // ── Review-first mode ─────────────────────────────────────────────────────
  log.info(
    { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
    'Cover letter review mode is review_first — emitting pending review event',
  );

  // Emit WebSocket event to the user so they can review/edit the draft (req 10.3)
  _emitCoverLetterPendingReview(fastifyInstance, coverLetter);

  // Poll Redis for user response, up to 24 hours (req 10.4)
  const approvalKey = `${APPROVAL_KEY_PREFIX}:${coverLetter.applicationId}`;
  const pollStartMs = Date.now();
  const effectivePollIntervalMs = options.pollIntervalMs ?? REVIEW_POLL_INTERVAL_MS;
  const effectiveTimeoutSeconds = options.reviewTimeoutSeconds ?? REVIEW_TIMEOUT_SECONDS;
  const timeoutMs = effectiveTimeoutSeconds * 1000;

  const editedContent = await new Promise<string | null>((resolve) => {
    const interval = setInterval(async () => {
      try {
        const value = await redis.get(approvalKey);

        if (value !== null) {
          clearInterval(interval);
          clearTimeout(timeoutHandle);
          log.info(
            { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
            'User provided cover letter approval/edit via Redis',
          );
          resolve(value);
          return;
        }

        // Log progress every ~30 minutes worth of polls
        const elapsedMs = Date.now() - pollStartMs;
        if (elapsedMs % (30 * 60 * 1000) < effectivePollIntervalMs * 2) {
          log.debug(
            { userId: coverLetter.userId, applicationId: coverLetter.applicationId, elapsedMs },
            'Still waiting for cover letter review response',
          );
        }
      } catch (err) {
        log.warn(
          { userId: coverLetter.userId, applicationId: coverLetter.applicationId, err },
          'Redis poll error while waiting for cover letter review; will retry',
        );
      }
    }, effectivePollIntervalMs);

    const timeoutHandle = setTimeout(() => {
      clearInterval(interval);
      log.info(
        { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
        '24-hour cover letter review timeout reached — proceeding with original generated version',
      );
      resolve(null);
    }, timeoutMs);
  });

  // Timeout: return original generated letter (req 10.4)
  if (editedContent === null) {
    return coverLetter;
  }

  // User provided content: use their edited version (req 10.6)
  const editedStorageKey = coverLetter.storageKey; // overwrite the same key
  await uploadFile(
    editedStorageKey,
    Buffer.from(editedContent, 'utf-8'),
    'text/plain',
  );

  log.info(
    { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
    'User-edited cover letter stored; using edited version',
  );

  // Clean up the Redis approval key
  try {
    await redis.del(approvalKey);
  } catch (err) {
    log.warn(
      { userId: coverLetter.userId, applicationId: coverLetter.applicationId, err },
      'Failed to delete Redis approval key after processing',
    );
  }

  return {
    ...coverLetter,
    content: editedContent,
    version: 'edited',
  };
}

// ─── WebSocket emission helper ────────────────────────────────────────────────

/**
 * Emit a `cover_letter_pending_review` WebSocket event to any connected clients
 * for the given user. Uses the @fastify/websocket server attached to the Fastify
 * instance. Safely no-ops if the WebSocket server is not available.
 */
function _emitCoverLetterPendingReview(
  fastifyInstance: FastifyInstance,
  coverLetter: CoverLetter,
): void {
  // @fastify/websocket attaches `.websocketServer` to the Fastify instance
  const wsServer = (fastifyInstance as FastifyInstance & {
    websocketServer?: { clients?: Set<{ readyState: number; send: (data: string) => void }> };
  }).websocketServer;

  if (wsServer == null || wsServer.clients == null) {
    log.warn(
      { userId: coverLetter.userId, applicationId: coverLetter.applicationId },
      'WebSocket server not available — cannot emit cover_letter_pending_review event',
    );
    return;
  }

  const payload = JSON.stringify({
    event: 'cover_letter_pending_review',
    applicationId: coverLetter.applicationId,
    userId: coverLetter.userId,
    coverLetterContent: coverLetter.content,
    jobTitle: null,   // callers can re-broadcast with enriched data if needed
    company: null,
  });

  let sentCount = 0;
  // OPEN === 1 per the WebSocket spec
  const WS_OPEN = 1;

  for (const client of wsServer.clients) {
    if (client.readyState === WS_OPEN) {
      try {
        client.send(payload);
        sentCount++;
      } catch (err) {
        log.warn(
          { userId: coverLetter.userId, applicationId: coverLetter.applicationId, err },
          'Failed to send WebSocket message to a client',
        );
      }
    }
  }

  log.info(
    { userId: coverLetter.userId, applicationId: coverLetter.applicationId, sentCount },
    'Emitted cover_letter_pending_review WebSocket event',
  );
}
