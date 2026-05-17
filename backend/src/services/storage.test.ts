/**
 * Unit tests for src/services/storage.ts
 *
 * These tests mock the AWS SDK v3 client so no live SeaweedFS instance is
 * required.  They verify:
 *   - uploadFile returns the key and calls PutObjectCommand correctly
 *   - downloadFile reconstructs a Buffer byte-for-byte (round-trip guarantee)
 *   - deleteFile calls DeleteObjectCommand
 *   - generatePresignedUrl enforces the 900-second maximum clamp
 *   - All functions rethrow S3 errors after logging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Hoist mocks so variables are available before module evaluation
// ---------------------------------------------------------------------------
const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @aws-sdk/client-s3
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = mockSend;
  }
  class PutObjectCommand {
    constructor(public input: unknown) {}
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  class DeleteObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

// ---------------------------------------------------------------------------
// Mock @aws-sdk/s3-request-presigner
// ---------------------------------------------------------------------------
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

// ---------------------------------------------------------------------------
// Import SUT *after* mocks are registered
// ---------------------------------------------------------------------------
import {
  uploadFile,
  downloadFile,
  deleteFile,
  generatePresignedUrl,
  _resetClientForTesting,
} from './storage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an async iterable that yields the given chunks. */
async function* makeStream(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  _resetClientForTesting();

  // Provide required env vars
  process.env['SEAWEEDFS_ENDPOINT'] = 'http://localhost:8333';
  process.env['SEAWEEDFS_ACCESS_KEY'] = 'test-access-key';
  process.env['SEAWEEDFS_SECRET_KEY'] = 'test-secret-key';
  process.env['SEAWEEDFS_BUCKET'] = 'test-bucket';
});

afterEach(() => {
  delete process.env['SEAWEEDFS_ENDPOINT'];
  delete process.env['SEAWEEDFS_ACCESS_KEY'];
  delete process.env['SEAWEEDFS_SECRET_KEY'];
  delete process.env['SEAWEEDFS_BUCKET'];
});

// ---------------------------------------------------------------------------
// uploadFile
// ---------------------------------------------------------------------------

describe('uploadFile', () => {
  it('returns the storage key on success', async () => {
    mockSend.mockResolvedValue({});
    const data = Buffer.from('hello world');
    const result = await uploadFile('docs/resume.pdf', data, 'application/pdf');
    expect(result).toBe('docs/resume.pdf');
  });

  it('calls PutObjectCommand with correct parameters', async () => {
    mockSend.mockResolvedValue({});
    const data = Buffer.from([1, 2, 3]);
    await uploadFile('my-key', data, 'application/octet-stream');

    const [command] = mockSend.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'my-key',
      ContentType: 'application/octet-stream',
      ContentLength: 3,
    });
  });

  it('rethrows S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('S3 put failed'));
    await expect(
      uploadFile('key', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('S3 put failed');
  });
});

// ---------------------------------------------------------------------------
// downloadFile
// ---------------------------------------------------------------------------

describe('downloadFile', () => {
  it('reassembles streamed chunks into a Buffer', async () => {
    const part1 = new Uint8Array([10, 20]);
    const part2 = new Uint8Array([30, 40, 50]);
    mockSend.mockResolvedValue({ Body: makeStream(part1, part2) });

    const result = await downloadFile('some/file.bin');
    expect(result).toBeInstanceOf(Buffer);
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50]);
  });

  it('provides round-trip byte-for-byte identity', async () => {
    const original = Buffer.from(
      'The quick brown fox jumps over the lazy dog',
      'utf8',
    );
    // Simulate upload (mock succeeds)
    mockSend.mockResolvedValueOnce({});
    await uploadFile('rt-key', original, 'text/plain');

    // Simulate download returning the same bytes
    mockSend.mockResolvedValueOnce({
      Body: makeStream(new Uint8Array(original)),
    });
    const downloaded = await downloadFile('rt-key');
    expect(downloaded.equals(original)).toBe(true);
  });

  it('throws when Body is absent', async () => {
    mockSend.mockResolvedValue({ Body: null });
    await expect(downloadFile('missing-body')).rejects.toThrow(
      'Empty response body',
    );
  });

  it('rethrows S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('S3 get failed'));
    await expect(downloadFile('key')).rejects.toThrow('S3 get failed');
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

describe('deleteFile', () => {
  it('resolves without value on success', async () => {
    mockSend.mockResolvedValue({});
    await expect(deleteFile('old/file.txt')).resolves.toBeUndefined();
  });

  it('calls DeleteObjectCommand with correct bucket and key', async () => {
    mockSend.mockResolvedValue({});
    await deleteFile('to-delete/file.pdf');

    const [command] = mockSend.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'to-delete/file.pdf',
    });
  });

  it('rethrows S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('S3 delete failed'));
    await expect(deleteFile('key')).rejects.toThrow('S3 delete failed');
  });
});

// ---------------------------------------------------------------------------
// generatePresignedUrl
// ---------------------------------------------------------------------------

describe('generatePresignedUrl', () => {
  it('returns the URL produced by the presigner', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/signed?token=abc');
    const url = await generatePresignedUrl('docs/cv.pdf');
    expect(url).toBe('https://example.com/signed?token=abc');
  });

  it('defaults to 900-second expiry', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/signed');
    await generatePresignedUrl('key');

    const [, , options] = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBe(900);
  });

  it('clamps expiry values above 900 to 900', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/signed');
    await generatePresignedUrl('key', 3600); // 1 hour — must be clamped

    const [, , options] = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBe(900);
  });

  it('passes expiry values at or below 900 through unchanged', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/signed');
    await generatePresignedUrl('key', 300); // 5 minutes

    const [, , options] = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBe(300);
  });

  it('clamps exactly 900 through unchanged', async () => {
    mockGetSignedUrl.mockResolvedValue('https://example.com/signed');
    await generatePresignedUrl('key', 900);

    const [, , options] = mockGetSignedUrl.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(options.expiresIn).toBe(900);
  });

  it('rethrows presigner errors', async () => {
    mockGetSignedUrl.mockRejectedValue(new Error('Presigner failed'));
    await expect(generatePresignedUrl('key')).rejects.toThrow(
      'Presigner failed',
    );
  });
});

// ---------------------------------------------------------------------------
// Missing env vars
// ---------------------------------------------------------------------------

describe('missing environment variables', () => {
  beforeEach(() => {
    _resetClientForTesting();
  });

  it('throws when SEAWEEDFS_ENDPOINT is missing', async () => {
    delete process.env['SEAWEEDFS_ENDPOINT'];
    await expect(
      uploadFile('k', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('SEAWEEDFS_ENDPOINT');
  });

  it('throws when SEAWEEDFS_ACCESS_KEY is missing', async () => {
    delete process.env['SEAWEEDFS_ACCESS_KEY'];
    await expect(
      uploadFile('k', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('SEAWEEDFS_ACCESS_KEY');
  });

  it('throws when SEAWEEDFS_SECRET_KEY is missing', async () => {
    delete process.env['SEAWEEDFS_SECRET_KEY'];
    await expect(
      uploadFile('k', Buffer.from('x'), 'text/plain'),
    ).rejects.toThrow('SEAWEEDFS_SECRET_KEY');
  });

  it('falls back to "jobpilot" bucket when SEAWEEDFS_BUCKET is not set', async () => {
    delete process.env['SEAWEEDFS_BUCKET'];
    mockSend.mockResolvedValue({});
    await uploadFile('key', Buffer.from('x'), 'text/plain');

    const [command] = mockSend.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(command.input).toMatchObject({ Bucket: 'jobpilot' });
  });
});
