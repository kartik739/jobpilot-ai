// Feature: jobpilot-ai-remediation, Property 2: API URL has no double /api
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Simulates how axios constructs URLs: baseURL + path.
 * Mirrors the axios behaviour used in frontend/src/lib/api.ts.
 */
function buildRequestUrl(baseURL: string, path: string): string {
  const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
  return base + path
}

// ---------------------------------------------------------------------------
// Helper: count non-overlapping occurrences of a substring in a string
// ---------------------------------------------------------------------------
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

describe('buildRequestUrl – Property 2: no double /api segment', () => {
  /**
   * Property 2: API URL has no double /api segment
   * Validates: Requirements 6.1, 6.2, 6.3, 6.4
   *
   * When NEXT_PUBLIC_API_URL is correctly set to a base URL that does NOT end
   * with "/api" (the fixed configuration), concatenating any path that starts
   * with "/" should never produce a URL containing more than one "/api/"
   * sequence.
   */
  it('Property 2: for any baseURL without /api suffix and any path starting with /, the result has at most one /api/ occurrence', () => {
    // Generator for a base URL without a trailing /api segment
    const baseURLArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.startsWith('/') || s.startsWith('http'))
      .map((s) => (s.endsWith('/api') ? s.slice(0, -4) : s))
      .filter((s) => !s.endsWith('/api'))

    // Generator for API paths – must start with '/'
    const pathArb = fc
      .string({ minLength: 1 })
      .filter((s) => s.startsWith('/'))

    fc.assert(
      fc.property(baseURLArb, pathArb, (baseURL, path) => {
        const url = buildRequestUrl(baseURL, path)
        const apiCount = countOccurrences(url, '/api/')
        expect(apiCount).toBeLessThanOrEqual(1)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * Bug scenario: documents the BROKEN configuration this fix prevents.
   *
   * When NEXT_PUBLIC_API_URL mistakenly ends with "/api" AND the request path
   * also starts with "/api/...", the concatenation produces a double "/api/"
   * segment (e.g. "https://domain.com/api/api/auth/login").
   *
   * This test intentionally demonstrates the bug so it is clear what the fix
   * (removing the /api suffix from NEXT_PUBLIC_API_URL) prevents.
   */
  it('Bug scenario (broken config): baseURL ending with /api + path starting with /api produces double /api', () => {
    const brokenBaseURL = 'https://domain.com/api'
    const path = '/api/auth/login'

    const url = buildRequestUrl(brokenBaseURL, path)

    // The broken URL contains two /api segments back-to-back
    expect(url).toBe('https://domain.com/api/api/auth/login')
    // Count /api segments (not the combined /api/ pattern) to detect the double segment
    expect(countOccurrences(url, '/api')).toBeGreaterThan(1)
  })

  /**
   * Fixed config confirmation: with the corrected NEXT_PUBLIC_API_URL
   * (no /api suffix), the same path produces a clean URL.
   */
  it('Fixed config: baseURL without /api suffix + path starting with /api produces clean URL', () => {
    const fixedBaseURL = 'https://domain.com'
    const path = '/api/auth/login'

    const url = buildRequestUrl(fixedBaseURL, path)

    expect(url).toBe('https://domain.com/api/auth/login')
    expect(countOccurrences(url, '/api/')).toBeLessThanOrEqual(1)
  })
})
