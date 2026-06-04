/**
 * Screenshot capture and storage service.
 *
 * Captures a full-page screenshot via Playwright, redacts any visible password
 * fields by overlaying opaque divs before taking the snapshot, then stores the
 * result in SeaweedFS via the shared storage service.
 *
 * Requirements: 12.7
 */

import type { Page } from 'playwright';
import { uploadFile } from './storage.js';
import { logger } from '../core/logger.js';

/**
 * Capture a screenshot of `page`, redact all visible password fields, upload
 * to SeaweedFS, and return the storage key.
 *
 * Password field redaction: all `input[type="password"]` elements whose
 * bounding boxes are non-null (i.e. visible in the viewport) are covered by a
 * fixed-position opaque black div injected into the DOM before the snapshot is
 * taken.  Failures on individual elements are logged as warnings and do not
 * abort the capture.
 *
 * @param page          - Playwright `Page` to capture.
 * @param userId        - Owner of the screenshot (used in the storage key path).
 * @param applicationId - Job application ID (used in the storage key path).
 * @returns             The SeaweedFS storage key for the uploaded screenshot.
 *
 * Requirements: 12.7
 */
export async function captureAndStore(
  page: Page,
  userId: string,
  applicationId: string,
): Promise<string> {
  const key = `screenshots/${userId}/${applicationId}_${Date.now()}.png`;
  const log = logger.child({ fn: 'captureAndStore', userId, applicationId, key });

  log.info('Starting screenshot capture');

  // ── Redact password fields ─────────────────────────────────────────────────
  try {
    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();
    log.debug({ count }, 'Found password input elements');

    for (let i = 0; i < count; i++) {
      const element = passwordInputs.nth(i);
      try {
        const box = await element.boundingBox();
        if (box === null) {
          // Element exists in the DOM but is not visible — nothing to redact
          log.debug({ index: i }, 'Password input has no bounding box, skipping');
          continue;
        }

        // Overlay an opaque black div at the exact screen coordinates
        await page.evaluate(
          ({ left, top, width, height }: { left: number; top: number; width: number; height: number }) => {
            const overlay = document.createElement('div');
            overlay.setAttribute(
              'style',
              [
                'position:fixed',
                `left:${left}px`,
                `top:${top}px`,
                `width:${width}px`,
                `height:${height}px`,
                'background:#000',
                'z-index:2147483647',
              ].join(';'),
            );
            overlay.setAttribute('data-screenshot-redaction', 'true');
            document.body.appendChild(overlay);
          },
          { left: box.x, top: box.y, width: box.width, height: box.height },
        );

        log.debug({ index: i, box }, 'Password input redacted');
      } catch (elemErr) {
        // Per-element failures are non-fatal — warn and continue
        log.warn({ err: elemErr, index: i }, 'Failed to redact password input element; continuing');
      }
    }
  } catch (locatorErr) {
    // If we cannot even query the DOM for password inputs, log and continue —
    // taking the screenshot unredacted is still better than losing the record
    // entirely.  Callers that require strict redaction should treat this as
    // a warning and inspect the returned screenshot.
    log.warn({ err: locatorErr }, 'Failed to locate password inputs for redaction; proceeding without redaction');
  }

  // ── Capture screenshot ─────────────────────────────────────────────────────
  let screenshotBuffer: Buffer;
  try {
    screenshotBuffer = await page.screenshot({ fullPage: false, type: 'png' });
    log.debug({ bytes: screenshotBuffer.length }, 'Screenshot captured');
  } catch (captureErr) {
    log.error({ err: captureErr }, 'Failed to capture screenshot');
    throw captureErr;
  }

  // ── Upload to SeaweedFS ────────────────────────────────────────────────────
  try {
    await uploadFile(key, screenshotBuffer, 'image/png');
    log.info({ bytes: screenshotBuffer.length }, 'Screenshot uploaded to SeaweedFS');
  } catch (uploadErr) {
    log.error({ err: uploadErr }, 'Failed to upload screenshot to SeaweedFS');
    throw uploadErr;
  }

  return key;
}
