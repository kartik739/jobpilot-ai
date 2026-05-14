/**
 * Storage service — wraps the SeaweedFS S3-compatible API via AWS SDK v3.
 *
 * Environment variables:
 *   SEAWEEDFS_ENDPOINT    e.g. http://localhost:8333
 *   SEAWEEDFS_ACCESS_KEY
 *   SEAWEEDFS_SECRET_KEY
 *   SEAWEEDFS_BUCKET      default: jobpilot
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed pre-signed URL lifetime in seconds (15 minutes). */
const MAX_PRESIGNED_EXPIRY_SECONDS = 900;

// ---------------------------------------------------------------------------
// Client initialisation (lazy singleton so env vars are read at call time in
// tests, while still only paying the construction cost once in production)
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;
let _bucket: string | null = null;

function getClient(): { client: S3Client; bucket: string } {
  if (_client && _bucket) {
    return { client: _client, bucket: _bucket };
  }

  const endpoint = process.env['SEAWEEDFS_ENDPOINT'];
  const accessKeyId = process.env['SEAWEEDFS_ACCESS_KEY'];
  const secretAccessKey = process.env['SEAWEEDFS_SECRET_KEY'];
  const bucket = process.env['SEAWEEDFS_BUCKET'] ?? 'jobpilot';

  if (!endpoint) {
    throw new Error('SEAWEEDFS_ENDPOINT environment variable is not set');
  }
  if (!accessKeyId) {
    throw new Error('SEAWEEDFS_ACCESS_KEY environment variable is not set');
  }
  if (!secretAccessKey) {
    throw new Error('SEAWEEDFS_SECRET_KEY environment variable is not set');
  }

  _client = new S3Client({
    endpoint,
    region: 'us-east-1', // SeaweedFS requires a region string; value is ignored
    credentials: { accessKeyId, secretAccessKey },
    // SeaweedFS uses path-style URLs (/<bucket>/<key>)
    forcePathStyle: true,
  });

  _bucket = bucket;
  return { client: _client, bucket: _bucket };
}

/** Reset the cached client — intended for use in tests only. */
export function _resetClientForTesting(): void {
  _client = null;
  _bucket = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload `data` under `key` with the given MIME type.
 * Returns the storage key on success.
 *
 * Requirements: 28.1
 */
export async function uploadFile(
  key: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const { client, bucket } = getClient();
  const log = logger.child({ fn: 'uploadFile', key, bucket });

  try {
    log.debug('Uploading file to SeaweedFS');
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      }),
    );
    log.info({ bytes: data.length }, 'File uploaded successfully');
    return key;
  } catch (err) {
    log.error({ err }, 'Failed to upload file to SeaweedFS');
    throw err;
  }
}

/**
 * Download the object stored at `key` and return its contents as a Buffer.
 *
 * Requirements: 28.1
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const { client, bucket } = getClient();
  const log = logger.child({ fn: 'downloadFile', key, bucket });

  try {
    log.debug('Downloading file from SeaweedFS');
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`Empty response body for key: ${key}`);
    }

    // `Body` is a ReadableStream (Node.js) — collect all chunks into a Buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    log.info({ bytes: buf.length }, 'File downloaded successfully');
    return buf;
  } catch (err) {
    log.error({ err }, 'Failed to download file from SeaweedFS');
    throw err;
  }
}

/**
 * Delete the object stored at `key`.
 *
 * Requirements: 28.2
 */
export async function deleteFile(key: string): Promise<void> {
  const { client, bucket } = getClient();
  const log = logger.child({ fn: 'deleteFile', key, bucket });

  try {
    log.debug('Deleting file from SeaweedFS');
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
    log.info('File deleted successfully');
  } catch (err) {
    log.error({ err }, 'Failed to delete file from SeaweedFS');
    throw err;
  }
}

/**
 * Generate a pre-signed GET URL for `key`.
 *
 * `expiresIn` is clamped to a maximum of 900 seconds (15 minutes).
 * Defaults to 900 seconds when omitted.
 *
 * Requirements: 24.5
 */
export async function generatePresignedUrl(
  key: string,
  expiresIn: number = MAX_PRESIGNED_EXPIRY_SECONDS,
): Promise<string> {
  const { client, bucket } = getClient();

  // Enforce maximum expiry
  const clampedExpiry = Math.min(expiresIn, MAX_PRESIGNED_EXPIRY_SECONDS);

  const log = logger.child({
    fn: 'generatePresignedUrl',
    key,
    bucket,
    expiresIn: clampedExpiry,
  });

  try {
    log.debug('Generating pre-signed URL');
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(client, command, { expiresIn: clampedExpiry });
    log.info('Pre-signed URL generated successfully');
    return url;
  } catch (err) {
    log.error({ err }, 'Failed to generate pre-signed URL');
    throw err;
  }
}
