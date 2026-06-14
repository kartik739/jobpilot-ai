/**
 * Screening Answers Agent
 *
 * Generates answers to job application screening questions using only facts
 * present in the user's profile (no fabrications). Maintains a reusable answer
 * library per user, keyed by question type, to avoid regenerating answers for
 * common questions.
 *
 * Workflow per question:
 *   1. Check `reusableAnswers` table for a stored answer matching (userId, questionType).
 *   2. If found: use the stored answer directly (req 11.4).
 *   3. If not found: ask the LLM to extract an answer from profile data only (req 11.1).
 *   4. If the LLM cannot answer from profile: leave blank and flag for manual
 *      completion (req 11.2).
 *   5. Callers may call `storeReusableAnswer` once a generated answer is approved
 *      to persist it for future reuse (req 11.5).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import OpenAI from 'openai';
import { createChildLogger } from '../core/logger.js';
import { prisma } from '../db.js';
import type { ParsedJobPosting } from './discovery/types.js';

const log = createChildLogger({ module: 'screeningAnswers' });

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * A single screening question presented by an ATS / application form.
 */
export interface ScreeningQuestion {
  /** Unique identifier for this question instance (e.g. form field id). */
  id: string;
  /** The human-readable question text. */
  questionText: string;
  /**
   * A stable key representing the semantic type of the question
   * (e.g. "years_of_experience", "work_authorization", "salary_expectation").
   * Used to key the reusable answer library.
   */
  questionType: string;
  /** Whether the question must be answered before submission. */
  isRequired: boolean;
}

/**
 * The agent's answer to a single screening question.
 */
export interface ScreeningAnswer {
  /** Matches the source ScreeningQuestion.id. */
  questionId: string;
  /** Matches the source ScreeningQuestion.questionType. */
  questionType: string;
  /**
   * The answer text.  Empty string (`''`) when the question could not be
   * answered from the profile (req 11.2).
   */
  answer: string;
  /**
   * True when the answer is blank and a human must supply the value before
   * submission (req 11.2).
   */
  requiresManualCompletion: boolean;
  /**
   * Human-readable explanation of why manual completion is needed.
   * Only present when requiresManualCompletion is true.
   */
  flagReason?: string;
  /** True when the answer was retrieved from the reusable answer library (req 11.4). */
  fromReusableLibrary: boolean;
}

/**
 * Subset of the user's profile data passed into the agent.
 * Mirrors the Prisma Profile + its relations as returned by the API layer.
 */
export interface UserProfile {
  userId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  location: string;
  summary?: string | null;
  workAuthorization: string[];
  requiresSponsorship: boolean;
  noticePeriod: number; // days
  remotePreference: string;
  targetRoles: string[];
  preferredLocations: string[];
  salaryMin?: string | null;
  salaryMax?: string | null;
  currency: string;
  employmentTypes: string[];
  workExperiences: Array<{
    company: string;
    title: string;
    startDate: Date;
    endDate?: Date | null;
    isCurrent: boolean;
    description?: string | null;
    bullets: string[];
    skills: string[];
  }>;
  educations: Array<{
    institution: string;
    degree: string;
    field?: string | null;
    startDate: Date;
    endDate?: Date | null;
    gpa?: number | null;
  }>;
  skills: Array<{
    name: string;
    category?: string | null;
    proficiency?: string | null;
    yearsOfExp?: number | null;
  }>;
  certifications: Array<{
    name: string;
    issuer?: string | null;
    issueDate?: Date | null;
  }>;
}

// ─── LLM response shape ───────────────────────────────────────────────────────

interface LlmAnswerResponse {
  answer: string;
  canAnswer: boolean;
}

// ─── Prompt building ──────────────────────────────────────────────────────────

/**
 * Build the LLM prompt for answering a single screening question.
 * Constrains the model to profile data only and requests a JSON response.
 */
function buildAnswerPrompt(
  question: ScreeningQuestion,
  profile: UserProfile,
  job: ParsedJobPosting,
): string {
  const experiencesText = profile.workExperiences
    .map((exp) => {
      const end = exp.isCurrent ? 'present' : (exp.endDate?.toISOString().slice(0, 7) ?? 'unknown');
      const start = exp.startDate.toISOString().slice(0, 7);
      const bullets = exp.bullets.map((b) => `    * ${b}`).join('\n');
      return `- ${exp.title} at ${exp.company} (${start} – ${end})${bullets ? '\n' + bullets : ''}`;
    })
    .join('\n') || '  (none provided)';

  const educationText = profile.educations
    .map((e) => {
      const field = e.field ? ` in ${e.field}` : '';
      const gpa = e.gpa != null ? ` (GPA: ${e.gpa})` : '';
      return `- ${e.degree}${field} at ${e.institution}${gpa}`;
    })
    .join('\n') || '  (none provided)';

  const skillsText = profile.skills
    .map((s) => {
      const parts = [s.name];
      if (s.proficiency) parts.push(s.proficiency);
      if (s.yearsOfExp != null) parts.push(`${s.yearsOfExp}y`);
      return parts.join(' – ');
    })
    .join(', ') || 'not specified';

  const certificationsText = profile.certifications
    .map((c) => `- ${c.name}${c.issuer ? ` (${c.issuer})` : ''}`)
    .join('\n') || '  (none provided)';

  const workAuthText = profile.workAuthorization.join(', ') || 'not specified';
  const sponsorshipText = profile.requiresSponsorship ? 'Yes' : 'No';
  const noticePeriodText = profile.noticePeriod === 0 ? 'Immediately' : `${profile.noticePeriod} days`;

  const companyName = job.company ?? 'the company';
  const jobTitle = job.title ?? 'the position';

  return [
    'You are an assistant that fills out job application screening questions.',
    '',
    'CRITICAL CONSTRAINTS:',
    '  - Answer ONLY using facts explicitly present in the candidate profile below.',
    '  - Do NOT fabricate, infer, or assume any information not stated in the profile.',
    '  - If the profile does not contain enough information to answer the question, set canAnswer to false and answer to an empty string.',
    '  - Return valid JSON matching: { "answer": string, "canAnswer": boolean }',
    '  - Do not include any text outside the JSON object.',
    '',
    '═══ JOB CONTEXT ═══',
    `Company:    ${companyName}`,
    `Job Title:  ${jobTitle}`,
    '',
    '═══ SCREENING QUESTION ═══',
    `Question Type: ${question.questionType}`,
    `Question:      ${question.questionText}`,
    `Required:      ${question.isRequired ? 'Yes' : 'No'}`,
    '',
    '═══ CANDIDATE PROFILE ═══',
    `Full Name:            ${profile.fullName}`,
    `Email:                ${profile.email}`,
    `Phone:                ${profile.phone ?? 'not provided'}`,
    `Location:             ${profile.location}`,
    `Work Authorization:   ${workAuthText}`,
    `Requires Sponsorship: ${sponsorshipText}`,
    `Notice Period:        ${noticePeriodText}`,
    `Remote Preference:    ${profile.remotePreference}`,
    `Employment Types:     ${profile.employmentTypes.join(', ') || 'not specified'}`,
    `Salary Range:         ${profile.salaryMin ?? '?'} – ${profile.salaryMax ?? '?'} ${profile.currency}`,
    '',
    profile.summary ? `Professional Summary:\n${profile.summary}\n` : '',
    'Work Experience:',
    experiencesText,
    '',
    'Education:',
    educationText,
    '',
    'Skills:',
    skillsText,
    '',
    'Certifications:',
    certificationsText,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

// ─── LLM interaction ──────────────────────────────────────────────────────────

/**
 * Ask the LLM to answer a screening question from profile data.
 * Returns a parsed LlmAnswerResponse, or null if the LLM call fails entirely.
 */
async function askLlm(
  client: OpenAI,
  question: ScreeningQuestion,
  profile: UserProfile,
  job: ParsedJobPosting,
): Promise<LlmAnswerResponse | null> {
  const prompt = buildAnswerPrompt(question, profile, job);

  try {
    const response = await client.chat.completions.create({
      model: process.env['LLM_MODEL'] ?? 'llama3',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content;
    if (raw == null || raw.trim() === '') {
      log.warn(
        { userId: profile.userId, questionType: question.questionType },
        'LLM returned empty response for screening question',
      );
      return null;
    }

    const parsed = JSON.parse(raw) as LlmAnswerResponse;

    // Validate the expected shape
    if (typeof parsed.answer !== 'string' || typeof parsed.canAnswer !== 'boolean') {
      log.warn(
        { userId: profile.userId, questionType: question.questionType, raw },
        'LLM response did not match expected JSON shape',
      );
      return null;
    }

    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { userId: profile.userId, questionType: question.questionType, error: message },
      'LLM call failed for screening question',
    );
    return null;
  }
}

// ─── Main generate function ───────────────────────────────────────────────────

/**
 * Generate answers for a list of screening questions.
 *
 * For each question:
 *   1. Checks the `reusableAnswers` table for a prior stored answer (req 11.3, 11.4).
 *   2. Falls back to LLM generation using profile data only (req 11.1).
 *   3. If the LLM cannot answer, flags for manual completion (req 11.2).
 *
 * @param questions   List of screening questions from the application form.
 * @param profile     The candidate's profile data.
 * @param job         The parsed job posting for context.
 * @param llmClient   Optional pre-configured OpenAI client (created from env vars if omitted).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */
export async function generateScreeningAnswers(
  questions: ScreeningQuestion[],
  profile: UserProfile,
  job: ParsedJobPosting,
  llmClient?: OpenAI,
): Promise<ScreeningAnswer[]> {
  const client =
    llmClient ??
    new OpenAI({
      baseURL: process.env['LLM_BASE_URL'] ?? 'http://localhost:11434/v1',
      apiKey: process.env['LLM_API_KEY'] ?? 'ollama',
    });

  log.info(
    { userId: profile.userId, questionCount: questions.length, jobTitle: job.title, company: job.company },
    'Generating screening question answers',
  );

  const answers: ScreeningAnswer[] = [];

  for (const question of questions) {
    // ── Step 1: Check the reusable answer library (req 11.3, 11.4) ───────────
    const stored = await prisma.reusableAnswer.findUnique({
      where: {
        userId_questionType: {
          userId: profile.userId,
          questionType: question.questionType,
        },
      },
    });

    if (stored !== null) {
      log.info(
        { userId: profile.userId, questionType: question.questionType },
        'Using stored reusable answer',
      );

      // Update usage metadata
      await prisma.reusableAnswer.update({
        where: { id: stored.id },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      });

      answers.push({
        questionId: question.id,
        questionType: question.questionType,
        answer: stored.answer,
        requiresManualCompletion: false,
        fromReusableLibrary: true,
      });

      continue;
    }

    // ── Step 2: Ask the LLM to generate an answer from profile data (req 11.1) ─
    log.info(
      { userId: profile.userId, questionType: question.questionType },
      'No stored answer found — asking LLM',
    );

    const llmResult = await askLlm(client, question, profile, job);

    if (llmResult !== null && llmResult.canAnswer && llmResult.answer.trim() !== '') {
      // LLM successfully extracted an answer from profile
      log.info(
        { userId: profile.userId, questionType: question.questionType },
        'LLM generated answer from profile data',
      );

      answers.push({
        questionId: question.id,
        questionType: question.questionType,
        answer: llmResult.answer.trim(),
        requiresManualCompletion: false,
        fromReusableLibrary: false,
      });
    } else {
      // ── Step 3: Cannot answer from profile — flag for manual completion (req 11.2)
      const flagReason =
        llmResult === null
          ? 'LLM service unavailable; question requires manual completion'
          : 'Profile does not contain sufficient information to answer this question';

      log.info(
        { userId: profile.userId, questionType: question.questionType, flagReason },
        'Flagging screening question for manual completion',
      );

      answers.push({
        questionId: question.id,
        questionType: question.questionType,
        answer: '',
        requiresManualCompletion: true,
        flagReason,
        fromReusableLibrary: false,
      });
    }
  }

  log.info(
    {
      userId: profile.userId,
      total: answers.length,
      fromLibrary: answers.filter((a) => a.fromReusableLibrary).length,
      generated: answers.filter((a) => !a.fromReusableLibrary && !a.requiresManualCompletion).length,
      flagged: answers.filter((a) => a.requiresManualCompletion).length,
    },
    'Screening answer generation complete',
  );

  return answers;
}

// ─── Reusable answer storage ──────────────────────────────────────────────────

/**
 * Persist an approved answer to the reusable answer library.
 *
 * Creates a new record if none exists for (userId, questionType), or updates
 * the stored answer if one already exists. This is called by the application
 * layer once the user approves a generated answer (req 11.5).
 *
 * @param userId        The user this answer belongs to.
 * @param questionType  The stable key identifying the question type.
 * @param answer        The approved answer text to store.
 *
 * Requirements: 11.3, 11.5
 */
export async function storeReusableAnswer(
  userId: string,
  questionType: string,
  answer: string,
): Promise<void> {
  log.info(
    { userId, questionType },
    'Storing reusable answer in library',
  );

  await prisma.reusableAnswer.upsert({
    where: {
      userId_questionType: { userId, questionType },
    },
    create: {
      userId,
      questionType,
      answer,
      usageCount: 0,
      lastUsedAt: new Date(),
    },
    update: {
      answer,
      lastUsedAt: new Date(),
    },
  });

  log.info(
    { userId, questionType },
    'Reusable answer stored successfully',
  );
}
