import { z } from 'zod/v4';

// ─── Status enum ──────────────────────────────────────────────────────────────

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'rejected',
  'withdrawn',
  'ghosted',
  'failed_submission',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Statuses from which backward transitions are forbidden (req 18.4).
 * Once an application reaches one of these statuses, it cannot be moved to
 * any status that appears earlier in the ordered sequence.
 */
export const FORWARD_ONLY_STATUSES: ApplicationStatus[] = [
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
  'offer_declined',
];

/**
 * Ordered sequence used to determine "earlier" vs "later" for forward-only
 * enforcement. Terminal statuses (rejected, withdrawn, ghosted,
 * failed_submission) are placed at the end and not subject to the forward-only
 * rule in the same way — they can be reached from any non-terminal status.
 */
export const STATUS_ORDER: ApplicationStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'phone_screen',
  'technical_interview',
  'final_round',
  'offer_received',
  'offer_accepted',
  'offer_declined',
  // Terminal statuses — reachable from any status
  'rejected',
  'withdrawn',
  'ghosted',
  'failed_submission',
];

// ─── Request schemas ──────────────────────────────────────────────────────────

export const CreateApplicationRequest = z.object({
  jobPostingId: z.string().min(1),
  appliedAt: z.string().datetime(),
  source: z.string().min(1),
  applicationUrl: z.string().url(),
  resumeVersionId: z.string().min(1),
  coverLetterPath: z.string().optional(),
  status: z.enum(APPLICATION_STATUSES).optional().default('draft'),
  automationSessionId: z.string().optional(),
  screenshotPaths: z.array(z.string()).optional().default([]),
  confirmationNumber: z.string().optional(),
  formAnswersSnapshot: z.record(z.string(), z.unknown()).optional().default({}),
  fingerprint: z.string().min(1),
  notes: z.string().optional().default(''),
  /** Written once at creation — never updated by subsequent API calls (req 18.5) */
  matchScoreSnapshot: z.record(z.string(), z.unknown()),
});

export type CreateApplicationRequestType = z.infer<typeof CreateApplicationRequest>;

export const UpdateApplicationStatusRequest = z.object({
  status: z.enum(APPLICATION_STATUSES),
  triggeredBy: z.string().min(1).optional().default('user'),
  note: z.string().optional(),
});

export type UpdateApplicationStatusRequestType = z.infer<typeof UpdateApplicationStatusRequest>;

export const ListApplicationsQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListApplicationsQueryType = z.infer<typeof ListApplicationsQuerySchema>;

// ─── Response schemas ─────────────────────────────────────────────────────────

export const StatusTransitionResponse = z.object({
  id: z.string(),
  applicationRecordId: z.string(),
  from: z.string(),
  to: z.string(),
  triggeredBy: z.string(),
  timestamp: z.date(),
  note: z.string().nullable(),
});

export const ApplicationResponse = z.object({
  id: z.string(),
  userId: z.string(),
  jobPostingId: z.string(),
  appliedAt: z.date(),
  source: z.string(),
  applicationUrl: z.string(),
  resumeVersionId: z.string(),
  coverLetterPath: z.string().nullable(),
  status: z.string(),
  automationSessionId: z.string().nullable(),
  screenshotPaths: z.array(z.string()),
  confirmationNumber: z.string().nullable(),
  formAnswersSnapshot: z.unknown(),
  fingerprint: z.string(),
  rejectionReason: z.string().nullable(),
  notes: z.string(),
  matchScoreSnapshot: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
  jobPosting: z
    .object({
      title: z.string(),
      company: z.string(),
    })
    .optional()
    .nullable(),
  resumeVersion: z
    .object({
      name: z.string(),
      specialization: z.string(),
    })
    .optional()
    .nullable(),
  transitions: z.array(StatusTransitionResponse).optional(),
});

export type ApplicationResponseType = z.infer<typeof ApplicationResponse>;
