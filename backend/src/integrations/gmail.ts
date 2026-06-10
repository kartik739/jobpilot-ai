/**
 * Gmail OAuth 2.0 Integration
 *
 * Handles the full OAuth lifecycle for Gmail access:
 *  - Generating the authorization URL (gmail.readonly + gmail.modify scopes,
 *    optionally calendar scope when the user has Google Calendar enabled)
 *  - Exchanging the authorization code for tokens
 *  - Storing tokens encrypted in the DB
 *  - Refreshing tokens automatically
 *  - Revoking tokens
 *  - Handling 401 / auth-expiry: stops polling, emits `gmail_auth_expired`
 *    WebSocket event, and resumes after re-authorization
 *
 * Requirements: 16.1, 16.8, 17.1
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { encrypt, decrypt } from '../core/encryption.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ module: 'gmailIntegration' });

// ─── OAuth scopes ─────────────────────────────────────────────────────────────

/** Base Gmail scopes always requested (Requirement 16.1) */
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

/** Additional scope requested when Google Calendar is enabled (Requirement 17.1) */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar' as const;

// ─── OAuth2 client factory ────────────────────────────────────────────────────

/**
 * Create a base OAuth2 client using environment credentials.
 * Throws at call-time if required env vars are missing so errors surface early.
 */
function createOAuth2Client(): OAuth2Client {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'];

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Google OAuth environment variables. ' +
        'Ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set.',
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri) as unknown as OAuth2Client;
}

// ─── State encoding ───────────────────────────────────────────────────────────

/**
 * Encode the OAuth `state` parameter so we can recover the userId and
 * calendar-scope flag in the callback without a server-side session.
 * The value is base64-encoded JSON — not a security mechanism on its own,
 * but sufficient for routing purposes; callers should validate the state
 * matches a pending request in production (CSRF protection).
 */
function encodeState(userId: string, calendarEnabled: boolean): string {
  return Buffer.from(JSON.stringify({ userId, calendarEnabled })).toString('base64url');
}

function decodeState(state: string): { userId: string; calendarEnabled: boolean } {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['userId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['calendarEnabled'] === 'boolean'
    ) {
      return parsed as { userId: string; calendarEnabled: boolean };
    }
  } catch {
    // fall through to error below
  }
  throw new Error('Invalid OAuth state parameter');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the Google OAuth consent URL for a user.
 *
 * @param userId - The authenticated user's ID (embedded in state for callback routing)
 * @param calendarEnabled - When true, adds the Google Calendar write scope (Req 17.1)
 * @returns The OAuth authorization URL to redirect the user to
 *
 * Requirements: 16.1, 17.1
 */
export function getAuthorizationUrl(userId: string, calendarEnabled: boolean): string {
  const client = createOAuth2Client();

  const scopes: string[] = [...GMAIL_SCOPES];
  if (calendarEnabled) {
    scopes.push(CALENDAR_SCOPE);
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',   // request refresh token
    prompt: 'consent',        // force consent screen so refresh token is always returned
    scope: scopes,
    state: encodeState(userId, calendarEnabled),
  });

  log.info({ userId, calendarEnabled, scopeCount: scopes.length }, 'Generated Gmail OAuth authorization URL');
  return url;
}

/**
 * Exchange the OAuth authorization code for tokens, encrypt them, and persist
 * to the database.
 *
 * @param code  - The authorization code from Google
 * @param state - The opaque state string echoed back by Google (contains userId)
 * @returns The userId extracted from state, for use in redirects
 *
 * Requirements: 16.1
 */
export async function handleOAuthCallback(code: string, state: string): Promise<string> {
  const { userId, calendarEnabled } = decodeState(state);

  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error('Google OAuth callback: no access_token in token response');
  }

  // Encrypt tokens before persisting (Requirement 24.1)
  const encryptedAccess = encrypt(tokens.access_token);
  const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
  const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailAccessToken: encryptedAccess,
      ...(encryptedRefresh !== null && { gmailRefreshToken: encryptedRefresh }),
      gmailTokenExpiry: expiry,
      gmailCalendarScope: calendarEnabled,
    },
  });

  log.info({ userId, hasRefreshToken: !!tokens.refresh_token, calendarEnabled }, 'Gmail OAuth tokens stored');
  return userId;
}

/**
 * Retrieve an authenticated OAuth2 client for a user, automatically refreshing
 * the access token if it is expired.
 *
 * @param userId - The user whose tokens to load
 * @returns A configured OAuth2 client ready for API calls
 * @throws If no Gmail tokens are found for the user
 *
 * Requirements: 16.1, 16.8
 */
export async function getOAuth2Client(userId: string): Promise<OAuth2Client> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      gmailAccessToken: true,
      gmailRefreshToken: true,
      gmailTokenExpiry: true,
    },
  });

  if (!user?.gmailAccessToken) {
    throw new GmailAuthError(`No Gmail tokens found for user ${userId}`);
  }

  const client = createOAuth2Client();

  const accessToken = decrypt(user.gmailAccessToken);
  const refreshToken = user.gmailRefreshToken ? decrypt(user.gmailRefreshToken) : undefined;

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: user.gmailTokenExpiry?.getTime() ?? undefined,
  });

  // Wire up automatic token persistence when the client refreshes a token
  client.on('tokens', async (newTokens) => {
    log.info({ userId }, 'Gmail access token auto-refreshed — persisting updated tokens');
    try {
      const updates: {
        gmailAccessToken?: string;
        gmailRefreshToken?: string;
        gmailTokenExpiry?: Date | null;
      } = {};

      if (newTokens.access_token) {
        updates.gmailAccessToken = encrypt(newTokens.access_token);
      }
      if (newTokens.refresh_token) {
        updates.gmailRefreshToken = encrypt(newTokens.refresh_token);
      }
      if (newTokens.expiry_date) {
        updates.gmailTokenExpiry = new Date(newTokens.expiry_date);
      }

      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: userId }, data: updates });
      }
    } catch (err) {
      log.error({ userId, err }, 'Failed to persist refreshed Gmail tokens');
    }
  });

  return client;
}

/**
 * Revoke the user's Gmail OAuth tokens and remove them from the database.
 *
 * @param userId - The user whose tokens to revoke
 */
export async function revokeTokens(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { gmailAccessToken: true },
  });

  if (user?.gmailAccessToken) {
    try {
      const client = createOAuth2Client();
      const accessToken = decrypt(user.gmailAccessToken);
      client.setCredentials({ access_token: accessToken });
      await client.revokeCredentials();
      log.info({ userId }, 'Gmail OAuth tokens revoked at Google');
    } catch (err) {
      // Log but do not throw — always clear from DB regardless of revocation result
      log.warn({ userId, err }, 'Failed to revoke Gmail tokens at Google; clearing from DB anyway');
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailAccessToken: null,
      gmailRefreshToken: null,
      gmailTokenExpiry: null,
      gmailCalendarScope: false,
    },
  });

  log.info({ userId }, 'Gmail OAuth tokens cleared from DB');
}

// ─── Auth expiry handling ─────────────────────────────────────────────────────

/**
 * Typed error thrown when Gmail authentication has expired or been revoked.
 * Callers (e.g., the email polling worker) should catch this to stop polling
 * and trigger re-authorization.
 *
 * Requirement: 16.8
 */
export class GmailAuthError extends Error {
  readonly name = 'GmailAuthError' as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Handle a Gmail API authentication failure (HTTP 401 / token revoked).
 *
 * This function:
 *  1. Clears the invalid tokens from the DB
 *  2. Creates a `gmail_auth_expired` Notification so the user is alerted in-app
 *  3. Optionally emits a `gmail_auth_expired` WebSocket event via the Fastify
 *     instance if one is available
 *
 * The caller is responsible for stopping polling after calling this function.
 *
 * @param userId  - The affected user
 * @param app     - The Fastify instance (optional; for live WS delivery)
 *
 * Requirement: 16.8
 */
export async function handleGmailAuthExpired(
  userId: string,
  app?: FastifyInstance,
): Promise<void> {
  log.warn({ userId }, 'Gmail auth expired — clearing tokens and notifying user');

  // Clear invalid tokens so they are not used in further attempts
  await prisma.user.update({
    where: { id: userId },
    data: {
      gmailAccessToken: null,
      gmailRefreshToken: null,
      gmailTokenExpiry: null,
    },
  });

  // Persist an in-app notification (consistent with application_failed pattern)
  try {
    await prisma.notification.create({
      data: {
        userId,
        type: 'gmail_auth_expired',
        title: 'Gmail authorization expired',
        body: 'Your Gmail connection has expired. Please re-authorize to resume email monitoring.',
        metadata: { event: 'gmail_auth_expired' },
      },
    });
  } catch (err) {
    log.warn({ userId, err }, 'Failed to create gmail_auth_expired notification');
  }

  // Emit WebSocket event if a Fastify instance with websocketServer is available
  if (app) {
    emitGmailAuthExpiredWebSocket(app, userId);
  }
}

/**
 * Emit the `gmail_auth_expired` event to the user via WebSocket.
 * Iterates over all connected WebSocket clients on the Fastify websocket server
 * and sends to those tagged with the matching userId.
 *
 * This is a best-effort delivery; failures are logged but not thrown.
 *
 * Requirement: 16.8
 */
export function emitGmailAuthExpiredWebSocket(app: FastifyInstance, userId: string): void {
  try {
    // @fastify/websocket exposes the underlying ws.Server as app.websocketServer
    const wsServer = (app as unknown as { websocketServer?: { clients?: Set<WebSocketWithUserId> } }).websocketServer;
    if (!wsServer?.clients) {
      log.debug({ userId }, 'No WebSocket server available — skipping live gmail_auth_expired emission');
      return;
    }

    const payload = JSON.stringify({ event: 'gmail_auth_expired', userId });
    let delivered = 0;

    for (const client of wsServer.clients) {
      // Only send to sockets tagged with this userId (tagging is done at connection time)
      if (client.userId === userId && client.readyState === WebSocketReadyState.OPEN) {
        client.send(payload);
        delivered++;
      }
    }

    log.info({ userId, delivered }, 'gmail_auth_expired WebSocket event emitted');
  } catch (err) {
    log.warn({ userId, err }, 'Failed to emit gmail_auth_expired WebSocket event');
  }
}

// WebSocket client interface augmented with userId for targeted delivery
interface WebSocketWithUserId {
  userId?: string;
  readyState: number;
  send(data: string): void;
}

const WebSocketReadyState = { OPEN: 1 } as const;

// ─── Polling guard ────────────────────────────────────────────────────────────

/**
 * Wraps a Gmail API call, catching 401 / token-expired errors and converting
 * them to `GmailAuthError`. Use this in polling loops so the caller knows to
 * stop and trigger re-authorization rather than retrying indefinitely.
 *
 * @example
 * ```ts
 * const messages = await withGmailAuthGuard(userId, app, async (auth) => {
 *   const gmail = google.gmail({ version: 'v1', auth });
 *   return gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
 * });
 * ```
 *
 * Requirement: 16.8
 */
export async function withGmailAuthGuard<T>(
  userId: string,
  app: FastifyInstance | undefined,
  fn: (auth: OAuth2Client) => Promise<T>,
): Promise<T> {
  const auth = await getOAuth2Client(userId);

  try {
    return await fn(auth);
  } catch (err: unknown) {
    if (isAuthError(err)) {
      log.warn({ userId, err }, 'Gmail API returned auth error — handling expiry');
      await handleGmailAuthExpired(userId, app);
      throw new GmailAuthError('Gmail authentication expired');
    }
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect whether an error from the googleapis library indicates an
 * authentication / authorization failure (HTTP 401 or 403 token-revoked).
 */
function isAuthError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;

  const e = err as Record<string, unknown>;

  // googleapis throws GaxiosError objects with a `status` or `code` field
  const status = (e['status'] as number | undefined) ?? (e['code'] as number | undefined);
  if (status === 401) return true;

  // Some paths surface the status nested under `response`
  const response = e['response'] as Record<string, unknown> | undefined;
  if (response && (response['status'] as number | undefined) === 401) return true;

  // Token revoked error message
  const message = (e['message'] as string | undefined) ?? '';
  if (message.includes('invalid_grant') || message.includes('Token has been expired or revoked')) {
    return true;
  }

  return false;
}
