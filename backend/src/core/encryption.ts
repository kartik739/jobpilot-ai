import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import { logger } from './logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;       // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16; // GCM auth tag is always 16 bytes

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Load and validate the AES-256 key at module initialisation time.
 * Throws a startup error if `ENCRYPTION_KEY` is absent or not exactly 32 bytes.
 */
function loadKey(): Buffer {
  const raw = process.env['ENCRYPTION_KEY'];
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
        'Provide a 32-byte value encoded as base64.',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.byteLength !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.byteLength}).`,
    );
  }

  return key;
}

// Derive once at startup; any misconfiguration surfaces immediately.
const KEY: Buffer = loadKey();

// ─── Core crypto helpers ──────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * Layout of the returned base64 blob (all concatenated before encoding):
 *   [ IV (12 bytes) | authTag (16 bytes) | ciphertext (variable) ]
 *
 * Requirements: 24.1, 24.2
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Concatenate iv | authTag | ciphertext and base64-encode the result.
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64 blob produced by `encrypt`.
 *
 * Throws (with a safe message) if the ciphertext has been tampered with or
 * the blob is malformed — requirement 24.4.
 *
 * Requirements: 24.1, 24.3, 24.4
 */
export function decrypt(encrypted: string): string {
  try {
    const combined = Buffer.from(encrypted, 'base64');

    const iv = combined.subarray(0, IV_BYTES);
    const authTag = combined.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = combined.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    // Log the error without revealing the key (requirement 24.4).
    logger.error({ err }, 'Decryption failed');
    throw new Error('Decryption failed');
  }
}

// ─── Prisma middleware ────────────────────────────────────────────────────────

/**
 * Fields on the `Profile` model that must be encrypted at rest.
 * Requirements: 1.9, 1.10, 24.2
 */
const ENCRYPTED_FIELDS = ['phone', 'salaryMin', 'salaryMax', 'portalCredentials'] as const;
type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

/** Write operations that carry user-supplied data. */
const WRITE_ACTIONS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

/** Read operations that return model data. */
const READ_ACTIONS = new Set(['findUnique', 'findFirst', 'findMany', 'findUniqueOrThrow', 'findFirstOrThrow']);

/**
 * Type that covers the `params` object passed to Prisma middleware.
 * We cannot import `MiddlewareParams` from `@prisma/client` in all Prisma
 * versions, so we define the minimum we need.
 */
interface PrismaMiddlewareParams {
  model?: string;
  action: string;
  args: Record<string, unknown>;
}

type PrismaNext = (params: PrismaMiddlewareParams) => Promise<unknown>;

/**
 * Encrypt fields inside a Prisma `data` (or `data.create` / `data.update`)
 * object in place.
 */
function encryptFields(data: Record<string, unknown>): void {
  for (const field of ENCRYPTED_FIELDS) {
    const value = data[field as string];
    if (typeof value === 'string') {
      data[field as string] = encrypt(value);
    }
  }
}

/**
 * Decrypt fields on a returned record (or an array of records) in place.
 */
function decryptRecord(record: Record<string, unknown>): void {
  for (const field of ENCRYPTED_FIELDS) {
    const value = record[field as string];
    if (typeof value === 'string') {
      record[field as string] = decrypt(value);
    }
  }
}

function decryptResult(result: unknown): void {
  if (!result || typeof result !== 'object') return;

  if (Array.isArray(result)) {
    for (const item of result) {
      decryptRecord(item as Record<string, unknown>);
    }
  } else {
    decryptRecord(result as Record<string, unknown>);
  }
}

/**
 * Prisma middleware that transparently encrypts sensitive `Profile` fields on
 * write and decrypts them on read.
 *
 * Usage:
 * ```ts
 * import { prisma } from './db.js';
 * import { applyEncryptionMiddleware } from './core/encryption.js';
 *
 * applyEncryptionMiddleware(prisma);
 * ```
 *
 * Requirements: 1.9, 1.10, 24.1, 24.2
 */
export function applyEncryptionMiddleware(
  prisma: { $use: (fn: (params: PrismaMiddlewareParams, next: PrismaNext) => Promise<unknown>) => void },
): void {
  prisma.$use(async (params: PrismaMiddlewareParams, next: PrismaNext) => {
    if (params.model !== 'Profile') {
      return next(params);
    }

    // ── Encrypt on write ──────────────────────────────────────────────────
    if (WRITE_ACTIONS.has(params.action)) {
      const args = params.args;

      // create / update / upsert carry data in args.data
      if (args['data'] && typeof args['data'] === 'object') {
        encryptFields(args['data'] as Record<string, unknown>);

        // upsert has separate create/update sub-objects
        const dataObj = args['data'] as Record<string, unknown>;
        if (dataObj['create'] && typeof dataObj['create'] === 'object') {
          encryptFields(dataObj['create'] as Record<string, unknown>);
        }
        if (dataObj['update'] && typeof dataObj['update'] === 'object') {
          encryptFields(dataObj['update'] as Record<string, unknown>);
        }
      }
    }

    const result = await next(params);

    // ── Decrypt on read ───────────────────────────────────────────────────
    if (READ_ACTIONS.has(params.action)) {
      decryptResult(result);
    }

    // For write operations that return the created/updated record, also decrypt.
    if (WRITE_ACTIONS.has(params.action) && result && typeof result === 'object') {
      decryptResult(result);
    }

    return result;
  });
}
