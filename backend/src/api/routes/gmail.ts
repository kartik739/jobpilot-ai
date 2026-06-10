/**
 * Gmail OAuth route handlers
 *
 * GET /api/auth/gmail/authorize  — authenticated; returns the OAuth consent URL
 * GET /api/auth/gmail/callback   — public; handles the OAuth redirect from Google
 *
 * Requirements: 16.1, 16.8, 17.1
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod/v4';
import { authenticate } from '../../core/auth.js';
import {
  getAuthorizationUrl,
  handleOAuthCallback,
  revokeTokens,
} from '../../integrations/gmail.js';
import { prisma } from '../../db.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ module: 'gmailRoutes' });

// ─── Query schemas ────────────────────────────────────────────────────────────

const AuthorizeQuery = z.object({
  /** Pass `calendarEnabled=true` to also request the Google Calendar write scope */
  calendarEnabled: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  /** Google may return an error when the user denies consent */
  error: z.string().optional(),
});

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function gmailRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/auth/gmail/authorize
   *
   * Returns the Google OAuth consent URL.
   * The caller should redirect the user (or open the URL) to initiate the flow.
   *
   * Query params:
   *   calendarEnabled (optional) — set to "true" to include calendar scope (Req 17.1)
   *
   * Requirements: 16.1, 17.1
   */
  app.get(
    '/api/auth/gmail/authorize',
    { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.id;

      const qResult = AuthorizeQuery.safeParse(req.query);
      if (!qResult.success) {
        return reply
          .status(400)
          .send({ error: 'Validation failed', details: qResult.error.issues });
      }

      const { calendarEnabled } = qResult.data;

      // If the user has an explicit Google Calendar integration preference stored
      // in their profile/settings, merge it with the query-param flag (Req 17.1).
      // For now we rely solely on the query param; the broader integration can
      // augment this once a GoogleCalendarConfig model is added.
      let shouldRequestCalendar = calendarEnabled;

      if (!shouldRequestCalendar) {
        // Check whether any job_source_config for 'google_calendar' exists and is enabled
        const calendarConfig = await prisma.jobSourceConfig.findFirst({
          where: { userId, platform: 'google_calendar', enabled: true },
        });
        if (calendarConfig) {
          shouldRequestCalendar = true;
          log.debug({ userId }, 'Google Calendar config found — including calendar scope');
        }
      }

      try {
        const authUrl = getAuthorizationUrl(userId, shouldRequestCalendar);
        log.info({ userId, calendarEnabled: shouldRequestCalendar }, 'Gmail authorize URL generated');
        return reply.send({ url: authUrl });
      } catch (err) {
        log.error({ userId, err }, 'Failed to generate Gmail authorization URL');
        return reply.status(500).send({ error: 'Failed to generate authorization URL' });
      }
    },
  );

  /**
   * GET /api/auth/gmail/callback
   *
   * Public route — called by Google after the user grants (or denies) consent.
   * Exchanges the authorization code for tokens, stores them encrypted, and
   * redirects the user to the frontend.
   *
   * Requirements: 16.1
   */
  app.get(
    '/api/auth/gmail/callback',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const qResult = CallbackQuery.safeParse(req.query);
      if (!qResult.success) {
        return reply
          .status(400)
          .send({ error: 'Validation failed', details: qResult.error.issues });
      }

      const { code, state, error: oauthError } = qResult.data;

      // User denied consent
      if (oauthError) {
        log.warn({ oauthError }, 'Gmail OAuth denied by user');
        const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
        return reply.redirect(`${frontendUrl}/settings/integrations?gmail=denied`);
      }

      try {
        const userId = await handleOAuthCallback(code, state);
        log.info({ userId }, 'Gmail OAuth callback completed successfully');

        const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
        return reply.redirect(`${frontendUrl}/settings/integrations?gmail=connected`);
      } catch (err) {
        log.error({ err }, 'Gmail OAuth callback failed');
        const frontendUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:5173';
        return reply.redirect(`${frontendUrl}/settings/integrations?gmail=error`);
      }
    },
  );

  /**
   * DELETE /api/auth/gmail
   *
   * Authenticated route — revokes and removes the user's Gmail OAuth tokens.
   */
  app.delete(
    '/api/auth/gmail',
    { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = req.user.id;

      try {
        await revokeTokens(userId);
        log.info({ userId }, 'Gmail tokens revoked via API');
        return reply.status(204).send();
      } catch (err) {
        log.error({ userId, err }, 'Failed to revoke Gmail tokens');
        return reply.status(500).send({ error: 'Failed to revoke Gmail access' });
      }
    },
  );
}
