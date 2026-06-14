/**
 * Resume Optimizer Agent
 *
 * Tailors a base ResumeVersion to a specific job description by:
 *   - Reordering work experiences and projects by keyword/skill relevance (req 9.1)
 *   - Reordering skills so matched skills appear first (req 9.2)
 *   - Generating a tailored professional summary via LLM (req 9.3)
 *   - Never adding any new entries not in the base resume (req 9.4)
 *   - Falling back to the original summary when LLM fails (req 9.11, 9.12)
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.11, 9.12
 */

import OpenAI from 'openai';
import type { ParsedJobPosting } from './discovery/types.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'resumeOptimizer' });

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface WorkExperience {
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
  bullets: string[];
  skills: string[];
}

export interface Project {
  name: string;
  description?: string;
  url?: string;
  repoUrl?: string;
  skills: string[];
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  highlights: string[];
}

export interface Skill {
  name: string;
  category?: string;
  proficiency?: string;
  yearsOfExp?: number;
}

export interface Education {
  institution: string;
  degree: string;
  field?: string;
  startDate: string;
  endDate?: string;
  gpa?: number;
  description?: string;
}

export interface Certification {
  name: string;
  issuer?: string;
  issueDate?: string;
  expiryDate?: string;
  credentialId?: string;
  credentialUrl?: string;
}

export interface ResumeContent {
  summary: string;
  experiences: WorkExperience[];
  education: Education[];
  projects: Project[];
  skills: Skill[];
  certifications: Certification[];
  rawText: string;
  embedding?: number[];
}

export interface ResumeVersion {
  id: string;
  userId: string;
  name: string;
  specialization: string;
  fileUrl: string;
  fileHash: string;
  content: ResumeContent;
  isDefault: boolean;
}

export interface TailoredResume {
  baseResumeId: string;
  userId: string;
  jobId?: string;
  content: ResumeContent;
  optimizationMetadata: {
    experiencesReordered: boolean;
    projectsReordered: boolean;
    skillsReordered: boolean;
    summaryGenerated: boolean;
    summaryFallback: boolean; // true if LLM failed and original was used
    truthfulnessFallback?: boolean; // true if fabrications were detected and base resume was returned
  };
}

export interface TruthfulnessViolation {
  field: string;
  reason: string;
}

export interface TruthfulnessReport {
  hasFabrications: boolean;
  violations: TruthfulnessViolation[];
}

// ─── Helper utilities ─────────────────────────────────────────────────────────

/** Normalise a string to lowercase and trimmed. */
function normaliseStr(s: string): string {
  return s.toLowerCase().trim();
}

/** Normalise a string array to lowercase, trimmed, non-empty elements. */
function normaliseArr(arr: string[] | null | undefined): string[] {
  return (arr ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Score text relevance by counting keyword appearances.
 * Returns ratio of matched keywords to total keywords (0 if no keywords).
 */
function scoreTextRelevance(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const normText = normaliseStr(text);
  const matched = keywords.filter((kw) => normText.includes(kw)).length;
  return matched / keywords.length;
}

/**
 * Score how relevant a work experience entry is to the job posting.
 * Combines description, bullets, and skills against job keywords.
 */
function scoreExperienceRelevance(exp: WorkExperience, job: ParsedJobPosting): number {
  const jobKeywords = normaliseArr([
    ...(job.requiredSkills ?? []),
    ...(job.preferredSkills ?? []),
    ...(job.title != null ? [job.title] : []),
    ...(job.company != null ? [job.company] : []),
  ]);

  const text = [
    exp.description ?? '',
    exp.bullets.join(' '),
    exp.skills.join(' '),
  ].join(' ');

  return scoreTextRelevance(text, jobKeywords);
}

/**
 * Score how relevant a project is to the job posting.
 * Combines description, highlights, and skills against job keywords.
 */
function scoreProjectRelevance(project: Project, job: ParsedJobPosting): number {
  const jobKeywords = normaliseArr([
    ...(job.requiredSkills ?? []),
    ...(job.preferredSkills ?? []),
    ...(job.title != null ? [job.title] : []),
    ...(job.company != null ? [job.company] : []),
  ]);

  const text = [
    project.description ?? '',
    project.highlights.join(' '),
    project.skills.join(' '),
  ].join(' ');

  return scoreTextRelevance(text, jobKeywords);
}

/**
 * Reorder items by relevance score (descending).
 * Uses a stable sort: items with equal scores preserve their original relative order.
 * Always returns a new array of the same length as input (req 9.4).
 */
function reorderByRelevance<T>(items: T[], scoreFn: (item: T) => number): T[] {
  // Attach original index to preserve stable ordering on ties
  const indexed = items.map((item, idx) => ({ item, score: scoreFn(item), idx }));
  indexed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx; // stable: preserve original order on tie
  });
  return indexed.map((entry) => entry.item);
}

/**
 * Reorder skills so that those matching job required/preferred skills appear first.
 * Returns a new array of the same length (req 9.2, 9.4).
 */
function reorderSkills(skills: Skill[], job: ParsedJobPosting): Skill[] {
  const jobSkillSet = new Set(
    normaliseArr([...(job.requiredSkills ?? []), ...(job.preferredSkills ?? [])]),
  );

  const emphasized: Skill[] = [];
  const remaining: Skill[] = [];

  for (const skill of skills) {
    if (jobSkillSet.has(normaliseStr(skill.name))) {
      emphasized.push(skill);
    } else {
      remaining.push(skill);
    }
  }

  return [...emphasized, ...remaining];
}

// ─── LLM summary generation ───────────────────────────────────────────────────

/**
 * Generate a tailored professional summary using the LLM.
 *
 * CRITICAL CONSTRAINT: only facts from the original summary are used.
 * Throws on any failure — the caller catches and falls back (req 9.11, 9.12).
 */
async function generateTailoredSummary(
  originalSummary: string,
  job: ParsedJobPosting,
  llmClient: OpenAI,
): Promise<string> {
  // Build a concise excerpt from the job's raw content for context
  const rawExcerpt = (
    job.rawHtml != null
      ? job.rawHtml
      : JSON.stringify(job.rawJson)
  ).slice(0, 500);

  const prompt = [
    'You are a resume writing assistant.',
    'Rewrite the following professional summary to better align with the job description below.',
    'CRITICAL CONSTRAINT: Use ONLY facts, achievements, and information explicitly present in the original summary.',
    'Do NOT add new skills, companies, roles, achievements, or dates that are not in the original.',
    '',
    `Original summary: ${originalSummary}`,
    '',
    `Job title: ${job.title ?? 'Not specified'}`,
    `Required skills: ${job.requiredSkills?.join(', ') ?? 'Not specified'}`,
    `Job description excerpt: ${rawExcerpt}`,
    '',
    'Return only the rewritten summary text, nothing else.',
  ].join('\n');

  const response = await llmClient.chat.completions.create({
    model: process.env['LLM_MODEL'] ?? 'llama3',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (content == null || content.trim() === '') {
    throw new Error('LLM returned empty summary content');
  }

  return content.trim();
}

// ─── Truthfulness validation ──────────────────────────────────────────────────

/**
 * Validate that an optimized resume contains no fabrications relative to the
 * original base resume. Checks:
 *   - Experiences: same count, all entries match original by company+title+startDate (req 9.4, 9.5)
 *   - Projects: same count, all entries match original by name (req 9.4, 9.6)
 *   - Skills: every skill in optimized exists in original by name (req 9.7)
 *   - Certifications: no new certification names not in original (req 9.4)
 *   - Education: no new institution+degree combos not in original (req 9.4)
 */
export function validateTruthfulness(
  original: ResumeVersion,
  optimized: TailoredResume,
): TruthfulnessReport {
  const violations: TruthfulnessViolation[] = [];

  // ── Experiences check (req 9.5) ───────────────────────────────────────────
  const origExpCount = original.content.experiences.length;
  const optExpCount = optimized.content.experiences.length;

  if (optExpCount !== origExpCount) {
    violations.push({
      field: 'experiences',
      reason: `Experience count mismatch: original has ${origExpCount}, optimized has ${optExpCount}`,
    });
  } else {
    // Build a set of normalised "company|title|startDate" keys from original
    const origExpKeys = new Set(
      original.content.experiences.map((e) =>
        `${normaliseStr(e.company)}|${normaliseStr(e.title)}|${normaliseStr(e.startDate)}`,
      ),
    );

    for (const exp of optimized.content.experiences) {
      const key = `${normaliseStr(exp.company)}|${normaliseStr(exp.title)}|${normaliseStr(exp.startDate)}`;
      if (!origExpKeys.has(key)) {
        violations.push({
          field: 'experiences',
          reason: `Experience not found in original: "${exp.title}" at "${exp.company}" (${exp.startDate})`,
        });
      }
    }
  }

  // ── Projects check (req 9.6) ──────────────────────────────────────────────
  const origProjCount = original.content.projects.length;
  const optProjCount = optimized.content.projects.length;

  if (optProjCount !== origProjCount) {
    violations.push({
      field: 'projects',
      reason: `Project count mismatch: original has ${origProjCount}, optimized has ${optProjCount}`,
    });
  } else {
    const origProjNames = new Set(
      original.content.projects.map((p) => normaliseStr(p.name)),
    );

    for (const proj of optimized.content.projects) {
      if (!origProjNames.has(normaliseStr(proj.name))) {
        violations.push({
          field: 'projects',
          reason: `Project not found in original: "${proj.name}"`,
        });
      }
    }
  }

  // ── Skills check — optimized must be subset of original (req 9.7) ─────────
  const origSkillNames = new Set(
    original.content.skills.map((s) => normaliseStr(s.name)),
  );

  for (const skill of optimized.content.skills) {
    if (!origSkillNames.has(normaliseStr(skill.name))) {
      violations.push({
        field: 'skills',
        reason: `Skill not found in original: "${skill.name}"`,
      });
    }
  }

  // ── Certifications check — no new certs (req 9.4) ────────────────────────
  const origCertNames = new Set(
    original.content.certifications.map((c) => normaliseStr(c.name)),
  );

  for (const cert of optimized.content.certifications) {
    if (!origCertNames.has(normaliseStr(cert.name))) {
      violations.push({
        field: 'certifications',
        reason: `Certification not found in original: "${cert.name}"`,
      });
    }
  }

  // ── Education check — no new entries (req 9.4) ───────────────────────────
  const origEduKeys = new Set(
    original.content.education.map((e) =>
      `${normaliseStr(e.institution)}|${normaliseStr(e.degree)}`,
    ),
  );

  for (const edu of optimized.content.education) {
    const key = `${normaliseStr(edu.institution)}|${normaliseStr(edu.degree)}`;
    if (!origEduKeys.has(key)) {
      violations.push({
        field: 'education',
        reason: `Education entry not found in original: "${edu.degree}" at "${edu.institution}"`,
      });
    }
  }

  if (violations.length > 0) {
    log.warn(
      { violations, baseResumeId: original.id, userId: original.userId },
      'Truthfulness validation failed — fabrications detected',
    );
    return { hasFabrications: true, violations };
  }

  return { hasFabrications: false, violations: [] };
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Optimize a base resume for a specific job posting.
 *
 * Reorders experiences, projects, and skills by relevance to the job,
 * and attempts to generate a tailored summary via LLM.
 * On LLM failure, falls back to the original summary (req 9.11, 9.12).
 * Education and certifications are copied verbatim — never reordered (req 9.4).
 *
 * @param baseResume  The user's base resume version.
 * @param job         The parsed job posting to optimize against.
 * @param llmClient   Optional OpenAI-compatible client; created from env vars if omitted.
 */
export async function optimizeResume(
  baseResume: ResumeVersion,
  job: ParsedJobPosting,
  llmClient?: OpenAI,
): Promise<TailoredResume> {
  const client =
    llmClient ??
    new OpenAI({
      baseURL: process.env['OPENAI_BASE_URL'] ?? 'http://localhost:11434/v1',
      apiKey: process.env['OPENAI_API_KEY'] ?? 'ollama',
    });

  log.info(
    { resumeId: baseResume.id, userId: baseResume.userId, jobTitle: job.title },
    'Starting resume optimization',
  );

  // ── Reorder experiences by relevance (req 9.1) ────────────────────────────
  const reorderedExperiences = reorderByRelevance(
    baseResume.content.experiences,
    (exp) => scoreExperienceRelevance(exp, job),
  );

  // ── Reorder projects by relevance (req 9.1) ───────────────────────────────
  const reorderedProjects = reorderByRelevance(
    baseResume.content.projects,
    (proj) => scoreProjectRelevance(proj, job),
  );

  // ── Reorder skills with emphasized first (req 9.2) ────────────────────────
  const reorderedSkills = reorderSkills(baseResume.content.skills, job);

  // ── Generate tailored summary via LLM (req 9.3) ───────────────────────────
  let tailoredSummary = baseResume.content.summary;
  let summaryGenerated = false;
  let summaryFallback = false;

  try {
    tailoredSummary = await generateTailoredSummary(
      baseResume.content.summary,
      job,
      client,
    );
    summaryGenerated = true;
    summaryFallback = false;
    log.info(
      { resumeId: baseResume.id },
      'LLM summary generation succeeded',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { resumeId: baseResume.id, error: message },
      'LLM summary generation failed — falling back to original summary',
    );
    tailoredSummary = baseResume.content.summary;
    summaryGenerated = false;
    summaryFallback = true;
  }

  // ── Assemble the tailored resume ──────────────────────────────────────────
  // Education and certifications copied verbatim — no modification (req 9.4)
  const tailoredContent: ResumeContent = {
    ...baseResume.content,
    experiences: reorderedExperiences,
    projects: reorderedProjects,
    skills: reorderedSkills,
    education: baseResume.content.education,
    certifications: baseResume.content.certifications,
    summary: tailoredSummary,
  };

  const result: TailoredResume = {
    baseResumeId: baseResume.id,
    userId: baseResume.userId,
    content: tailoredContent,
    optimizationMetadata: {
      experiencesReordered: true,
      projectsReordered: true,
      skillsReordered: true,
      summaryGenerated,
      summaryFallback,
    },
  };

  log.info(
    {
      resumeId: baseResume.id,
      userId: baseResume.userId,
      summaryGenerated,
      summaryFallback,
    },
    'Resume optimization complete',
  );

  // ── Truthfulness validation (req 9.4, 9.5, 9.6, 9.7, 9.8, 9.9) ──────────
  const truthfulnessReport = validateTruthfulness(baseResume, result);
  if (truthfulnessReport.hasFabrications) {
    log.warn(
      { resumeId: baseResume.id, userId: baseResume.userId, violations: truthfulnessReport.violations },
      'Fabrications detected — discarding optimized resume and returning base resume',
    );
    return {
      baseResumeId: baseResume.id,
      userId: baseResume.userId,
      content: baseResume.content,
      optimizationMetadata: {
        experiencesReordered: false,
        projectsReordered: false,
        skillsReordered: false,
        summaryGenerated: false,
        summaryFallback: false,
        truthfulnessFallback: true,
      },
    };
  }

  return result;
}
