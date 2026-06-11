/**
 * Email Monitor Agent
 *
 * Classifies incoming recruitment emails using an LLM and matches them to
 * existing application records to automatically update application status.
 *
 * Flow:
 *   1. processEmail             — classify email content via LLM (6 types)
 *   2. matchEmailToApplication  — fuzzy-match company name to applications
 *   3. updateApplicationStatus  — write new status + StatusTransition record
 *   4. pollGmail                — fetch unread emails, run the full pipeline, mark processed
 *   5. startMonitoring          — schedule pollGmail every 15 minutes
 *
 * Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import OpenAI from 'openai';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import levenshtein from 'fast-levenshtein';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db.js';
import { createChildLogger } from '../core/logger.js';
import { getOAuth2Client, handleGmailAuthExpired, GmailAuthError } from '../integrations/gmail.js';
import { createInterviewEvent, extractInterviewDetails } from '../integrations/googleCalendar.js';

const log = createChildLogger({ module: 'emailMonitor' });

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * A decoded, normalised Gmail message ready for classification.
 * This is the public contract for processEmail.
 */
export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  body: string;
  receivedAt: Date;
}

/** The result of classifying a recruitment email. */
export interface EmailClassification {
  type: 'interview_invite' | 'rejection' | 'offer' | 'assessment' | 'followup' | 'other';
  company: string;
  role?: string;
  confidence: number;
  extractedEntities: Record<string, string>;
}

/** A minimal ApplicationRecord with its JobPosting company info. */
export interface ApplicationRecord {
  id: string;
  userId: string;
  status: string;
  fingerprint: string;
  jobPostingId: string;
  jobPosting: {
    company: string;
    title: string;
  };
}

/**
 * OAuth token bundle used to authenticate Gmail API calls.
 * Matches the shape stored in the User model (decrypted before use).
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<EmailClassification['type']>([
  'interview_invite',
  'rejection',
  'offer',
  'assessment',
  'followup',
  'other',
]);

/** Minimum Levenshtein-based similarity to count as a match (Req 16.6). */
const SIMILARITY_THRESHOLD = 0.8;

/** Gmail API label removed to mark an email as processed/read. */
const UNREAD_LABEL = 'UNREAD';

/** Poll interval in ms (15 minutes). */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decode a base64url-encoded string from Gmail payload bodies.
 * Returns an empty string on error rather than throwing.
 */
function decodeBase64Url(data: string): string {
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Extract a header value from a Gmail message headers array.
 */
function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Extract plain-text body from a raw Gmail API message payload.
 * Checks top-level body, then parts, then falls back to snippet.
 */
function extractBody(
  payload: {
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  } | undefined,
  snippet?: string,
): string {
  if (!payload) return snippet ?? '';

  const topBodyData = payload.body?.data;
  if (topBodyData) return decodeBase64Url(topBodyData);

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
  }

  return snippet ?? '';
}

/**
 * Compute string similarity as `1 - editDistance / max(len(a), len(b))`.
 * Returns 1 if both strings are empty.
 */
function stringSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
  const distance = levenshtein.get(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

// ─── processEmail ─────────────────────────────────────────────────────────────

/**
 * Classify a recruitment email into one of 6 categories using an LLM.
 *
 * On any LLM error or unavailability, returns a safe fallback classification
 * with type 'other' and confidence 0 so the pipeline can skip the update
 * gracefully (Req 16.4).
 *
 * @param email      A decoded GmailMessage to classify.
 * @param llmClient  Optional OpenAI-compatible client; created from env vars if omitted.
 *
 * Requirements: 16.3, 16.4
 */
export async function processEmail(
  email: GmailMessage,
  llmClient?: OpenAI,
): Promise<EmailClassification> {
  const SAFE_FALLBACK: EmailClassification = {
    type: 'other',
    company: '',
    confidence: 0,
    extractedEntities: {},
  };

  const client =
    llmClient ??
    new OpenAI({
      baseURL: process.env['OPENAI_BASE_URL'] ?? 'http://localhost:11434/v1',
      apiKey: process.env['OPENAI_API_KEY'] ?? 'ollama',
    });

  const prompt = `Classify the following recruitment email. Return a JSON object with these fields:
- type: one of "interview_invite", "rejection", "offer", "assessment", "followup", "other"
- company: the company name as a string (empty string if unknown)
- role: the job role/title mentioned as a string (omit if unknown)
- confidence: a number from 0.0 to 1.0 indicating classification confidence
- extractedEntities: an object with any relevant extracted key-value pairs (dates, locations, interview times, etc.)

Email subject: ${email.subject}
Email from: ${email.from}
Email body: ${email.body}

Return ONLY valid JSON, no explanation.`;

  try {
    const response = await client.chat.completions.create({
      model: process.env['LLM_MODEL'] ?? 'llama3',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      log.warn({ emailId: email.id }, 'LLM returned empty content for email classification');
      return SAFE_FALLBACK;
    }

    const parsed = JSON.parse(rawContent) as Record<string, unknown>;

    // Validate and normalize the type field (Req 16.3)
    const rawType = parsed['type'];
    const type: EmailClassification['type'] =
      typeof rawType === 'string' && VALID_TYPES.has(rawType as EmailClassification['type'])
        ? (rawType as EmailClassification['type'])
        : 'other';

    const company =
      typeof parsed['company'] === 'string' ? parsed['company'] : '';
    const role =
      typeof parsed['role'] === 'string' ? parsed['role'] : undefined;
    const confidence =
      typeof parsed['confidence'] === 'number'
        ? Math.min(1, Math.max(0, parsed['confidence']))
        : 0;

    const rawEntities = parsed['extractedEntities'];
    const extractedEntities: Record<string, string> =
      typeof rawEntities === 'object' && rawEntities !== null && !Array.isArray(rawEntities)
        ? Object.fromEntries(
            Object.entries(rawEntities as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'string',
            ) as [string, string][],
          )
        : {};

    log.info(
      { emailId: email.id, type, company, confidence },
      'Email classified successfully',
    );

    return { type, company, role, confidence, extractedEntities };
  } catch (err) {
    // Req 16.4 — any error must produce safe fallback, never throw
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { emailId: email.id, error: message },
      'LLM classification failed — returning safe fallback',
    );
    return SAFE_FALLBACK;
  }
}

// ─── matchEmailToApplication ──────────────────────────────────────────────────

/**
 * Find the application record whose job company name best matches the
 * classification's company, using Levenshtein similarity.
 *
 * Returns the best match if similarity ≥ 0.8, or null if no match is found.
 * Logs unmatched emails at info level without throwing (Req 16.6, 16.7).
 *
 * @param classification  The email classification to match.
 * @param userId          The user whose applications to search.
 * @param prismaClient    Optional Prisma client; uses default if omitted.
 *
 * Requirements: 16.6, 16.7
 */
export async function matchEmailToApplication(
  classification: EmailClassification,
  userId: string,
  prismaClient?: PrismaClient,
): Promise<ApplicationRecord | null> {
  const db = prismaClient ?? defaultPrisma;

  if (!classification.company) {
    log.info({ userId }, 'No company extracted from email — cannot match to application');
    return null;
  }

  // Fetch all application records for this user with job company name
  const applications = await (db as PrismaClient).applicationRecord.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      status: true,
      fingerprint: true,
      jobPostingId: true,
      jobPosting: {
        select: {
          company: true,
          title: true,
        },
      },
    },
  });

  let bestMatch: ApplicationRecord | null = null;
  let bestSimilarity = 0;

  for (const app of applications) {
    const appCompany = app.jobPosting.company;
    const similarity = stringSimilarity(classification.company, appCompany);

    if (similarity >= SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = app as ApplicationRecord;
    }
  }

  if (!bestMatch) {
    // Req 16.6, 16.7 — log but do not throw
    log.info(
      { userId, company: classification.company, totalApplications: applications.length },
      'No application matched for email classification — skipping status update',
    );
    return null;
  }

  log.info(
    {
      userId,
      applicationId: bestMatch.id,
      company: classification.company,
      similarity: bestSimilarity,
    },
    'Matched email to application record',
  );

  return bestMatch;
}

// ─── updateApplicationStatus ──────────────────────────────────────────────────

/** Map from email classification type to ApplicationRecord status. */
const STATUS_MAP: Partial<Record<EmailClassification['type'], string>> = {
  interview_invite: 'phone_screen',
  offer: 'offer_received',
  rejection: 'rejected',
  assessment: 'under_review',
  followup: 'under_review',
  // 'other' is intentionally absent — no update
};

/**
 * Update an application record's status based on the email classification.
 *
 * Creates a StatusTransition record with triggeredBy = 'email_monitor'.
 * Does nothing if the classification type is 'other'.
 *
 * @param applicationId   The application record to update.
 * @param classification  The email classification driving the update.
 * @param prismaClient    Optional Prisma client; uses default if omitted.
 *
 * Requirements: 16.2, 16.5
 */
export async function updateApplicationStatus(
  applicationId: string,
  classification: EmailClassification,
  prismaClient?: PrismaClient,
): Promise<void> {
  const db = prismaClient ?? defaultPrisma;

  const newStatus = STATUS_MAP[classification.type];
  if (!newStatus) {
    log.debug(
      { applicationId, type: classification.type },
      'Classification type requires no status update',
    );
    return;
  }

  // Fetch current status for the transition record
  const current = await (db as PrismaClient).applicationRecord.findUnique({
    where: { id: applicationId },
    select: { status: true },
  });

  const fromStatus = current?.status ?? 'unknown';

  // Create StatusTransition record
  await (db as PrismaClient).statusTransition.create({
    data: {
      applicationRecordId: applicationId,
      from: fromStatus,
      to: newStatus,
      triggeredBy: 'email_monitor',
      note: `Auto-updated from email classification: ${classification.type} (confidence: ${classification.confidence.toFixed(2)})`,
    },
  });

  // Update the application status
  await (db as PrismaClient).applicationRecord.update({
    where: { id: applicationId },
    data: { status: newStatus },
  });

  log.info(
    { applicationId, from: fromStatus, to: newStatus, type: classification.type },
    'Application status updated from email classification',
  );
}

// ─── pollGmail ────────────────────────────────────────────────────────────────

/**
 * Fetch unread recruitment emails from Gmail, classify each, optionally update
 * application status, then mark the email as read/processed.
 *
 * On Gmail OAuth 401 / token expiry: logs the error, emits a notification via
 * handleGmailAuthExpired, and returns without throwing (Req 16.8).
 *
 * Per-email pipeline:
 *   1. Decode raw Gmail message into GmailMessage
 *   2. processEmail — classify via LLM (Req 16.3, 16.4)
 *   3. Skip status update if confidence < 0.7 (Req 16.5)
 *   4. matchEmailToApplication if confidence ≥ 0.7 (Req 16.6)
 *   5. updateApplicationStatus if matched (Req 16.2)
 *   6. Mark email as read via Gmail API (Req 16.7)
 *
 * @param userId      The user whose Gmail inbox to monitor.
 * @param gmailToken  OAuth credentials (used to build the auth client).
 * @param llmClient   Optional LLM client (injected for testing).
 * @param prismaClient Optional Prisma client (injected for testing).
 *
 * Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */
export async function pollGmail(
  userId: string,
  gmailToken: OAuthToken,
  llmClient?: OpenAI,
  prismaClient?: PrismaClient,
): Promise<void> {
  log.info({ userId }, 'Starting Gmail poll cycle');

  let auth: OAuth2Client;
  try {
    auth = await getOAuth2Client(userId);
  } catch (err) {
    // If tokens simply aren't stored yet, log and bail cleanly
    if (err instanceof GmailAuthError) {
      log.warn({ userId }, 'Gmail auth not available — skipping poll cycle');
      await handleGmailAuthExpired(userId);
      return;
    }
    throw err;
  }

  // Cast needed: googleapis and google-auth-library ship duplicate OAuth2Client
  // declarations that TypeScript treats as incompatible despite being identical.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmail = google.gmail({ version: 'v1', auth: auth as any });

  // ── Fetch list of unread messages ─────────────────────────────────────────
  let messageIds: string[] = [];
  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 50,
    });
    messageIds = (listRes.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean);
  } catch (err: unknown) {
    if (isGoogleAuthError(err)) {
      log.warn({ userId }, 'Gmail list messages returned 401 — handling auth expiry');
      await handleGmailAuthExpired(userId);
      return;
    }
    log.error({ userId, err }, 'Failed to list Gmail messages — aborting poll cycle');
    return;
  }

  log.info({ userId, count: messageIds.length }, 'Fetched unread Gmail messages');

  // ── Process each message ──────────────────────────────────────────────────
  for (const messageId of messageIds) {
    try {
      // Fetch full message
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const raw = msgRes.data;
      const headers = raw.payload?.headers ?? [];

      const decoded: GmailMessage = {
        id: raw.id ?? messageId,
        threadId: raw.threadId ?? '',
        subject: getHeader(headers as Array<{ name: string; value: string }>, 'Subject'),
        from: getHeader(headers as Array<{ name: string; value: string }>, 'From'),
        body: extractBody(
          raw.payload as {
            body?: { data?: string };
            parts?: Array<{ mimeType: string; body?: { data?: string } }>;
          } | undefined,
          raw.snippet ?? '',
        ),
        receivedAt: raw.internalDate
          ? new Date(Number(raw.internalDate))
          : new Date(),
      };

      // Classify via LLM (Req 16.3, 16.4)
      const classification = await processEmail(decoded, llmClient);

      const shouldUpdateStatus = classification.confidence >= 0.7;

      if (shouldUpdateStatus) {
        // Match to application record (Req 16.6)
        const matched = await matchEmailToApplication(classification, userId, prismaClient);

        if (matched) {
          // Update application status (Req 16.2, 16.5)
          await updateApplicationStatus(matched.id, classification, prismaClient);

          // Create calendar event for interview invites (Reqs 17.2–17.6)
          if (classification.type === 'interview_invite') {
            const interviewDetails = extractInterviewDetails(classification, matched.id, userId);
            await createInterviewEvent(interviewDetails).catch((err) => {
              log.error(
                { userId, emailId: messageId, applicationId: matched.id, err },
                'createInterviewEvent threw unexpectedly — continuing',
              );
            });
          }

          log.info(
            { userId, emailId: messageId, applicationId: matched.id, type: classification.type },
            'Email processed — application status updated',
          );
        }
      } else {
        log.info(
          { userId, emailId: messageId, confidence: classification.confidence },
          'Email classification confidence below threshold (0.7) — skipping status update',
        );
      }

      // Mark email as read/processed regardless of confidence (Req 16.7)
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: [UNREAD_LABEL],
        },
      });

      log.debug({ userId, emailId: messageId }, 'Email marked as processed (UNREAD label removed)');
    } catch (err: unknown) {
      if (isGoogleAuthError(err)) {
        // 401 mid-loop: stop processing, notify user
        log.warn({ userId, emailId: messageId }, 'Gmail API 401 during message processing — handling auth expiry');
        await handleGmailAuthExpired(userId);
        return;
      }
      // Non-auth errors: log and continue to the next message (resilient)
      log.error({ userId, emailId: messageId, err }, 'Error processing email — skipping to next');
    }
  }

  log.info({ userId, processed: messageIds.length }, 'Gmail poll cycle complete');
}

// ─── startMonitoring ──────────────────────────────────────────────────────────

/**
 * Schedule `pollGmail` to run every 15 minutes for the given user.
 *
 * Runs an initial poll immediately, then repeats on the interval.
 * The returned NodeJS.Timeout can be passed to `clearInterval` to stop monitoring.
 *
 * @param userId      The user whose Gmail inbox to monitor.
 * @param gmailToken  OAuth credentials for Gmail API access.
 * @param llmClient   Optional LLM client (injected for testing).
 * @param prismaClient Optional Prisma client (injected for testing).
 * @returns           The interval handle; clear it to stop monitoring.
 *
 * Requirements: 16.2, 16.7
 */
export async function startMonitoring(
  userId: string,
  gmailToken: OAuthToken,
  llmClient?: OpenAI,
  prismaClient?: PrismaClient,
): Promise<ReturnType<typeof setInterval>> {
  log.info({ userId, intervalMs: POLL_INTERVAL_MS }, 'Starting Gmail email monitoring');

  // Run the first poll immediately so the user doesn't wait 15 min
  await pollGmail(userId, gmailToken, llmClient, prismaClient).catch((err) => {
    log.error({ userId, err }, 'Initial Gmail poll failed — monitoring will continue on schedule');
  });

  const handle = setInterval(() => {
    void pollGmail(userId, gmailToken, llmClient, prismaClient).catch((err) => {
      log.error({ userId, err }, 'Scheduled Gmail poll failed — will retry next interval');
    });
  }, POLL_INTERVAL_MS);

  return handle;
}

// ─── processAndUpdateFromEmail ────────────────────────────────────────────────

/**
 * Orchestrate the full email-to-status-update pipeline for a single message.
 *
 *  1. Classify the email via LLM (processEmail)
 *  2. Skip if confidence < 0.7 (Req 16.5)
 *  3. Skip if type is 'other' with confidence 0 (Req 16.4 — LLM failure)
 *  4. Match to an application record (matchEmailToApplication)
 *  5. Update application status (updateApplicationStatus)
 *
 * @param email          The decoded GmailMessage to process.
 * @param userId         The user who received the email.
 * @param llmClient      Optional OpenAI-compatible client.
 * @param prismaClient   Optional Prisma client.
 * @returns              Classification result and whether a status update was made.
 *
 * Requirements: 16.2, 16.4, 16.5, 16.6, 16.7
 */
export async function processAndUpdateFromEmail(
  email: GmailMessage,
  userId: string,
  llmClient?: OpenAI,
  prismaClient?: PrismaClient,
): Promise<{ classification: EmailClassification; updated: boolean }> {
  log.info({ emailId: email.id, userId }, 'Processing email for status update');

  const classification = await processEmail(email, llmClient);

  // Req 16.4 — LLM failure produces type='other' with confidence=0; skip update
  if (classification.type === 'other' && classification.confidence === 0) {
    log.info({ emailId: email.id, userId }, 'LLM unavailable fallback — skipping status update');
    return { classification, updated: false };
  }

  // Req 16.5 — low confidence threshold; skip update
  if (classification.confidence < 0.7) {
    log.info(
      { emailId: email.id, userId, confidence: classification.confidence },
      'Email classification confidence below threshold (0.7) — skipping status update',
    );
    return { classification, updated: false };
  }

  // Match to an application record
  const matchedApplication = await matchEmailToApplication(classification, userId, prismaClient);
  if (!matchedApplication) {
    // Req 16.6, 16.7 — already logged in matchEmailToApplication
    return { classification, updated: false };
  }

  // Apply the status update
  await updateApplicationStatus(matchedApplication.id, classification, prismaClient);

  // Create calendar event for interview invites (Reqs 17.2–17.6)
  if (classification.type === 'interview_invite') {
    const interviewDetails = extractInterviewDetails(classification, matchedApplication.id, userId);
    await createInterviewEvent(interviewDetails).catch((err) => {
      log.error(
        { emailId: email.id, userId, applicationId: matchedApplication.id, err },
        'createInterviewEvent threw unexpectedly — continuing',
      );
    });
  }

  log.info(
    { emailId: email.id, userId, applicationId: matchedApplication.id },
    'Email processing complete — application status updated',
  );

  return { classification, updated: true };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Detect whether an error from the googleapis library indicates an
 * authentication / authorization failure (HTTP 401 or invalid_grant).
 */
function isGoogleAuthError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;

  const status = (e['status'] as number | undefined) ?? (e['code'] as number | undefined);
  if (status === 401) return true;

  const response = e['response'] as Record<string, unknown> | undefined;
  if (response && (response['status'] as number | undefined) === 401) return true;

  const message = (e['message'] as string | undefined) ?? '';
  if (message.includes('invalid_grant') || message.includes('Token has been expired or revoked')) {
    return true;
  }

  return false;
}
