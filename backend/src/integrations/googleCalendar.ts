/**
 * Google Calendar Integration
 *
 * Creates Google Calendar events for interview invitations detected via email.
 * Handles disabled integration, API failures, and missing duration gracefully.
 *
 * Requirements: 17.2, 17.3, 17.4, 17.5, 17.6
 */

import { google } from 'googleapis';
import { prisma } from '../db.js';
import { getOAuth2Client } from './gmail.js';
import { createChildLogger } from '../core/logger.js';
import type { EmailClassification } from '../agents/emailMonitor.js';

const log = createChildLogger({ module: 'googleCalendar' });

/** Default interview duration when it cannot be extracted from the email (Req 17.3). */
const DEFAULT_DURATION_MINUTES = 60;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Structured interview details extracted from an email classification result.
 * All optional fields degrade gracefully — only `applicationId` and `userId`
 * are required to store records and attempt calendar creation.
 */
export interface InterviewDetails {
  applicationId: string;
  userId: string;
  interviewDate?: Date;
  interviewTime?: string;       // e.g. "2:00 PM"
  interviewDuration?: number;   // minutes; defaults to 60 when absent (Req 17.3)
  interviewFormat?: string;     // e.g. "video", "phone", "onsite"
  interviewLocation?: string;
  companyName?: string;
  roleName?: string;
  notes?: string;
}

// ─── extractInterviewDetails ──────────────────────────────────────────────────

/**
 * Parse an LLM email classification result into a structured InterviewDetails
 * object ready for calendar event creation.
 *
 * The LLM extracts free-form text fields in `extractedEntities`; this function
 * normalizes them into typed values. Unknown/unparseable fields are left
 * undefined so callers can apply defaults (e.g. 60-minute duration).
 *
 * Requirements: 17.2, 17.3
 */
export function extractInterviewDetails(
  classification: EmailClassification,
  applicationId: string,
  userId: string,
): InterviewDetails {
  const entities = classification.extractedEntities;

  // ── Date parsing ─────────────────────────────────────────────────────────
  let interviewDate: Date | undefined;
  const rawDate = entities['interview_date'] ?? entities['date'];
  const rawTime = entities['interview_time'] ?? entities['time'];

  if (rawDate) {
    // Attempt to parse "YYYY-MM-DD", "Month DD, YYYY", or combined date+time
    const combined = rawTime ? `${rawDate} ${rawTime}` : rawDate;
    const parsed = Date.parse(combined);
    if (!Number.isNaN(parsed)) {
      interviewDate = new Date(parsed);
    } else {
      // Try date-only
      const dateOnly = Date.parse(rawDate);
      if (!Number.isNaN(dateOnly)) {
        interviewDate = new Date(dateOnly);
      }
    }
  }

  // ── Duration parsing (Req 17.3 — default to 60 min if not extractable) ──
  let interviewDuration: number | undefined;
  const rawDuration = entities['duration'] ?? entities['interview_duration'];
  if (rawDuration) {
    // Accept "60", "60 min", "1 hour", "1.5 hours"
    const minuteMatch = rawDuration.match(/(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?)/i);
    const hourMatch = rawDuration.match(/(\d+(?:\.\d+)?)\s*hour/i);

    if (minuteMatch?.[1]) {
      interviewDuration = Math.round(parseFloat(minuteMatch[1]));
    } else if (hourMatch?.[1]) {
      interviewDuration = Math.round(parseFloat(hourMatch[1]) * 60);
    } else {
      const plain = parseInt(rawDuration, 10);
      if (!Number.isNaN(plain) && plain > 0) {
        interviewDuration = plain;
      }
    }
  }

  return {
    applicationId,
    userId,
    interviewDate,
    interviewTime: rawTime,
    interviewDuration,
    interviewFormat: entities['format'] ?? entities['interview_format'],
    interviewLocation: entities['location'] ?? entities['interview_location'],
    companyName: classification.company || undefined,
    roleName: classification.role,
    notes: entities['notes'],
  };
}

// ─── storeInterviewDetailsInDB ────────────────────────────────────────────────

/**
 * Persist interview details to the ApplicationRecord.
 * Called in all paths (success, failure, disabled) so interview data is never lost.
 *
 * Requirements: 17.4, 17.5, 17.6
 */
async function storeInterviewDetailsInDB(
  interview: InterviewDetails,
  calendarEventId?: string,
): Promise<void> {
  const duration = interview.interviewDuration ?? DEFAULT_DURATION_MINUTES;

  await prisma.applicationRecord.update({
    where: { id: interview.applicationId },
    data: {
      ...(interview.interviewDate && { interviewDate: interview.interviewDate }),
      interviewDuration: duration,
      ...(interview.interviewFormat && { interviewFormat: interview.interviewFormat }),
      ...(calendarEventId && { calendarEventId }),
    },
  });

  log.info(
    {
      applicationId: interview.applicationId,
      calendarEventId,
      interviewDate: interview.interviewDate,
      duration,
    },
    'Interview details stored in DB',
  );
}

// ─── createInterviewEvent ─────────────────────────────────────────────────────

/**
 * Create a Google Calendar event for an interview invitation and link it to
 * the ApplicationRecord.
 *
 * Behaviour matrix:
 * - Calendar integration disabled → store details in DB, return '' (Req 17.6)
 * - Calendar enabled, success      → store details + eventId in DB, return eventId (Req 17.4)
 * - Calendar enabled, API error    → log, store details, notify user, return '' (Req 17.5)
 *
 * @param interview  Structured interview details parsed from the email.
 * @returns          The Google Calendar event ID on success, empty string otherwise.
 *
 * Requirements: 17.3, 17.4, 17.5, 17.6
 */
export async function createInterviewEvent(interview: InterviewDetails): Promise<string> {
  const { applicationId, userId } = interview;

  // ── Req 17.6: Check if Calendar integration is enabled ───────────────────
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailCalendarScope: true },
  });

  if (!user?.gmailCalendarScope) {
    log.info(
      { userId, applicationId },
      'Google Calendar integration disabled — storing interview details only (Req 17.6)',
    );
    await storeInterviewDetailsInDB(interview);
    return '';
  }

  // ── Req 17.3: Apply default duration ─────────────────────────────────────
  const durationMinutes = interview.interviewDuration ?? DEFAULT_DURATION_MINUTES;

  if (!interview.interviewDuration) {
    log.info(
      { userId, applicationId },
      'Interview duration not extractable — defaulting to 60 minutes (Req 17.3)',
    );
  }

  // ── Build event start/end times ───────────────────────────────────────────
  // If we have no date, we still try to create the event — callers can choose
  // to skip, but the requirement says to always attempt when integration is on.
  const startDate = interview.interviewDate ?? new Date();
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const eventTitle = buildEventTitle(interview);
  const eventDescription = buildEventDescription(interview);

  // ── Req 17.4, 17.5: Create Calendar event ────────────────────────────────
  try {
    const auth = await getOAuth2Client(userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calendar = google.calendar({ version: 'v3', auth: auth as any });

    const eventBody: {
      summary: string;
      description: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
      location?: string;
    } = {
      summary: eventTitle,
      description: eventDescription,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'UTC',
      },
    };

    if (interview.interviewLocation) {
      eventBody.location = interview.interviewLocation;
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventBody,
    });

    const eventId = response.data.id;
    if (!eventId) {
      throw new Error('Google Calendar API returned no event ID');
    }

    // Req 17.4: link calendarEventId to ApplicationRecord
    await storeInterviewDetailsInDB(interview, eventId);

    log.info(
      { userId, applicationId, eventId },
      'Google Calendar event created and linked to ApplicationRecord (Req 17.4)',
    );

    return eventId;
  } catch (err) {
    // Req 17.5: log error, store interview details, notify user
    log.error(
      { userId, applicationId, err },
      'Google Calendar API call failed — storing details and notifying user (Req 17.5)',
    );

    // Always store interview details even when calendar creation fails
    try {
      await storeInterviewDetailsInDB(interview);
    } catch (dbErr) {
      log.error({ userId, applicationId, dbErr }, 'Failed to store interview details after Calendar API error');
    }

    // Notify user to create the event manually
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: 'calendar_event_failed',
          title: 'Interview event not created',
          body: 'We could not automatically add your interview to Google Calendar. Please create the event manually.',
          metadata: {
            applicationId,
            interviewDate: interview.interviewDate?.toISOString() ?? null,
            companyName: interview.companyName ?? null,
            roleName: interview.roleName ?? null,
          },
        },
      });
    } catch (notifErr) {
      log.error(
        { userId, applicationId, notifErr },
        'Failed to create calendar_event_failed notification',
      );
    }

    return '';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function buildEventTitle(interview: InterviewDetails): string {
  const parts: string[] = ['Interview'];
  if (interview.roleName) parts.push(`— ${interview.roleName}`);
  if (interview.companyName) parts.push(`at ${interview.companyName}`);
  return parts.join(' ');
}

function buildEventDescription(interview: InterviewDetails): string {
  const lines: string[] = [];

  if (interview.interviewFormat) {
    lines.push(`Format: ${interview.interviewFormat}`);
  }
  if (interview.interviewLocation) {
    lines.push(`Location: ${interview.interviewLocation}`);
  }
  if (interview.notes) {
    lines.push(`Notes: ${interview.notes}`);
  }

  lines.push(`\nApplication ID: ${interview.applicationId}`);
  lines.push('Created automatically by JobPilot AI');

  return lines.join('\n');
}
