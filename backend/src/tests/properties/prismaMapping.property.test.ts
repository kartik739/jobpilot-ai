// Feature: jobpilot-ai-remediation, Property 1: camelCase field maps to snake_case column

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * Property 1: camelCase field maps to snake_case column
 *
 * For each camelCase/snake_case field pair declared in schema.prisma,
 * verify the schema file contains `@map("snake_case_value")` adjacent
 * to the camelCase field name. This confirms that Prisma will translate
 * camelCase field references to their correct snake_case SQL column names
 * without requiring a live database.
 */

interface FieldPair {
  camelCase: string
  snakeCase: string
  model: string
}

// All camelCase → snake_case pairs that must have @map annotations in schema.prisma
const camelCaseFieldPairs: FieldPair[] = [
  // User
  { camelCase: 'passwordHash', snakeCase: 'password_hash', model: 'User' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'User' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'User' },
  { camelCase: 'gmailAccessToken', snakeCase: 'gmail_access_token', model: 'User' },
  { camelCase: 'gmailRefreshToken', snakeCase: 'gmail_refresh_token', model: 'User' },
  { camelCase: 'gmailTokenExpiry', snakeCase: 'gmail_token_expiry', model: 'User' },
  { camelCase: 'gmailCalendarScope', snakeCase: 'gmail_calendar_scope', model: 'User' },

  // Profile
  { camelCase: 'userId', snakeCase: 'user_id', model: 'Profile' },
  { camelCase: 'fullName', snakeCase: 'full_name', model: 'Profile' },
  { camelCase: 'linkedinUrl', snakeCase: 'linkedin_url', model: 'Profile' },
  { camelCase: 'githubUrl', snakeCase: 'github_url', model: 'Profile' },
  { camelCase: 'portfolioUrl', snakeCase: 'portfolio_url', model: 'Profile' },
  { camelCase: 'websiteUrl', snakeCase: 'website_url', model: 'Profile' },
  { camelCase: 'workAuthorization', snakeCase: 'work_authorization', model: 'Profile' },
  { camelCase: 'requiresSponsorship', snakeCase: 'requires_sponsorship', model: 'Profile' },
  { camelCase: 'noticePeriod', snakeCase: 'notice_period', model: 'Profile' },
  { camelCase: 'remotePreference', snakeCase: 'remote_preference', model: 'Profile' },
  { camelCase: 'targetRoles', snakeCase: 'target_roles', model: 'Profile' },
  { camelCase: 'preferredLocations', snakeCase: 'preferred_locations', model: 'Profile' },
  { camelCase: 'salaryMin', snakeCase: 'salary_min', model: 'Profile' },
  { camelCase: 'salaryMax', snakeCase: 'salary_max', model: 'Profile' },
  { camelCase: 'employmentTypes', snakeCase: 'employment_types', model: 'Profile' },
  { camelCase: 'excludedCompanies', snakeCase: 'excluded_companies', model: 'Profile' },
  { camelCase: 'preferredCompanies', snakeCase: 'preferred_companies', model: 'Profile' },
  { camelCase: 'targetIndustries', snakeCase: 'target_industries', model: 'Profile' },
  { camelCase: 'targetCompanySizes', snakeCase: 'target_company_sizes', model: 'Profile' },
  { camelCase: 'dailyApplyLimit', snakeCase: 'daily_apply_limit', model: 'Profile' },
  { camelCase: 'autoPauseEnabled', snakeCase: 'auto_pause_enabled', model: 'Profile' },
  { camelCase: 'coverLetterReviewMode', snakeCase: 'cover_letter_review_mode', model: 'Profile' },
  { camelCase: 'portalCredentials', snakeCase: 'portal_credentials', model: 'Profile' },
  { camelCase: 'profileCompleteness', snakeCase: 'profile_completeness', model: 'Profile' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Profile' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'Profile' },

  // WorkExperience
  { camelCase: 'profileId', snakeCase: 'profile_id', model: 'WorkExperience' },
  { camelCase: 'startDate', snakeCase: 'start_date', model: 'WorkExperience' },
  { camelCase: 'endDate', snakeCase: 'end_date', model: 'WorkExperience' },
  { camelCase: 'isCurrent', snakeCase: 'is_current', model: 'WorkExperience' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'WorkExperience' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'WorkExperience' },

  // Education
  { camelCase: 'profileId', snakeCase: 'profile_id', model: 'Education' },
  { camelCase: 'startDate', snakeCase: 'start_date', model: 'Education' },
  { camelCase: 'endDate', snakeCase: 'end_date', model: 'Education' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Education' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'Education' },

  // Project
  { camelCase: 'profileId', snakeCase: 'profile_id', model: 'Project' },
  { camelCase: 'startDate', snakeCase: 'start_date', model: 'Project' },
  { camelCase: 'endDate', snakeCase: 'end_date', model: 'Project' },
  { camelCase: 'isCurrent', snakeCase: 'is_current', model: 'Project' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Project' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'Project' },

  // Skill
  { camelCase: 'profileId', snakeCase: 'profile_id', model: 'Skill' },
  { camelCase: 'yearsOfExp', snakeCase: 'years_of_exp', model: 'Skill' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Skill' },

  // Certification
  { camelCase: 'profileId', snakeCase: 'profile_id', model: 'Certification' },
  { camelCase: 'issueDate', snakeCase: 'issue_date', model: 'Certification' },
  { camelCase: 'expiryDate', snakeCase: 'expiry_date', model: 'Certification' },
  { camelCase: 'credentialId', snakeCase: 'credential_id', model: 'Certification' },
  { camelCase: 'credentialUrl', snakeCase: 'credential_url', model: 'Certification' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Certification' },

  // ResumeVersion
  { camelCase: 'userId', snakeCase: 'user_id', model: 'ResumeVersion' },
  { camelCase: 'fileUrl', snakeCase: 'file_url', model: 'ResumeVersion' },
  { camelCase: 'fileHash', snakeCase: 'file_hash', model: 'ResumeVersion' },
  { camelCase: 'isDefault', snakeCase: 'is_default', model: 'ResumeVersion' },
  { camelCase: 'usageCount', snakeCase: 'usage_count', model: 'ResumeVersion' },
  { camelCase: 'successCount', snakeCase: 'success_count', model: 'ResumeVersion' },
  { camelCase: 'lastUsedAt', snakeCase: 'last_used_at', model: 'ResumeVersion' },
  { camelCase: 'successRate', snakeCase: 'success_rate', model: 'ResumeVersion' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'ResumeVersion' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'ResumeVersion' },

  // JobPosting
  { camelCase: 'externalId', snakeCase: 'external_id', model: 'JobPosting' },
  { camelCase: 'sourceUrl', snakeCase: 'source_url', model: 'JobPosting' },
  { camelCase: 'descriptionHtml', snakeCase: 'description_html', model: 'JobPosting' },
  { camelCase: 'requiredSkills', snakeCase: 'required_skills', model: 'JobPosting' },
  { camelCase: 'preferredSkills', snakeCase: 'preferred_skills', model: 'JobPosting' },
  { camelCase: 'yearsExperienceMin', snakeCase: 'years_experience_min', model: 'JobPosting' },
  { camelCase: 'yearsExperienceMax', snakeCase: 'years_experience_max', model: 'JobPosting' },
  { camelCase: 'isRemote', snakeCase: 'is_remote', model: 'JobPosting' },
  { camelCase: 'isHybrid', snakeCase: 'is_hybrid', model: 'JobPosting' },
  { camelCase: 'salaryMin', snakeCase: 'salary_min', model: 'JobPosting' },
  { camelCase: 'salaryMax', snakeCase: 'salary_max', model: 'JobPosting' },
  { camelCase: 'employmentType', snakeCase: 'employment_type', model: 'JobPosting' },
  { camelCase: 'visaRequirements', snakeCase: 'visa_requirements', model: 'JobPosting' },
  { camelCase: 'applicationDeadline', snakeCase: 'application_deadline', model: 'JobPosting' },
  { camelCase: 'applicationUrl', snakeCase: 'application_url', model: 'JobPosting' },
  { camelCase: 'atsType', snakeCase: 'ats_type', model: 'JobPosting' },
  { camelCase: 'discoveredAt', snakeCase: 'discovered_at', model: 'JobPosting' },
  { camelCase: 'parsedAt', snakeCase: 'parsed_at', model: 'JobPosting' },
  { camelCase: 'rawData', snakeCase: 'raw_data', model: 'JobPosting' },

  // JobMatch
  { camelCase: 'userId', snakeCase: 'user_id', model: 'JobMatch' },
  { camelCase: 'jobPostingId', snakeCase: 'job_posting_id', model: 'JobMatch' },
  { camelCase: 'skillMatch', snakeCase: 'skill_match', model: 'JobMatch' },
  { camelCase: 'experienceMatch', snakeCase: 'experience_match', model: 'JobMatch' },
  { camelCase: 'locationMatch', snakeCase: 'location_match', model: 'JobMatch' },
  { camelCase: 'salaryMatch', snakeCase: 'salary_match', model: 'JobMatch' },
  { camelCase: 'technologyMatch', snakeCase: 'technology_match', model: 'JobMatch' },
  { camelCase: 'workAuthMatch', snakeCase: 'work_auth_match', model: 'JobMatch' },
  { camelCase: 'successProbability', snakeCase: 'success_probability', model: 'JobMatch' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'JobMatch' },

  // ApplicationRecord
  { camelCase: 'userId', snakeCase: 'user_id', model: 'ApplicationRecord' },
  { camelCase: 'jobPostingId', snakeCase: 'job_posting_id', model: 'ApplicationRecord' },
  { camelCase: 'appliedAt', snakeCase: 'applied_at', model: 'ApplicationRecord' },
  { camelCase: 'resumeVersionId', snakeCase: 'resume_version_id', model: 'ApplicationRecord' },
  { camelCase: 'coverLetterPath', snakeCase: 'cover_letter_path', model: 'ApplicationRecord' },
  { camelCase: 'confirmationNumber', snakeCase: 'confirmation_number', model: 'ApplicationRecord' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'ApplicationRecord' },
  { camelCase: 'updatedAt', snakeCase: 'updated_at', model: 'ApplicationRecord' },

  // StatusTransition
  { camelCase: 'applicationRecordId', snakeCase: 'application_id', model: 'StatusTransition' },

  // AgentTask
  { camelCase: 'userId', snakeCase: 'user_id', model: 'AgentTask' },
  { camelCase: 'startedAt', snakeCase: 'started_at', model: 'AgentTask' },
  { camelCase: 'completedAt', snakeCase: 'completed_at', model: 'AgentTask' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'AgentTask' },

  // Notification
  { camelCase: 'userId', snakeCase: 'user_id', model: 'Notification' },
  { camelCase: 'isRead', snakeCase: 'is_read', model: 'Notification' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'Notification' },

  // JobSourceConfig
  { camelCase: 'userId', snakeCase: 'user_id', model: 'JobSourceConfig' },
  { camelCase: 'lastRunAt', snakeCase: 'last_run_at', model: 'JobSourceConfig' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'JobSourceConfig' },

  // LlmCache
  { camelCase: 'promptHash', snakeCase: 'prompt_hash', model: 'LlmCache' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'LlmCache' },
  { camelCase: 'expiresAt', snakeCase: 'expires_at', model: 'LlmCache' },

  // InterviewPrepSheet
  { camelCase: 'applicationId', snakeCase: 'application_id', model: 'InterviewPrepSheet' },

  // ReusableAnswer
  { camelCase: 'userId', snakeCase: 'user_id', model: 'ReusableAnswer' },
  { camelCase: 'usageCount', snakeCase: 'usage_count', model: 'ReusableAnswer' },
  { camelCase: 'lastUsedAt', snakeCase: 'last_used_at', model: 'ReusableAnswer' },
  { camelCase: 'createdAt', snakeCase: 'created_at', model: 'ReusableAnswer' },
]

// Read the schema once and share across all test runs
const schemaPath = join(__dirname, '../../../prisma/schema.prisma')
const schemaContent = readFileSync(schemaPath, 'utf-8')

/**
 * Checks that the schema contains `@map("snake_case")` co-located with the
 * camelCase field name on the same line.
 *
 * A line in schema.prisma looks like:
 *   passwordHash String @map("password_hash")
 *
 * We look for a line that:
 *   1. Contains the camelCase field name as a word start (not a substring of another word)
 *   2. Contains @map("snake_case_value") with the exact expected snake_case value
 */
function fieldHasMapAnnotation(schema: string, camelCase: string, snakeCase: string): boolean {
  const lines = schema.split('\n')
  for (const line of lines) {
    // Each field line starts with optional whitespace then the field name followed by a space/type
    const fieldPattern = new RegExp(`^\\s+${camelCase}\\s`)
    if (fieldPattern.test(line)) {
      // Check that this same line has @map("snakeCase")
      if (line.includes(`@map("${snakeCase}")`)) {
        return true
      }
    }
  }
  return false
}

describe('Prisma @map column mapping — Property 1', () => {
  it('every camelCase field has a correct @map("snake_case") annotation in schema.prisma', () => {
    // Property 1: for any sampled camelCase/snake_case pair, the schema must
    // contain @map("snake_case") on the same line as the camelCase field name.
    fc.assert(
      fc.property(
        fc.constantFrom(...camelCaseFieldPairs),
        (pair) => {
          const hasAnnotation = fieldHasMapAnnotation(schemaContent, pair.camelCase, pair.snakeCase)
          if (!hasAnnotation) {
            // Provide a helpful failure message
            throw new Error(
              `Missing or incorrect @map annotation for model ${pair.model}: ` +
              `expected field "${pair.camelCase}" to have @map("${pair.snakeCase}") ` +
              `but it was not found in schema.prisma`
            )
          }
          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('schema contains @map annotations for all field pairs (exhaustive check)', () => {
    // Complementary exhaustive unit check — verifies every pair, not just sampled ones
    const failures: string[] = []
    for (const pair of camelCaseFieldPairs) {
      if (!fieldHasMapAnnotation(schemaContent, pair.camelCase, pair.snakeCase)) {
        failures.push(
          `${pair.model}.${pair.camelCase} → @map("${pair.snakeCase}")`
        )
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `The following @map annotations are missing from schema.prisma:\n` +
        failures.map(f => `  - ${f}`).join('\n')
      )
    }
  })
})
