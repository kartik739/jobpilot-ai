/**
 * Interview Prep Agent
 *
 * Generates a personalised interview prep sheet for a job application using
 * the LLM, grounded in the job description and the user's profile. Falls back
 * to template questions when the LLM is unavailable.
 *
 * The prep sheet is stored in the `interviewPrepSheets` Prisma table, linked
 * to the application record by `applicationId`.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4
 */

import OpenAI from 'openai';
import { PrismaClient, Prisma } from '@prisma/client';
import { createChildLogger } from '../core/logger.js';
import { getLLMClient, getLLMModel } from '../core/llmProvider.js';
import { llmCallDurationSeconds } from '../core/metrics.js';
import type { UserProfileContext } from './coverLetter.js';
import type { ParsedJobPosting } from './discovery/types.js';

const log = createChildLogger({ module: 'interviewPrep' });

// ─── Domain types ──────────────────────────────────────────────────────────────

export interface PrepQuestion {
  question: string;
  category: 'behavioral' | 'technical' | 'culture' | 'system-design';
  suggestedAnswer?: string; // based on user's actual experience only
}

export interface InterviewPrepSheet {
  applicationId: string;
  behavioralQuestions: PrepQuestion[];
  technicalQuestions: PrepQuestion[];
  companySummary: string;
  roleSpecificTips: string[];
  generatedAt: Date;
}

// ─── Internal LLM response shape ─────────────────────────────────────────────

interface LlmPrepResponse {
  behavioralQuestions: Array<{
    question: string;
    suggestedAnswer?: string;
  }>;
  technicalQuestions: Array<{
    question: string;
    category?: 'technical' | 'system-design';
    suggestedAnswer?: string;
  }>;
  companySummary: string;
  roleSpecificTips: string[];
}

// ─── Prompt building ──────────────────────────────────────────────────────────

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
    .map((e) => `- ${e.degree}${e.field ? ` in ${e.field}` : ''} at ${e.institution}`)
    .join('\n');

  return [
    'You are an expert interview coach. Generate an interview prep sheet in JSON format.',
    '',
    'REQUIREMENTS:',
    '  - Generate between 3 and 5 behavioral questions (STAR-format prompts).',
    '  - Generate between 3 and 5 technical questions (may include system-design subtypes).',
    '  - For each behavioral question, write a suggestedAnswer that uses ONLY facts from the candidate profile below. Do NOT fabricate any achievements, companies, or details not in the profile.',
    '  - Write a 2-3 sentence companySummary about the company and role.',
    '  - Write 3-5 roleSpecificTips as short action items.',
    '',
    'RESPONSE FORMAT (strict JSON, no markdown fences):',
    '{',
    '  "behavioralQuestions": [',
    '    { "question": "...", "suggestedAnswer": "..." }',
    '  ],',
    '  "technicalQuestions": [',
    '    { "question": "...", "category": "technical" | "system-design" }',
    '  ],',
    '  "companySummary": "...",',
    '  "roleSpecificTips": ["...", "..."]',
    '}',
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
    profile.summary ? `\nProfessional Summary:\n${profile.summary}` : '',
    '',
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
  ]
    .join('\n')
    .trim();
}

// ─── Template fallback ─────────────────────────────────────────────────────────

/**
 * Produce a minimal prep sheet from static templates when the LLM is
 * unavailable. Always meets the minimum 5-question / ≥2 behavioral / ≥2
 * technical constraint (req 19.1, 19.4).
 */
function generateTemplatePrepSheet(
  profile: UserProfileContext,
  job: ParsedJobPosting,
): Omit<InterviewPrepSheet, 'applicationId' | 'generatedAt'> {
  const companyName = job.company ?? 'the company';
  const jobTitle = job.title ?? 'this position';
  const mostRecentExp = profile.experiences[0];
  const topSkills = profile.skills.slice(0, 3).map((s) => s.name).join(', ') || 'your core skills';

  const expContext = mostRecentExp
    ? `In my role as ${mostRecentExp.title} at ${mostRecentExp.company}, ${mostRecentExp.bullets[0] ?? 'I gained relevant experience'}.`
    : 'I have relevant experience that prepared me for this challenge.';

  const behavioralQuestions: PrepQuestion[] = [
    {
      question: 'Tell me about a time you faced a significant technical challenge. How did you resolve it?',
      category: 'behavioral',
      suggestedAnswer: expContext,
    },
    {
      question: 'Describe a situation where you had to collaborate with a difficult team member.',
      category: 'behavioral',
      suggestedAnswer: mostRecentExp
        ? `During my time at ${mostRecentExp.company}, I navigated team dynamics by focusing on shared goals and open communication.`
        : 'I focus on open communication and finding common ground.',
    },
    {
      question: 'Give an example of a time you delivered a project under tight deadlines.',
      category: 'behavioral',
      suggestedAnswer: expContext,
    },
  ];

  const technicalQuestions: PrepQuestion[] = [
    {
      question: `How would you architect a scalable backend service for ${jobTitle}?`,
      category: 'technical',
    },
    {
      question: `Explain your experience with ${topSkills} and how you'd apply it here.`,
      category: 'technical',
    },
    {
      question: 'Walk me through how you approach debugging a production issue.',
      category: 'technical',
    },
  ];

  return {
    behavioralQuestions,
    technicalQuestions,
    companySummary: `${companyName} is hiring for a ${jobTitle} role. This is an opportunity to apply your skills in a new environment.`,
    roleSpecificTips: [
      `Review the required skills: ${job.requiredSkills?.join(', ') ?? 'check the job description'}.`,
      'Prepare 2-3 STAR stories from your most recent role.',
      'Research the company mission and recent news before the interview.',
    ],
  };
}

// ─── LLM response parsing ─────────────────────────────────────────────────────

function parseLlmResponse(
  raw: string,
): Omit<InterviewPrepSheet, 'applicationId' | 'generatedAt'> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;

    const behavioralRaw = Array.isArray(obj['behavioralQuestions'])
      ? (obj['behavioralQuestions'] as unknown[])
      : [];
    const technicalRaw = Array.isArray(obj['technicalQuestions'])
      ? (obj['technicalQuestions'] as unknown[])
      : [];

    const behavioralQuestions: PrepQuestion[] = behavioralRaw
      .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
      .filter((q) => typeof q['question'] === 'string' && q['question'].trim() !== '')
      .map((q) => ({
        question: q['question'] as string,
        category: 'behavioral' as const,
        ...(typeof q['suggestedAnswer'] === 'string' && q['suggestedAnswer'].trim() !== ''
          ? { suggestedAnswer: q['suggestedAnswer'] as string }
          : {}),
      }));

    const technicalQuestions: PrepQuestion[] = technicalRaw
      .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
      .filter((q) => typeof q['question'] === 'string' && q['question'].trim() !== '')
      .map((q) => {
        const cat = q['category'] === 'system-design' ? 'system-design' : ('technical' as const);
        return {
          question: q['question'] as string,
          category: cat,
          ...(typeof q['suggestedAnswer'] === 'string' && q['suggestedAnswer'].trim() !== ''
            ? { suggestedAnswer: q['suggestedAnswer'] as string }
            : {}),
        };
      });

    const companySummary =
      typeof obj['companySummary'] === 'string' ? obj['companySummary'] : '';
    const roleSpecificTips = Array.isArray(obj['roleSpecificTips'])
      ? (obj['roleSpecificTips'] as unknown[])
          .filter((t): t is string => typeof t === 'string')
      : [];

    // Validate minimum question counts (req 19.1)
    if (behavioralQuestions.length < 2 || technicalQuestions.length < 2) {
      return null;
    }

    const totalQuestions = behavioralQuestions.length + technicalQuestions.length;
    if (totalQuestions < 5 || totalQuestions > 10) {
      // Trim or reject when LLM exceeds 10
      if (totalQuestions > 10) {
        const maxBehavioral = Math.min(behavioralQuestions.length, 5);
        const maxTechnical = Math.min(technicalQuestions.length, 5);
        return {
          behavioralQuestions: behavioralQuestions.slice(0, maxBehavioral),
          technicalQuestions: technicalQuestions.slice(0, maxTechnical),
          companySummary,
          roleSpecificTips,
        };
      }
      return null;
    }

    return { behavioralQuestions, technicalQuestions, companySummary, roleSpecificTips };
  } catch {
    return null;
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Generate an interview prep sheet for the given application, job and profile.
 *
 * Uses the LLM to produce personalised questions and suggested answers grounded
 * in the candidate's actual profile (req 19.2, 19.3). Falls back to template
 * questions when the LLM is unavailable (req 19.4). Stores the result in the
 * `interviewPrepSheets` table via an upsert (req 19.4).
 *
 * @param applicationId  The ID of the linked application record.
 * @param job            Parsed job posting used to ground questions.
 * @param profile        Candidate profile used to personalise answers.
 * @param llmClient      Optional OpenAI-compatible client; created from env vars if omitted.
 * @param prismaClient   Optional Prisma client; creates a default instance if omitted.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4
 */
export async function generatePrepSheet(
  applicationId: string,
  job: ParsedJobPosting,
  profile: UserProfileContext,
  llmClient?: OpenAI,
  prismaClient?: PrismaClient,
): Promise<InterviewPrepSheet> {
  const client = llmClient ?? getLLMClient();

  const prisma = prismaClient ?? new PrismaClient();

  log.info(
    { applicationId, jobTitle: job.title, company: job.company },
    'Generating interview prep sheet',
  );

  let sheetData: Omit<InterviewPrepSheet, 'applicationId' | 'generatedAt'>;

  try {
    const prompt = buildPrompt(profile, job);

    const endTimer = llmCallDurationSeconds.startTimer({ operation: 'interview_prep' });
    let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
    try {
      response = await client.chat.completions.create({
        model: getLLMModel(),
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      });
      endTimer();
    } catch (err) {
      endTimer();
      throw err;
    }

    const llmContent = response.choices[0]?.message?.content;
    if (llmContent == null || llmContent.trim() === '') {
      throw new Error('LLM returned empty prep sheet content');
    }

    const parsed = parseLlmResponse(llmContent.trim());
    if (parsed === null) {
      throw new Error('LLM response failed validation (question counts out of range)');
    }

    sheetData = parsed;
    log.info({ applicationId }, 'LLM interview prep sheet generation succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { applicationId, error: message },
      'LLM prep sheet generation failed — using template fallback',
    );
    sheetData = generateTemplatePrepSheet(profile, job);
  }

  // Upsert the record so repeated calls for the same application overwrite (req 19.4)
  const generatedAt = new Date();

  // Prisma Json fields require a plain JSON-serializable value; cast via
  // Prisma.InputJsonValue to satisfy the type checker without losing information.
  const toJson = (v: unknown): Prisma.InputJsonValue =>
    v as Prisma.InputJsonValue;

  await prisma.interviewPrepSheet.upsert({
    where: { applicationId },
    create: {
      applicationId,
      behavioralQuestions: toJson(sheetData.behavioralQuestions),
      technicalQuestions: toJson(sheetData.technicalQuestions),
      companySummary: sheetData.companySummary,
      roleSpecificTips: toJson(sheetData.roleSpecificTips),
      generatedAt,
    },
    update: {
      behavioralQuestions: toJson(sheetData.behavioralQuestions),
      technicalQuestions: toJson(sheetData.technicalQuestions),
      companySummary: sheetData.companySummary,
      roleSpecificTips: toJson(sheetData.roleSpecificTips),
      generatedAt,
    },
  });

  log.info({ applicationId }, 'Interview prep sheet upserted to database');

  return {
    applicationId,
    ...sheetData,
    generatedAt,
  };
}
