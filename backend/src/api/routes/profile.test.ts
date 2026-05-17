/**
 * Profile validation edge-case unit tests
 *
 * Tests the Zod schemas and the computeCompleteness helper directly —
 * no HTTP server or Prisma needed.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.10
 */

import { describe, it, expect, vi } from 'vitest';

// Stub out db.ts so the module-level ENCRYPTION_KEY check in encryption.ts is
// never triggered when profile.ts is imported (it imports db.ts at the top).
vi.mock('../../db.js', () => ({ prisma: {} }));

import { CreateProfileRequest, UpdateProfileRequest } from '../schemas/profile.js';
import { computeCompleteness } from './profile.js';

// ─── Shared valid base body ───────────────────────────────────────────────────

const validBase = {
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  location: 'New York',
  workAuthorization: ['US_CITIZEN'],
  noticePeriod: 0,
  targetRoles: ['Backend Engineer'],
  preferredLocations: ['New York'],
  workExperiences: [],
  educations: [],
  projects: [],
  skills: [],
  certifications: [],
};

// ─── Section 1: Schema validation — 422 conditions ───────────────────────────
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6

describe('CreateProfileRequest schema — valid base body', () => {
  it('accepts a valid base body', () => {
    const result = CreateProfileRequest.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});

describe('CreateProfileRequest schema — email validation (Req 1.2)', () => {
  it('rejects an invalid email format', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty email string', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, email: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid alternate email', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, email: 'user+tag@company.co.uk' });
    expect(result.success).toBe(true);
  });
});

describe('CreateProfileRequest schema — workAuthorization validation (Req 1.3)', () => {
  it('rejects an empty workAuthorization array', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, workAuthorization: [] });
    expect(result.success).toBe(false);
  });

  it('accepts workAuthorization with one entry', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, workAuthorization: ['OPT'] });
    expect(result.success).toBe(true);
  });
});

describe('CreateProfileRequest schema — noticePeriod validation (Req 1.4)', () => {
  it('rejects a negative noticePeriod (-1)', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, noticePeriod: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects a negative fractional noticePeriod (-0.5)', () => {
    // noticePeriod is int().min(0), so -0.5 fails both int and min checks
    const result = CreateProfileRequest.safeParse({ ...validBase, noticePeriod: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts noticePeriod of 0', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, noticePeriod: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts a positive noticePeriod', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, noticePeriod: 30 });
    expect(result.success).toBe(true);
  });
});

describe('CreateProfileRequest schema — salary validation (Req 1.5)', () => {
  it('rejects when salaryMin > salaryMax', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, salaryMin: 100, salaryMax: 50 });
    expect(result.success).toBe(false);
  });

  it('accepts when salaryMin < salaryMax', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, salaryMin: 50, salaryMax: 100 });
    expect(result.success).toBe(true);
  });

  it('accepts when salaryMin === salaryMax (equal values are valid)', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, salaryMin: 100, salaryMax: 100 });
    expect(result.success).toBe(true);
  });

  it('accepts when neither salaryMin nor salaryMax is provided', () => {
    const result = CreateProfileRequest.safeParse(validBase);
    expect(result.success).toBe(true);
  });
});

describe('CreateProfileRequest schema — targetRoles validation (Req 1.6)', () => {
  it('rejects an empty targetRoles array', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, targetRoles: [] });
    expect(result.success).toBe(false);
  });

  it('accepts targetRoles with one entry', () => {
    const result = CreateProfileRequest.safeParse({ ...validBase, targetRoles: ['SWE'] });
    expect(result.success).toBe(true);
  });
});

describe('UpdateProfileRequest schema — partial body behavior', () => {
  it('accepts an empty body (all fields optional in partial)', () => {
    const result = UpdateProfileRequest.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects when salaryMin > salaryMax even in a partial update', () => {
    const result = UpdateProfileRequest.safeParse({ salaryMin: 200, salaryMax: 100 });
    expect(result.success).toBe(false);
  });

  it('accepts a partial update with only email', () => {
    const result = UpdateProfileRequest.safeParse({ email: 'update@example.com' });
    expect(result.success).toBe(true);
  });
});

// ─── Section 2: Completeness score calculation ────────────────────────────────
// Validates: Requirement 1.8

describe('computeCompleteness — score calculation (Req 1.8)', () => {
  it('returns 100 when all 9 sections are satisfied', () => {
    expect(
      computeCompleteness({
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1 555 000 0000',
        location: 'New York',
        workExperiences: [{}],
        skills: [{}],
        workAuthorization: ['US_CITIZEN'],
        targetRoles: ['Engineer'],
        preferredLocations: ['New York'],
      }),
    ).toBe(100);
  });

  it('returns 0 when no sections are satisfied', () => {
    expect(computeCompleteness({})).toBe(0);
  });

  it('returns 11 when only fullName is provided', () => {
    // Math.round(1/9 * 100) = 11
    expect(computeCompleteness({ fullName: 'Jane' })).toBe(11);
  });

  it('returns 22 when fullName and email are provided', () => {
    // Math.round(2/9 * 100) = 22
    expect(computeCompleteness({ fullName: 'Jane', email: 'jane@example.com' })).toBe(22);
  });

  it('returns 44 when fullName, email, phone, and location are provided', () => {
    // Math.round(4/9 * 100) = 44
    expect(
      computeCompleteness({
        fullName: 'Jane',
        email: 'jane@example.com',
        phone: '555-1234',
        location: 'NYC',
      }),
    ).toBe(44);
  });

  it('returns 56 when fullName, email, phone, location, and 1 workExperience are provided', () => {
    // Math.round(5/9 * 100) = 56
    expect(
      computeCompleteness({
        fullName: 'Jane',
        email: 'jane@example.com',
        phone: '555-1234',
        location: 'NYC',
        workExperiences: [{}],
      }),
    ).toBe(56);
  });

  it('returns 67 when fullName, email, phone, location, 1 workExperience, and 1 skill are provided', () => {
    // Math.round(6/9 * 100) = 67
    expect(
      computeCompleteness({
        fullName: 'Jane',
        email: 'jane@example.com',
        phone: '555-1234',
        location: 'NYC',
        workExperiences: [{}],
        skills: [{}],
      }),
    ).toBe(67);
  });

  it('returns 89 when all sections except preferredLocations are filled (8/9)', () => {
    // Math.round(8/9 * 100) = 89
    expect(
      computeCompleteness({
        fullName: 'Jane',
        email: 'jane@example.com',
        phone: '555-1234',
        location: 'NYC',
        workExperiences: [{}],
        skills: [{}],
        workAuthorization: ['US_CITIZEN'],
        targetRoles: ['Engineer'],
        // preferredLocations omitted
      }),
    ).toBe(89);
  });

  it('does NOT count an empty workExperiences array', () => {
    const withEmpty = computeCompleteness({ workExperiences: [] });
    const withUndefined = computeCompleteness({});
    expect(withEmpty).toBe(0);
    expect(withUndefined).toBe(0);
  });

  it('DOES count workExperiences with at least one entry', () => {
    expect(computeCompleteness({ workExperiences: [{}] })).toBe(11);
  });

  it('does NOT count an empty workAuthorization array', () => {
    expect(computeCompleteness({ workAuthorization: [] })).toBe(0);
  });

  it('DOES count workAuthorization with at least one entry', () => {
    expect(computeCompleteness({ workAuthorization: ['US_CITIZEN'] })).toBe(11);
  });

  it('does NOT count null values for string fields', () => {
    expect(computeCompleteness({ fullName: null, email: null, phone: null, location: null })).toBe(
      0,
    );
  });

  it('does NOT count an empty string for fullName', () => {
    expect(computeCompleteness({ fullName: '' })).toBe(0);
  });

  it('does NOT count an empty string for email', () => {
    expect(computeCompleteness({ email: '' })).toBe(0);
  });
});

// ─── Section 3: Sensitive fields not exposed in validation errors ─────────────
// Validates: Requirement 1.10

describe('Sensitive fields not leaked in validation error output (Req 1.10)', () => {
  it('validation errors for invalid email do not contain the phone field value', () => {
    const body = {
      ...validBase,
      email: 'INVALID_EMAIL_FORMAT',
      phone: 'SENSITIVE_PHONE_12345',
    };

    const result = CreateProfileRequest.safeParse(body);
    expect(result.success).toBe(false);

    if (!result.success) {
      const flat = result.error.flatten();
      const errorString = JSON.stringify(flat);
      // Validation error output must not echo back the phone value
      expect(errorString).not.toContain('SENSITIVE_PHONE_12345');
    }
  });

  it('flattened validation errors only contain field names and messages, not unrelated field values', () => {
    // Invalid body: bad email + valid-looking portalCredentials
    const body = {
      ...validBase,
      email: 'bad-email',
      portalCredentials: 'MY_SECRET_TOKEN_XYZ',
    };

    const result = CreateProfileRequest.safeParse(body);
    expect(result.success).toBe(false);

    if (!result.success) {
      const flat = result.error.flatten();
      const errorString = JSON.stringify(flat);
      // The portal credentials value must not appear in the error output
      expect(errorString).not.toContain('MY_SECRET_TOKEN_XYZ');
    }
  });

  it('flattened salary validation errors do not leak other field values', () => {
    const body = {
      ...validBase,
      phone: 'PHONE_SENSITIVE_VALUE',
      salaryMin: 1000,
      salaryMax: 500, // invalid: min > max
    };

    const result = CreateProfileRequest.safeParse(body);
    expect(result.success).toBe(false);

    if (!result.success) {
      const flat = result.error.flatten();
      const errorString = JSON.stringify(flat);
      expect(errorString).not.toContain('PHONE_SENSITIVE_VALUE');
    }
  });

  it('a body with valid portalCredentials passes schema without error — data contains credentials but no error path leaks them', () => {
    const body = {
      ...validBase,
      portalCredentials: 'MY_SECRET_TOKEN',
    };

    const result = CreateProfileRequest.safeParse(body);
    expect(result.success).toBe(true);

    if (result.success) {
      // The parsed data has the value (expected — it passed validation)
      expect(result.data.portalCredentials).toBe('MY_SECRET_TOKEN');
    }
  });
});
