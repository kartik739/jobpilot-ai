/**
 * Notification Manager
 *
 * Creates notification records in the database and publishes them to Redis
 * for real-time WebSocket delivery.
 *
 * Requirements: 21.1, 21.2
 */

import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'notificationManager' });

// ─── Event type definitions ───────────────────────────────────────────────────

export type ApplicationSubmittedEvent = {
  type: 'application_submitted';
  jobTitle: string;
  company: string;
  applicationId?: string;
};

export type InterviewDetectedEvent = {
  type: 'interview_detected';
  jobTitle: string;
  company: string;
  interviewDate?: string;
  applicationId?: string;
};

export type OfferReceivedEvent = {
  type: 'offer_received';
  jobTitle: string;
  company: string;
  applicationId?: string;
};

export type ManualInterventionRequiredEvent = {
  type: 'manual_intervention_required';
  reason: string;
  jobTitle?: string;
  company?: string;
  applicationId?: string;
};

export type SourceErrorEvent = {
  type: 'source_error';
  platform: string;
  errorMessage: string;
};

export type DailyLimitReachedEvent = {
  type: 'daily_limit_reached';
  limit: number;
  appliedCount: number;
};

export type NotificationEvent =
  | ApplicationSubmittedEvent
  | InterviewDetectedEvent
  | OfferReceivedEvent
  | ManualInterventionRequiredEvent
  | SourceErrorEvent
  | DailyLimitReachedEvent;

// ─── Title/body mapping ───────────────────────────────────────────────────────

function buildNotificationContent(event: NotificationEvent): {
  title: string;
  body: string;
} {
  switch (event.type) {
    case 'application_submitted':
      return {
        title: 'Application Submitted',
        body: `Your application to ${event.company} for ${event.jobTitle} has been submitted successfully.`,
      };

    case 'interview_detected':
      return {
        title: 'Interview Detected',
        body: event.interviewDate
          ? `An interview has been scheduled with ${event.company} for ${event.jobTitle} on ${event.interviewDate}.`
          : `An interview has been detected for ${event.jobTitle} at ${event.company}.`,
      };

    case 'offer_received':
      return {
        title: 'Offer Received 🎉',
        body: `Congratulations! You have received an offer from ${event.company} for the ${event.jobTitle} role.`,
      };

    case 'manual_intervention_required':
      return {
        title: 'Manual Intervention Required',
        body: event.jobTitle && event.company
          ? `Your application to ${event.company} for ${event.jobTitle} requires your attention: ${event.reason}`
          : `An application requires your attention: ${event.reason}`,
      };

    case 'source_error':
      return {
        title: 'Job Source Error',
        body: `An error occurred while fetching jobs from ${event.platform}: ${event.errorMessage}`,
      };

    case 'daily_limit_reached':
      return {
        title: 'Daily Application Limit Reached',
        body: `You have reached your daily application limit of ${event.limit}. Applications will resume tomorrow.`,
      };
  }
}

// ─── Redis channel helper ─────────────────────────────────────────────────────

export function notificationChannel(userId: string): string {
  return `notifications:${userId}`;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Persists a notification to the database and publishes it to Redis for
 * real-time delivery via WebSocket. Delivery is best-effort within ≤5s.
 *
 * Requirements: 21.1, 21.2
 */
export async function createNotification(
  userId: string,
  event: NotificationEvent,
  prisma: PrismaClient,
  redis: Redis,
): Promise<void> {
  const { title, body } = buildNotificationContent(event);

  // 1. Persist to database (req 21.1)
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: event.type,
      title,
      body,
      metadata: event as object,
      isRead: false,
    },
  });

  log.info({ userId, notificationId: notification.id, type: event.type }, 'Notification created');

  // 2. Publish to Redis for real-time WebSocket delivery (req 21.2)
  const channel = notificationChannel(userId);
  const message = JSON.stringify(notification);

  try {
    await redis.publish(channel, message);
    log.debug({ userId, channel, notificationId: notification.id }, 'Notification published to Redis');
  } catch (err) {
    // Non-fatal: the notification is already persisted; real-time delivery
    // failure is acceptable — polling fallback will catch missed events.
    log.warn({ userId, channel, err }, 'Failed to publish notification to Redis');
  }
}
