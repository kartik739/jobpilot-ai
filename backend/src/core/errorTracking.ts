import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';

/**
 * Sensitive field names that must never appear in error payloads sent to
 * GlitchTip. Matching is case-insensitive.
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'key',
  'encryption_key',
  'oauth_token',
  'access_token',
  'refresh_token',
  'authorization',
  'api_key',
  'private_key',
  'credential',
  'credentials',
]);

const SCRUBBED = '[Scrubbed]';

/**
 * Recursively traverse an object and replace the values of any field whose
 * name matches a sensitive pattern with `[Scrubbed]`.
 */
function scrubObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(scrubObject);
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      result[key] = SCRUBBED;
    } else {
      result[key] = scrubObject(value);
    }
  }

  return result;
}

/**
 * Strip sensitive fields from a Sentry event before it is transmitted to
 * GlitchTip. Called by the SDK for every error event.
 */
function beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  if (event.request) {
    if (event.request.data) {
      event.request.data = scrubObject(event.request.data) as typeof event.request.data;
    }

    if (event.request.headers) {
      event.request.headers = scrubObject(event.request.headers) as typeof event.request.headers;
    }

    if (event.request.query_string) {
      if (typeof event.request.query_string === 'string') {
        // Leave raw query strings as-is; structured scrubbing requires an object.
        // The SDK typically parses these into objects, but handle the string case safely.
      } else {
        event.request.query_string = scrubObject(
          event.request.query_string,
        ) as typeof event.request.query_string;
      }
    }
  }

  if (event.extra) {
    event.extra = scrubObject(event.extra) as typeof event.extra;
  }

  if (event.contexts) {
    event.contexts = scrubObject(event.contexts) as typeof event.contexts;
  }

  return event;
}

/**
 * Initialize GlitchTip (Sentry-compatible) error tracking.
 *
 * Reads the DSN from the `GLITCHTIP_DSN` environment variable. When the
 * variable is not set the function returns early without initializing the SDK,
 * which means error tracking is silently disabled — the application continues
 * to work normally (requirement 29.3).
 *
 * Call this **before** any other module initialization so the SDK can
 * instrument Node.js built-ins as early as possible.
 */
export function initErrorTracking(): void {
  const dsn = process.env['GLITCHTIP_DSN'];

  if (!dsn) {
    // Graceful no-op: GLITCHTIP_DSN is absent or empty — skip SDK init.
    return;
  }

  Sentry.init({
    dsn,
    beforeSend,
    // Disable performance tracing — we only need error tracking here.
    tracesSampleRate: 0,
  });
}

/**
 * Capture an exception and forward it to GlitchTip.
 *
 * This is a thin wrapper around the Sentry SDK so the rest of the codebase
 * does not import `@sentry/node` directly and error tracking can be swapped
 * or disabled without touching call sites.
 */
export function captureException(error: unknown): void {
  Sentry.captureException(error);
}
