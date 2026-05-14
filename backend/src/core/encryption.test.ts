/**
 * Property 21: Encryption Round-Trip
 * Validates: Requirements 24.1, 24.3
 *
 * For any string s, decrypt(encrypt(s)) === s.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';

// ─── Key setup ────────────────────────────────────────────────────────────────

// Set a valid 32-byte base64 key before importing the module so that the
// key-validation check at startup succeeds in the test environment.
const TEST_KEY = Buffer.alloc(32, 0xab).toString('base64'); // 32 bytes of 0xAB

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = TEST_KEY;
});

// Dynamic import so the env var is set before the module's top-level key
// derivation runs.
let encrypt: (plaintext: string) => string;
let decrypt: (encrypted: string) => string;

beforeAll(async () => {
  const mod = await import('./encryption.js');
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
});

// ─── Unit tests — specific examples ──────────────────────────────────────────

describe('encryption — specific examples (Req 24.1, 24.3)', () => {
  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('round-trips a simple ASCII string', () => {
    expect(decrypt(encrypt('hello world'))).toBe('hello world');
  });

  it('round-trips a string with special characters', () => {
    const s = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips a unicode string', () => {
    const s = '日本語テスト 🎉 émojî ñoño';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips a long string (4 KB)', () => {
    const s = 'a'.repeat(4096);
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same input';
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });

  it('produces a base64-encoded result', () => {
    const result = encrypt('test');
    // base64 characters only
    expect(/^[A-Za-z0-9+/]+=*$/.test(result)).toBe(true);
  });

  it('throws "Decryption failed" when ciphertext is tampered', () => {
    const ciphertext = encrypt('sensitive');
    // Flip a byte in the middle of the base64 blob
    const tampered = ciphertext.slice(0, 20) + 'AAAA' + ciphertext.slice(24);
    expect(() => decrypt(tampered)).toThrow('Decryption failed');
  });
});

// ─── Property 21: Encryption Round-Trip ─────────────────────────────────────
// Validates: Requirements 24.1, 24.3

describe('Property 21: Encryption Round-Trip (Req 24.1, 24.3)', () => {
  it('decrypt(encrypt(s)) === s for arbitrary ASCII strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decrypt(encrypt(s))).toBe(s);
      }),
      { numRuns: 200 },
    );
  });

  it('decrypt(encrypt(s)) === s for arbitrary unicode strings', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        expect(decrypt(encrypt(s))).toBe(s);
      }),
      { numRuns: 200 },
    );
  });

  it('decrypt(encrypt(s)) === s for strings of varying lengths', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10_000 }),
        (s) => {
          expect(decrypt(encrypt(s))).toBe(s);
        },
      ),
      { numRuns: 50 },
    );
  });
});
