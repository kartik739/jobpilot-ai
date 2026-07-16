# Implementation Plan: JobPilot AI

## Overview

Full-stack AI-powered job application automation platform. Implementation is phased across 10 logical areas: infrastructure foundation, user profile, job discovery agents, ranking and matching, resume/cover letter generation, application automation, application tracking and email monitoring, analytics and interview prep, manual overrides and settings, and production hardening. Each phase builds on the previous, with testing sub-tasks placed close to the code they validate.

## Tasks

---

## Phase 1: Project Foundation & Infrastructure

- [x] 1. Create Docker Compose configuration with all services
  - Write `docker-compose.yml` defining services: `postgres` (pgvector image), `redis`, `seaweedfs`, `glitchtip`, `prometheus`, `grafana`, `nginx`, `backend`, `frontend`, `worker-discovery`, `worker-application`, `worker-email`
  - Add named volumes, health checks, and inter-service `depends_on` chains
  - Create `nginx/nginx.conf` with reverse-proxy rules routing `/api` → backend and `/` → frontend with WebSocket upgrade headers
  - Create `prometheus/prometheus.yml` scrape config targeting the backend `/metrics` endpoint
  - _Requirements: 30.1_

- [x] 2. Scaffold Fastify backend project structure
  - [x] 2.1 Initialize Node.js TypeScript project with `package.json` and pin all dependencies from the design's dependency table (fastify, @fastify/cors, @fastify/helmet, @fastify/jwt, @fastify/multipart, @fastify/websocket, @fastify/rate-limit, prisma, @prisma/client, bullmq, playwright, openai, googleapis, @xenova/transformers, puppeteer, bcryptjs, zod, pino, @sentry/node, ioredis, pg, pgvector, archiver, fast-levenshtein, vitest, fast-check)
    - Create `src/` directory with sub-directories: `api/`, `agents/`, `workers/`, `services/`, `core/`, `integrations/`
    - Set up `src/server.ts` Fastify application factory with `onReady` and `onClose` hooks
    - Configure `tsconfig.json` with strict mode, target ES2022, module NodeNext
    - _Requirements: 30.1, 30.2_
  - [x] 2.2 Configure pino for structured JSON logging
    - Write `src/core/logger.ts` that exports a pino logger with JSON transport in production, pretty-print in development
    - Bind `requestId` and `userId` to log context via Fastify's `onRequest` hook
    - _Requirements: 30.2_
  - [x] 2.3 Configure GlitchTip error tracking via @sentry/node SDK
    - Write `src/core/errorTracking.ts` initializing `@sentry/node` with DSN from `GLITCHTIP_DSN` env var
    - Add `beforeSend` hook to scrub passwords, encryption keys, and OAuth tokens from error payloads
    - _Requirements: 29.1, 29.2, 29.3_


- [x] 3. Create database schema and Prisma migrations
  - [x] 3.1 Write Prisma schema (`prisma/schema.prisma`) defining all models: `User`, `Profile`, `WorkExperience`, `Education`, `Project`, `Skill`, `Certification`, `ResumeVersion`, `JobPosting` (with `Unsupported("vector(384)")` embedding column), `JobMatch`, `ApplicationRecord`, `StatusTransition`, `AgentTask`, `Notification`, `JobSourceConfig`, `LlmCache`, `InterviewPrepSheet`, `ReusableAnswer`
    - Mark `phone`, `salaryMin`, `salaryMax`, `portalCredentials` fields as `String?` (stored encrypted)
    - Add `@@unique([userId, fingerprint])` on `ApplicationRecord`
    - Add `@@unique([fingerprint])` on `JobPosting`
    - Add raw SQL migration to enable pgvector: `CREATE EXTENSION IF NOT EXISTS vector`
    - _Requirements: 1.1, 7.4, 13.1, 18.2, 18.5, 27.1_
  - [x] 3.2 Generate and apply initial Prisma migration
    - Run `npx prisma migrate dev --name init` to produce migration SQL; verify all tables, columns, indexes, and constraints are present
    - Add manual index SQL in migration for `job_postings(fingerprint)`, `application_records(user_id, status)`, `application_records(applied_at)`, and IVFFlat index on `job_postings.embedding` using cosine ops
    - _Requirements: 27.1, 27.4_


- [x] 4. Implement JWT authentication system
  - [x] 4.1 Write `src/core/auth.ts` with: bcrypt password hashing via `bcryptjs`, JWT access token minting (1-hour expiry) via `@fastify/jwt`, refresh token generation and ioredis storage (7-day TTL), token validation Fastify hook
    - Implement `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout` route handlers
    - Add `authenticate` Fastify preHandler hook that validates JWT and decorates request with `user`; return HTTP 401 for missing/invalid tokens
    - Return HTTP 403 when an authenticated user requests another user's resources
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6_
  - [x] 4.2 Write unit tests for authentication
    - Test bcrypt hashing never stores plaintext; test JWT expiry; test refresh token Redis TTL; test role isolation (user A cannot access user B's data)
    - _Requirements: 23.1, 23.2, 23.3, 23.6_

- [x] 5. Implement AES-256-GCM encryption utilities
  - [x] 5.1 Write `src/core/encryption.ts` using Node.js built-in `crypto` module: `encrypt(plaintext: string): string` (returns base64-encoded iv+authTag+ciphertext) and `decrypt(encrypted: string): string`; key derived from `ENCRYPTION_KEY` env var (32-byte base64 string)
    - Integrate encrypt/decrypt calls in Prisma middleware for `phone`, `salaryMin`, `salaryMax`, `portalCredentials` fields
    - Log error and throw HTTP 500 (without exposing key) on decryption failure
    - _Requirements: 1.9, 1.10, 24.1, 24.2, 24.3, 24.4_
  - [x] 5.2 Write property test for encryption round-trip (Property 21)
    - **Property 21: Encryption Round-Trip**
    - **Validates: Requirements 24.1, 24.3**
    - Use fast-check to generate arbitrary strings; assert `decrypt(encrypt(p)) === p` for all inputs
    - _Requirements: 24.3_


- [x] 6. Implement SeaweedFS file storage client
  - [x] 6.1 Write `src/services/storage.ts` wrapping the SeaweedFS S3-compatible API using the AWS SDK v3 S3 client: `uploadFile(key, data, contentType): Promise<string>`, `downloadFile(key): Promise<Buffer>`, `deleteFile(key): Promise<void>`, `generatePresignedUrl(key, expiresIn=900): Promise<string>`
    - Verify round-trip: upload then download must return byte-for-byte identical bytes
    - Generate pre-signed tokens with 15-minute maximum expiry
    - _Requirements: 24.5, 28.1, 28.2_
  - [ ]* 6.2 Write property test for file storage round-trip (Property 24)
    - **Property 24: File Storage Round-Trip**
    - **Validates: Requirements 28.2**
    - Use fast-check to generate arbitrary Buffer data; assert downloaded bytes equal uploaded bytes

- [x] 7. Set up BullMQ task queue and worker infrastructure
  - Write `src/workers/queue.ts` defining BullMQ `Queue` instances for each worker type (discovery, application, email, analytics) backed by ioredis
  - Write `src/workers/base.ts` with a typed `enqueueTask(type, payload, options: { priority?, delay? })` helper
  - Write worker entry points in `src/workers/` as BullMQ `Worker` instances consuming each queue
  - Verify: an enqueued task is eventually consumed by the worker process
  - _Requirements: 28.3, 28.4_

- [x] 8. Scaffold Next.js 14 frontend project
  - Initialize Next.js 14 app router project with TypeScript; install and configure Tailwind CSS, shadcn/ui, TanStack Query v5, Zustand, Recharts, react-hook-form, zod, socket.io-client
  - Create `lib/api.ts` Axios/fetch wrapper that attaches `Authorization: Bearer` header from Zustand auth store and handles 401 token refresh
  - Create `lib/queryClient.ts` TanStack Query client with sensible `staleTime` and `gcTime` defaults
  - Set up `app/layout.tsx` with `QueryClientProvider` and `ThemeProvider`
  - _Requirements: 30.1_

- [x] 9. Phase 1 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 2: User Profile & Onboarding

- [x] 10. Implement profile CRUD API endpoints
  - [x] 10.1 Write Zod request/response schemas for `CreateProfileRequest`, `UpdateProfileRequest`, `ProfileResponse` in `src/api/schemas/profile.ts`
    - Add field-level validators: email uniqueness + valid format → 422; work_authorization non-empty → 422; notice_period >= 0 → 422; salary_min <= salary_max → 422; target_roles non-empty → 422
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [x] 10.2 Implement `GET /api/profile`, `POST /api/profile`, `PUT /api/profile` Fastify route handlers in `src/api/routes/profile.ts`
    - On read: decrypt sensitive fields before returning; log and return 500 on decryption failure without exposing key
    - On write: encrypt sensitive fields; recompute and store `profileCompleteness` score (required sections: full name, email, phone, location, ≥1 work experience, ≥1 skill, work_authorization, target_roles, preferred_locations)
    - Use Prisma ORM exclusively — no raw SQL strings
    - _Requirements: 1.8, 1.9, 1.10, 33.1, 33.2_
  - [ ]* 10.3 Write unit tests for profile validation edge cases
    - Test each 422 condition individually; test completeness score calculation with various combinations of filled/empty sections; verify sensitive fields are never returned in plaintext from logs
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

- [ ] 11. Implement resume version management API
  - [ ] 11.1 Write `POST /api/profile/resumes`, `GET /api/profile/resumes`, `PUT /api/profile/resumes/:id`, `DELETE /api/profile/resumes/:id` Fastify route handlers
    - Accept multipart file upload via `@fastify/multipart`; compute SHA-256 `fileHash`; store file in SeaweedFS; persist `ResumeVersion` record via Prisma with `specialization`, `name`, `fileUrl`, `fileHash`, `isDefault`
    - Enforce specialization enum: backend, frontend, fullstack, devops, cloud, ai_ml, mobile, data, general
    - _Requirements: 1.7, 28.1_


- [ ] 12. Build multi-step onboarding wizard frontend
  - [ ] 12.1 Create `app/(onboarding)/` route group with step pages: `personal-info`, `work-experience`, `education`, `projects`, `skills`, `resume-upload`, `preferences`, `source-config`, `review`
    - Implement step navigation with progress indicator; validate each step's required fields before advancing using zod + react-hook-form
    - Persist step state to Zustand store; call profile API on step completion
    - _Requirements: 2.1, 2.2_
  - [ ] 12.2 Add profile completeness badge to the navigation header
    - Poll `GET /api/profile` on mount; display completeness percentage as a progress ring using a shadcn `Progress` component in the main `app/layout.tsx` nav
    - _Requirements: 2.3_

- [ ] 13. Build profile management UI
  - Create `app/(dashboard)/profile/` page with tabbed sections (Personal Info, Experience, Education, Projects, Skills, Certifications, Preferences) using shadcn `Tabs`
  - Each section renders a form backed by react-hook-form + zod; mutations via TanStack Query `useMutation` calling the profile API; show inline error messages for 422 responses
  - _Requirements: 1.1, 2.1_

- [ ] 14. Build resume upload and management UI
  - Create `app/(dashboard)/profile/resumes/` page listing all `ResumeVersion` records; provide upload form (file input + specialization select + name field); allow setting default version; file download via pre-signed URL
  - _Requirements: 1.7, 24.5_

- [ ] 15. Phase 2 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 3: Job Discovery Agents

- [ ] 16. Implement Job Discovery Agent base class and plugin architecture
  - [ ] 16.1 Write `src/agents/discovery/base.ts` defining abstract `BaseJobDiscoveryConnector` class with: `abstract discover(preferences: JobPreferences): AsyncGenerator<RawJobPosting>`; `sourceName: string`; `rateLimitConfig: RateLimitConfig`
    - Write `src/agents/discovery/orchestrator.ts` that iterates enabled sources, calls `discover()`, catches and logs per-source errors without propagating them, and yields `RawJobPosting` items
    - _Requirements: 3.11_
  - [ ] 16.2 Implement Token Bucket rate limiter backed by Redis
    - Write `src/services/rateLimiter.ts` with `TokenBucketRateLimiter(platform, maxTokens, refillRate)` using ioredis atomic Lua script for token acquisition; shared state across all workers via Redis key `rate_limit:{platform}`
    - `acquire()` waits (async sleep loop) until a token is available rather than throwing immediately
    - _Requirements: 31.1, 31.2, 31.5_
  - [ ]* 16.3 Write property test for rate limit compliance (Property 25)
    - **Property 25: Platform Rate Limit Compliance**
    - **Validates: Requirements 31.1, 31.2, 31.5**
    - Use fast-check with `fc.integer` to generate burst request counts; assert concurrent workers never exceed configured max in any time window

- [ ] 17. Implement Greenhouse, Lever, and Ashby API connectors
  - Write `src/agents/discovery/connectors/greenhouse.ts`, `lever.ts`, `ashby.ts` each extending `BaseJobDiscoveryConnector`
  - Greenhouse: GET `https://api.greenhouse.io/v1/boards/{boardToken}/jobs`; Lever: GET `https://api.lever.co/v0/postings/{company}`; Ashby: GET `https://api.ashbyhq.com/posting-api/job-board/{boardId}`
  - Parse response JSON into `RawJobPosting` with at minimum: `sourceUrl`, `rawJson`, `platform`, `discoveredAt`
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 18. Implement Workday, SmartRecruiters, Wellfound, YC Jobs, RemoteOK connectors
  - Write connectors in `src/agents/discovery/connectors/`: `workday.ts` (RSS/API), `smartrecruiters.ts` (public API), `wellfound.ts` (API/RSS), `ycombinator.ts` (API/RSS), `remoteok.ts` (public JSON API)
  - Each connector applies the per-platform `TokenBucketRateLimiter`; on HTTP error or network failure log and yield nothing
  - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 19. Implement Indeed and Naukri connectors
  - Write `src/agents/discovery/connectors/indeed.ts` and `naukri.ts` using RSS feed or available API endpoints
  - Apply rate limiter; handle feed parsing errors gracefully
  - _Requirements: 3.9, 3.10_


- [ ] 20. Implement X/Twitter Playwright scraper
  - [ ] 20.1 Write `src/agents/discovery/connectors/twitterX.ts` extending `BaseJobDiscoveryConnector` using Playwright
    - Navigate to `https://x.com/search?q=<encodedQuery>&f=live` with a logged-in session (decrypt X credentials from profile); scroll results; extract and resolve all t.co short links
    - Filter resolved URLs through the ATS hostname allowlist (`greenhouse.io`, `lever.co`, `ashby.hq.com`, etc.); tag accepted postings with `source: 'twitter_x'`; discard non-matching URLs
    - Enforce max 3 searches/hour and max 50 tweets/search via `TokenBucketRateLimiter`
    - Read and respect `robots.txt` before initiating any Playwright session
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 3.12_
  - [ ]* 20.2 Write property test for social media URL allowlist enforcement (Property 3)
    - **Property 3: Social Media URL Safety (Allowlist Enforcement)**
    - **Validates: Requirements 4.3, 4.4, 5.4**
    - Use fast-check to generate arbitrary URL strings; assert only those matching allowlist hostnames pass the filter
  - [ ]* 20.3 Write property test for X/Twitter search rate limit (Property 4)
    - **Property 4: X/Twitter Search Rate Limit**
    - **Validates: Requirements 4.5**
    - Assert that for any 1-hour window, search count never exceeds 3

- [ ] 21. Implement LinkedIn Playwright scraper
  - [ ] 21.1 Write `src/agents/discovery/connectors/linkedin.ts` extending `BaseJobDiscoveryConnector`
    - Navigate to LinkedIn Jobs search using `targetRoles` keywords and `preferredLocations`; extract job card URLs, titles, companies, locations
    - Follow each job card to extract external ATS redirect URL (skip Easy Apply cards)
    - Enforce max 20 cards/session and min 10-minute session interval via `TokenBucketRateLimiter`
    - On CAPTCHA detection: pause session, capture screenshot, emit `manual_intervention_required` notification, return immediately without bypass
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [ ]* 21.2 Write property test for LinkedIn session rate limits (Property 5)
    - **Property 5: LinkedIn Session Rate Limits**
    - **Validates: Requirements 5.5, 5.6**
    - Assert job cards per session ≤ 20; assert time between consecutive sessions ≥ 10 minutes


- [ ] 22. Implement job description parser
  - [ ] 22.1 Write `src/agents/discovery/parser.ts` with `parseJobDescription(raw: RawJobPosting): Promise<ParsedJobPosting | null>`
    - Use LLM with `response_format: { type: 'json_object' }` to extract all 16 structured fields; store null for missing fields; store full `rawJson`/`rawHtml` alongside parsed fields
    - If fewer than 3 fields extractable: mark `status='parse_failed'` and return null
    - On LLM failure: fall back to regex-based extraction for key fields (remote flag, years of experience); log degradation
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 26.3_
  - [ ] 22.2 Implement @xenova/transformers embedding pipeline
    - Write `src/services/embeddings.ts` loading `Xenova/all-MiniLM-L6-v2` model once at module load; expose `generateEmbedding(text: string): Promise<number[]>` returning exactly 384 dimensions
    - Call from parser after successful parse; on failure set `status='embedding_pending'` and continue
    - _Requirements: 6.4, 6.6, 27.2, 27.3_
  - [ ]* 22.3 Write property test for embedding dimensionality (Property 23)
    - **Property 23: Embedding Dimensionality**
    - **Validates: Requirements 27.3**
    - Use fast-check to generate arbitrary non-empty strings; assert `(await generateEmbedding(text)).length === 384` for all inputs

- [ ] 23. Implement job deduplication engine
  - [ ] 23.1 Write `src/agents/discovery/dedup.ts` with `computeFingerprint(title, company, url): string`: `createHash('sha256').update(lowercase(title+'|'+company+'|'+url)).digest('hex')`
    - Write `deduplicatePostings(jobs: ParsedJobPosting[]): ParsedJobPosting[]` filtering to unique fingerprints; apply before DB insert; rely on DB unique constraint as second-level guard for race conditions
    - _Requirements: 7.1, 7.2, 7.4_
  - [ ]* 23.2 Write property test for deduplication idempotency (Property 6)
    - **Property 6: Job Deduplication Idempotency**
    - **Validates: Requirements 7.3**
    - Use fast-check with `fc.array(fc.record(...))`; assert `dedup(dedup(jobs)).length === dedup(jobs).length` for all inputs

- [ ] 24. Implement job discovery BullMQ worker and job source health tracking
  - Write `src/workers/discoveryWorker.ts` as a BullMQ Worker processing `discover_jobs` jobs: loads enabled sources, runs orchestrator, parses and deduplicates, stores results, updates `jobSourceConfig.lastRunAt/status/jobsFound/errorMessage`
  - On HTTP 429 from any source: set status `rate_limited`, record backoff window (default 60-minute backoff if window unknown), cease requests for that source
  - _Requirements: 22.1, 22.2, 22.3_

- [ ] 25. Phase 3 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 4: Job Ranking & Matching

- [ ] 26. Implement pgvector semantic search integration
  - Write `src/services/vectorSearch.ts` with `getTopCandidates(profileEmbedding: number[], limit = 200): Promise<JobPosting[]>`
  - Execute parameterized raw SQL via Prisma's `$queryRaw`: `SELECT ... ORDER BY embedding <=> $1 LIMIT $2` using cosine distance operator — never interpolate values into SQL strings directly
  - _Requirements: 8.8, 27.1, 27.4, 33.2_

- [ ] 27. Implement match score computation
  - [ ] 27.1 Write `src/agents/ranking/scorer.ts` with `computeMatchScore(job: ParsedJobPosting, profile: UserProfile): MatchScore`
    - Implement all 6 weighted components: skill_match×0.35, experience_match×0.20, location_match×0.15, salary_match×0.10, tech_match×0.10, llm_holistic×0.10
    - Apply 1.2× preferred company boost before clamping; clamp overall to [0, 100]
    - Hard disqualifiers: work_auth incompatible → overall=0 + disqualifiers=['work_authorization_incompatible']; required skill coverage < 50% → overall=0 + disqualifiers=['insufficient_required_skills']
    - On LLM unavailability: use default holistic score of 50 and continue
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [ ]* 27.2 Write property test for match score boundedness (Property 7)
    - **Property 7: Match Score Boundedness**
    - **Validates: Requirements 8.2**
    - Use fast-check to generate arbitrary job and profile combinations; assert `overall >= 0 && overall <= 100` and all component scores in `[0, 100]`
  - [ ]* 27.3 Write property test for hard disqualifier zero score (Property 8)
    - **Property 8: Hard Disqualifier Zero Score**
    - **Validates: Requirements 8.4, 8.5, 8.6**
    - Generate jobs with incompatible work auth or <50% skill coverage; assert `overall === 0` and disqualifiers non-empty
  - [ ]* 27.4 Write property test for preferred company score boost (Property 9)
    - **Property 9: Preferred Company Score Boost**
    - **Validates: Requirements 8.3**
    - For same job/profile pair, assert `scoreWithBoost === Math.min(preBoost * 1.2, 100)` > score without boost


- [ ] 28. Implement job ranking BullMQ worker
  - Write `src/workers/rankingWorker.ts` as a BullMQ Worker processing `rank_jobs` jobs:
    - Retrieve top 200 candidates via pgvector cosine similarity; apply LLM holistic re-ranking; compute full match scores; filter hard disqualifiers; filter already-applied jobs; sort descending by overall score; persist `jobMatch` records via Prisma
    - Exclude already-applied `(userId, fingerprint)` pairs from results
    - _Requirements: 8.8, 13.3_

- [ ] 29. Build job dashboard UI
  - [ ] 29.1 Create `app/(dashboard)/jobs/` page with a ranked job list
    - Fetch from `GET /api/jobs` (paginated, sorted by match score); render each job as a card with: title, company, location, match score badge (color-coded), skill overlap chips, apply button
    - _Requirements: 8.1, 8.2_
  - [ ] 29.2 Add job detail drawer/modal showing full match score breakdown
    - Display all 6 score components as individual progress bars; show disqualifier badges if present; show preferred company boost indicator
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

- [ ] 30. Phase 4 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 5: Resume Optimizer & Cover Letter Agents

- [ ] 31. Implement Resume Optimizer Agent
  - [ ] 31.1 Write `src/agents/resumeOptimizer.ts` with `optimizeResume(baseResume, jobDescription): Promise<TailoredResume>`
    - Implement the pseudocode algorithm: score and reorder experiences by relevance; score and reorder projects by relevance; filter skills to emphasized (intersection with required+preferred) then remaining; generate tailored summary via LLM with explicit "use only facts from original summary" constraint
    - On LLM failure for summary: use original summary unchanged
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.11, 9.12_
  - [ ] 31.2 Implement truthfulness validation
    - Write `validate_truthfulness(original: ResumeVersion, optimized: TailoredResume) -> TruthfulnessReport`
    - Check: experiences set unchanged (count and content); projects set unchanged (count and content); skills set is a subset of original; no new certifications or education added; return `has_fabrications=True` with `violations` list if any check fails
    - On `has_fabrications=True`: discard optimized version and return base_resume
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_
  - [ ]* 31.3 Write property test for resume optimization fact preservation (Property 10)
    - **Property 10: Resume Optimization Fact Preservation**
    - **Validates: Requirements 9.4, 9.5, 9.6, 9.7**
    - Use fast-check with `fc.record(...)` for resume and job shapes; assert no new work experiences, projects, certs, skills, or education entries appear in the optimized output
  - [ ]* 31.4 Write property test for resume count invariant (Property 11)
    - **Property 11: Resume Count Invariant**
    - **Validates: Requirements 9.5, 9.6**
    - Assert `optimized.experiences.length === base.experiences.length` and `optimized.projects.length === base.projects.length` for all inputs
  - [ ]* 31.5 Write property test for truthfulness validation fallback (Property 12)
    - **Property 12: Truthfulness Validation Fallback**
    - **Validates: Requirements 9.8, 9.9**
    - Inject artificial fabrications into an optimized resume; assert `validateTruthfulness` returns `hasFabrications: true` and optimizer returns original base resume


- [ ] 32. Implement puppeteer PDF export and SeaweedFS storage
  - Write `src/services/pdfExport.ts` with `exportResumeToPdf(resume: TailoredResume): Promise<Buffer>` using puppeteer to render an HTML resume template to PDF
  - On PDF generation failure: fall back to downloading the original base resume file already in SeaweedFS; log the failure
  - Store exported PDF in SeaweedFS under `resumes/{userId}/tailored_{jobId}.pdf`; return storage key
  - _Requirements: 9.10, 9.13_

- [ ] 33. Implement Cover Letter Agent
  - [ ] 33.1 Write `src/agents/coverLetter.ts` with `generateCoverLetter(profile, job): Promise<CoverLetter>`
    - LLM prompt must reference specific company name, job title, and key requirements; constrained to facts in user profile only
    - Store generated cover letter linked to application record in SeaweedFS under `letters/{userId}/{applicationId}.txt`
    - _Requirements: 10.1, 10.2, 10.7_
  - [ ] 33.2 Implement cover letter review mode flow
    - When `coverLetterMode === 'review_first'`: emit `cover_letter_pending_review` WebSocket event; wait up to 24 hours for user response via a `cover_letter_approvals:{applicationId}` Redis key; on timeout proceed with original generated version; if user edited: use edited version without regenerating
    - When mode is `'auto'`: submit immediately without user approval
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

- [ ] 34. Implement Screening Question Answer engine and reusable answer library
  - [ ] 34.1 Write `src/agents/screeningAnswers.ts` with `generateScreeningAnswers(questions, profile, job): Promise<ScreeningAnswer[]>`
    - Generate answers from profile data only; leave blank and flag for manual completion when question cannot be answered from profile
    - Check `reusableAnswers` Prisma table first for matching question type before generating new answer
    - Store approved answers back to `reusableAnswers` table keyed by `questionType`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 35. Build resume and cover letter management UI
  - Create `app/(dashboard)/applications/{id}/materials/` page showing: tailored resume preview with download link via pre-signed URL, cover letter text with edit form (for review_first mode), approve/edit/reject actions that resolve the 24-hour wait
  - _Requirements: 10.3, 10.6, 24.5_

- [ ] 36. Phase 5 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 6: Application Automation

- [ ] 37. Implement Playwright browser pool management
  - Write `src/services/browserPool.ts` with `BrowserPool` class managing 3–5 Playwright browser instances; `acquireSession(): Promise<BrowserContext>` (queues callers until a context is available); `releaseSession(context: BrowserContext): void` always callable; each context isolated with no shared cookies/storage
  - Wrap session acquisition in a `withBrowser<T>(pool, fn)` async helper that guarantees `releaseSession` is called in a `finally` block regardless of outcome
  - _Requirements: 12.11_

- [ ] 38. Implement Application Automation Agent core
  - [ ] 38.1 Write `src/agents/applicationAgent.ts` with `submitApplication(task: ApplicationTask): Promise<ApplicationResult>`
    - Implement the full pseudocode algorithm: check `already_applied` guard; acquire browser session; navigate to application URL; handle portal login with decrypted credentials; detect and fill form fields using profile data and screening answers; upload resume PDF and cover letter PDF; check for CAPTCHA before submit; click submit; wait for confirmation; capture screenshot on every outcome
    - On CAPTCHA detection: capture screenshot, return `success=False, requires_manual_intervention=True, failure_reason='captcha_detected'`
    - On MFA detection: same pattern as CAPTCHA
    - Release browser session in `finally` block unconditionally
    - Emit real-time WebSocket events at each lifecycle moment: job_discovered, resume_optimized, cover_letter_generated, application_submitted/failed
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.11, 12.12_
  - [ ] 38.2 Implement portal credential retrieval and login automation
    - Decrypt portal credentials via `src/core/encryption.ts`; navigate login page; fill username/password fields; detect post-login redirect vs. MFA prompt
    - On missing credentials: return `{ success: false, requiresManualIntervention: true, failureReason: 'portal_credentials_missing' }`
    - On decryption failure: return `{ requiresManualIntervention: true }` without proceeding
    - _Requirements: 12.2, 12.3, 12.4_
  - [ ]* 38.3 Write property test for CAPTCHA/MFA non-bypass (Property 13)
    - **Property 13: CAPTCHA and MFA Non-Bypass**
    - **Validates: Requirements 12.5, 12.6, 31.4**
    - Mock Playwright pages that simulate CAPTCHA/MFA detection; assert all outcomes have `success: false` and `requiresManualIntervention: true`
  - [ ]* 38.4 Write property test for browser session release guarantee (Property 15)
    - **Property 15: Browser Session Release Guarantee**
    - **Validates: Requirements 12.11**
    - Inject errors at random points in `submitApplication`; assert browser pool size is always restored after each call regardless of error type


- [ ] 39. Implement application retry logic and duplicate guard
  - [ ] 39.1 Write retry logic in the BullMQ application worker: configure `attempts: 3` and `backoff: { type: 'exponential', delay: 1000 }` on the BullMQ job options (delays: 1s, 2s, 4s); after 3 failures record `status: 'failed_submission'` and notify user with link to original job posting
    - Non-retryable errors (CAPTCHA, MFA, unexpected DOM): record `failed_submission` immediately without queuing retries
    - _Requirements: 12.8, 12.9, 12.10_
  - [ ] 39.2 Implement duplicate application guard
    - In worker: check `(userId, fingerprint)` uniqueness via Prisma before dequeuing; catch Prisma unique constraint error on insert; log dedup event; do not count skipped duplicate against daily limit
    - _Requirements: 13.1, 13.2_
  - [ ]* 39.3 Write property test for no duplicate applications (Property 16)
    - **Property 16: No Duplicate Applications**
    - **Validates: Requirements 13.1, 13.2**
    - Simulate concurrent `submitApplication` calls for the same `(userId, fingerprint)` pair; assert `COUNT(applicationRecords WHERE userId=X AND fingerprint=Y) <= 1` at all times

- [ ] 40. Implement daily apply limit enforcement
  - Write `src/services/applyLimiter.ts`: check count of today's applications for user against `dailyApplyLimit`; on reaching limit emit `daily_limit_reached` notification and stop queuing for that calendar day (resets at midnight UTC); validate limit is 1–50 (default 10)
  - Pause/resume controls: `POST /api/agent/pause` and `POST /api/agent/resume`; while paused the BullMQ worker checks a `automation_paused:{userId}` Redis key before processing; queued jobs are held in BullMQ queue, not discarded
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [ ] 41. Implement screenshot capture and SeaweedFS storage
  - Write `src/services/screenshot.ts` with `captureAndStore(page, userId, applicationId): Promise<string>` (returns SeaweedFS key)
  - Blur visible password fields in screenshot before storing (scan for `input[type="password"]` bounding boxes via `page.locator`; draw opaque rect over them using `page.evaluate`)
  - _Requirements: 12.7_

- [ ] 42. Implement application automation BullMQ worker
  - Write `src/workers/applicationWorker.ts` as a BullMQ Worker processing `submit_application` jobs:
    - Load optimized resume and cover letter; check daily limit and pause flag; run `ApplicationAgent.submitApplication()`; record `ApplicationRecord` via Prisma; emit WebSocket events; BullMQ handles retry re-queuing via job options
    - _Requirements: 12.1, 14.1–14.7_

- [ ] 43. Phase 6 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 7: Application Tracker & Email Monitor

- [ ] 44. Implement application tracker API
  - [ ] 44.1 Write `GET /api/applications`, `GET /api/applications/:id`, `POST /api/applications`, `PATCH /api/applications/:id/status` Fastify route handlers
    - On status update: insert immutable `StatusTransition` record via Prisma transaction (from, to, triggeredBy, timestamp, note); enforce forward-only transitions — reject any transition that reverts from phone_screen/technical_interview/final_round/offer_received/offer_accepted/offer_declined to an earlier status
    - `matchScoreSnapshot`: written once on record creation via Prisma; no update path exposed
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_
  - [ ]* 44.2 Write property test for application status transition audit trail (Property 19)
    - **Property 19: Application Status Transition Audit Trail**
    - **Validates: Requirements 18.3, 18.4**
    - Use fast-check to generate sequences of status transitions; assert each status change creates a `StatusTransition` record and `matchScoreSnapshot` is never mutated after creation

- [ ] 45. Build application tracker UI
  - [ ] 45.1 Create `app/(dashboard)/applications/` Kanban-style status board
    - Columns per `ApplicationStatus`; drag-and-drop cards to trigger `PATCH /api/applications/{id}/status`; show match score badge, company, role, applied date on each card
    - _Requirements: 18.1, 18.5_
  - [ ] 45.2 Create application detail page with timeline view
    - At `app/(dashboard)/applications/{id}/`: display full `StatusTransition` history as a vertical timeline; show match score snapshot breakdown; show screenshot thumbnails linking to pre-signed SeaweedFS URLs; show notes field with edit capability
    - _Requirements: 18.2, 18.3, 18.4, 24.5_


- [ ] 46. Implement Gmail OAuth integration
  - Write `src/integrations/gmail.ts` with OAuth 2.0 flow using `googleapis` requesting `gmail.readonly` and `gmail.modify` scopes; store tokens encrypted in DB via Prisma; implement token refresh; on 401 stop polling and emit `gmail_auth_expired` WebSocket event; resume after re-authorization
  - Add `GET /api/auth/gmail/authorize`, `GET /api/auth/gmail/callback` Fastify route handlers
  - Conditionally request `calendar` scope if user has Google Calendar integration enabled
  - _Requirements: 16.1, 16.8, 17.1_

- [ ] 47. Implement Email Monitor Agent
  - [ ] 47.1 Write `src/agents/emailMonitor.ts` with `processEmail(email: GmailMessage): Promise<EmailClassification>`
    - Poll Gmail every 15 minutes for unread recruitment emails; classify each with LLM into: interview_invite, rejection, offer, assessment, followup, other
    - On LLM unavailability: return `{ type: 'other', confidence: 0 }`; do not update application status
    - Skip status update for confidence < 0.7; mark email as processed to prevent reprocessing
    - Match email to `ApplicationRecord` using company name fuzzy matching via `fast-levenshtein` (similarity ≥ 0.8); log unmatched emails without throwing
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
  - [ ]* 47.2 Write property test for email classification safe fallback (Property 18)
    - **Property 18: Email Classification Safe Fallback**
    - **Validates: Requirements 16.4**
    - Mock LLM as unavailable; process arbitrary emails; assert all classifications have `type: 'other'` and `confidence: 0`, and no application status updates occur

- [ ] 48. Implement Google Calendar event creation
  - Write `src/integrations/googleCalendar.ts` with `createInterviewEvent(interview: InterviewDetails): Promise<string>`
  - Extract date, time, duration from email (default 60-minute duration if not extractable); create event via `googleapis`; link calendar event ID to `ApplicationRecord` via Prisma
  - On Calendar API error: log error, store interview details in DB, notify user to create event manually
  - When Calendar integration disabled: store interview details in DB without creating event
  - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 49. Implement email monitor BullMQ worker
  - Write `src/workers/emailWorker.ts` as a BullMQ Worker processing `monitor_emails` jobs scheduled via BullMQ's `repeat: { every: 15 * 60 * 1000 }` option
  - On `gmail_auth_expired`: pause further job repetitions; resume after token refresh confirmed via Redis flag
  - _Requirements: 16.2, 16.8_

- [ ] 50. Phase 7 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 8: Analytics, Interview Prep & Notifications

- [ ] 51. Implement Analytics Agent
  - [ ] 51.1 Write `src/agents/analytics.ts` with methods:
    - `getApplicationSummary(userId, period)`: total applications, interview rate, rejection rate, offer rate, pending count; default period last 30 days, max 365 days — all queries via Prisma `groupBy` and `count`
    - `getSourcePerformance(userId)`: counts grouped by source platform
    - `getStackPerformance(userId)`: counts grouped by tech stack
    - `getAtsSuccessRate(userId)`: proportion of ATS applications past submission
    - `getKeywordEffectiveness(userId)`: keywords correlated with higher response rates
    - `getResumeVersionPerformance(userId)`: interview rate per `ResumeVersion`
    - `getWeeklyTrend(userId)`: last 12 weeks application counts
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.8_
  - [ ] 51.2 Increment resume version success count on status advancement
    - Write a Prisma middleware that intercepts `applicationRecord.update` operations; when status transitions to phone_screen, technical_interview, final_round, offer_received, or offer_accepted: call `prisma.resumeVersion.update({ where: { id }, data: { successCount: { increment: 1 } } })`
    - _Requirements: 20.7_

- [ ] 52. Build analytics dashboard UI
  - Create `app/(dashboard)/analytics/` page with: date range picker (default 30 days, max 365); summary KPI cards (total apps, interview rate, offer rate, pending); applications by source bar chart (Recharts); applications by tech stack bar chart; keyword effectiveness table; resume version performance table; weekly trend line chart (last 12 weeks)
  - All charts fetch from `GET /api/analytics/summary`, `GET /api/analytics/sources`, etc. via TanStack Query with stale-while-revalidate
  - _Requirements: 20.1, 20.2, 20.3, 20.5, 20.6, 20.8_


- [ ] 53. Implement Interview Prep Agent
  - [ ] 53.1 Write `src/agents/interviewPrep.ts` with `generatePrepSheet(application, job, profile): Promise<InterviewPrepSheet>`
    - Generate 5–10 questions using LLM grounded in job description and profile; ensure at least 2 behavioral and at least 2 technical questions
    - Suggest behavioral answers using only actual profile facts
    - Store prep sheet in `interviewPrepSheets` Prisma table linked to `applicationId`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [ ]* 53.2 Write property test for interview prep question count (Property 20)
    - **Property 20: Interview Prep Question Count**
    - **Validates: Requirements 19.1**
    - Use fast-check to generate arbitrary applications; assert `prepSheet.questions.length >= 5 && prepSheet.questions.length <= 10` and at least 2 behavioral + 2 technical

- [ ] 54. Build interview prep UI
  - Create `app/(dashboard)/applications/{id}/interview-prep/` page displaying generated questions with expandable answer suggestions; allow user to add custom questions and notes
  - _Requirements: 19.1, 19.3_

- [ ] 55. Implement Notification Manager
  - [ ] 55.1 Write `src/services/notificationManager.ts` with `createNotification(userId, event: NotificationEvent): Promise<void>` persisting to `notifications` Prisma table and delivering real-time via WebSocket within ≤5s
    - Support event types: application_submitted, interview_detected, offer_received, manual_intervention_required, source_error, daily_limit_reached
    - _Requirements: 21.1, 21.2_
  - [ ] 55.2 Implement WebSocket server
    - Add `@fastify/websocket` plugin; authenticate connections via JWT in query param; use ioredis `subscribe` on channel `notifications:{userId}` per connection for real-time delivery
    - Frontend polls `GET /api/notifications` every 30 seconds as fallback for missed WebSocket events
    - Auto-reconnect on connection loss without page reload
    - _Requirements: 21.2, 21.3, 32.1, 32.3, 32.4_

- [ ] 56. Build notification center UI
  - Add notification bell icon with unread count badge in navigation header; clicking opens a dropdown list of unread notifications
  - Implement `PATCH /api/notifications/{id}/read` and `POST /api/notifications/mark-all-read` (atomic transaction) endpoints
  - _Requirements: 21.3, 21.4, 21.5, 21.6_

- [ ] 57. Build job source health dashboard UI
  - Create `app/(dashboard)/sources/` page showing each configured source with: platform name, last run timestamp, jobs found in last run, current status (active, rate_limited, error, never_run); display error messages for failed sources; provide "run now" button calling `POST /api/sources/{id}/run-now`; disable button while source is running
  - _Requirements: 22.1, 22.2, 22.3, 22.4_

- [ ] 58. Phase 8 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 9: Manual Override, Daily Limits & Settings

- [ ] 59. Implement manual job URL override flow
  - [ ] 59.1 Write `POST /api/jobs/manual` endpoint:
    - Validate URL format (return HTTP 400 if invalid); check fingerprint against existing records (return existing match score if duplicate); parse job description via standard pipeline; compute and return match score to frontend
    - On parsing failure: return 422 with reason description
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.6, 15.7_
  - [ ] 59.2 Write `POST /api/jobs/manual/{id}/confirm` endpoint:
    - Validate user confirmation; enqueue job for application via BullMQ `applicationQueue`; return task ID
    - _Requirements: 15.5_
  - [ ] 59.3 Build manual URL submission UI
    - Create `app/(dashboard)/jobs/manual/` page with URL paste form; show parsed job preview and match score breakdown after submission; show confirm/cancel buttons before queuing
    - _Requirements: 15.1, 15.4, 15.5_

- [ ] 60. Implement LLM provider configuration
  - Write `src/core/llmProvider.ts` with `getLLMClient(): OpenAI` reading `LLM_PROVIDER` env var to select from: `ollama` (baseURL `http://localhost:11434/v1`), `gemini`, `groq`, `openrouter`; accept any OpenAI-compatible baseURL + apiKey via env vars
  - Add `GET /api/settings/llm-provider` and `PUT /api/settings/llm-provider` Fastify route handlers for runtime provider switching without server restart
  - _Requirements: 26.1, 26.2, 26.3, 26.4_

- [ ] 61. Build settings page UI
  - Create `app/(dashboard)/settings/` page with sections:
    - Automation: daily apply limit slider (1–50), pause/resume toggle, cover letter mode radio (auto/review_first)
    - LLM Provider: dropdown to select provider + API key input + model name input (all stored as env/user config)
    - Job Sources: enable/disable toggles per platform with platform-specific config fields (API keys, search queries)
    - Account: data export button, account deletion button with confirmation
  - _Requirements: 14.1, 14.3, 14.4, 26.1, 26.2_

- [ ] 62. Phase 9 Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Phase 10: Security, Compliance & Production Hardening

- [ ] 63. Implement security headers and CORS middleware
  - [ ] 63.1 Register `@fastify/helmet` plugin in `src/server.ts` to add to every response: `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'` (tuned for Next.js assets)
    - Register `@fastify/cors` plugin allowing only the `FRONTEND_ORIGIN` env var value
    - _Requirements: 33.3, 33.4_
  - [ ]* 63.2 Write property test for security headers presence (Property 27)
    - **Property 27: Security Headers Presence**
    - **Validates: Requirements 33.4**
    - Use fast-check to generate arbitrary request paths; assert all four security headers are present in every response from the Fastify test instance

- [ ] 64. Implement per-IP and per-user API rate limiting
  - Register `@fastify/rate-limit` plugin with ioredis store; apply per-IP limit on all public endpoints; apply per-user limit on all authenticated endpoints
  - Return HTTP 429 with `Retry-After` header on limit exceeded
  - _Requirements: 33.5_

- [ ] 65. Implement data export endpoint
  - [ ] 65.1 Write `GET /api/user/export` Fastify route handler that assembles a ZIP file using `archiver` containing:
    - `applications.csv` with all `ApplicationRecord` rows for the requesting user (via Prisma)
    - All resume files from SeaweedFS as their original filenames
    - All cover letter text files
    - All screenshot image files
    - `profile.json` with full profile data
    - Stream ZIP response with `Content-Disposition: attachment; filename="jobpilot-export.zip"`
    - _Requirements: 25.1, 25.2_
  - [ ]* 65.2 Write property test for data export completeness (Property 22)
    - **Property 22: Data Export Completeness**
    - **Validates: Requirements 25.2**
    - Create a user with known number of applications, resumes, cover letters, screenshots; call export endpoint; assert ZIP contains all expected files

- [ ] 66. Implement account deletion with full data purge
  - Write `DELETE /api/user/account` Fastify route handler: delete all `ApplicationRecord`, `StatusTransition`, `ResumeVersion`, `Notification`, `AgentTask`, `JobMatch`, `Profile`, and `User` rows in a single Prisma transaction; delete all SeaweedFS files for the user (resumes, cover letters, screenshots); revoke ioredis tokens
  - _Requirements: 25.3_


- [ ] 67. Implement profile completeness automation gate
  - [ ] 67.1 Write `src/services/completeness.ts` with `computeCompleteness(profile: Profile, hasWorkExperience: boolean, hasSkills: boolean): number` returning value in [0, 100]
    - Required sections: personal info (full name, email, phone, location), ≥1 work experience, ≥1 skill, work_authorization, job preferences (target_roles, preferred_locations)
    - Add gate check in `POST /api/agent/start`: return HTTP 422 with message if completeness < 70
    - _Requirements: 1.8, 2.4, 2.5_
  - [ ]* 67.2 Write property test for profile completeness score boundedness (Property 1)
    - **Property 1: Profile Completeness Score Boundedness**
    - **Validates: Requirements 1.8**
    - Use fast-check to generate arbitrary profile field combinations; assert `computeCompleteness(profile) >= 0 && computeCompleteness(profile) <= 100`
  - [ ]* 67.3 Write property test for completeness automation gate (Property 2)
    - **Property 2: Profile Completeness Automation Gate**
    - **Validates: Requirements 2.4, 2.5**
    - Generate profiles with scores above and below 70; assert start automation accepts ≥70 and rejects <70 with HTTP 422

- [ ] 68. Implement Prometheus metrics instrumentation
  - Write `src/core/metrics.ts` defining `prom-client` counters/histograms for: `jobpilot_jobs_discovered_total` (by platform), `jobpilot_applications_submitted_total` (by status), `jobpilot_llm_call_duration_seconds` (by operation), `jobpilot_task_queue_depth` (by task type)
  - Expose `GET /metrics` Fastify endpoint returning Prometheus text format via `prom-client` default registry
  - _Requirements: 30.3_

- [ ] 69. Create Grafana dashboard configuration
  - Write `grafana/provisioning/dashboards/jobpilot.json` dashboard JSON with panels for: jobs discovered per hour by platform, applications submitted per day, LLM latency p50/p95, task queue depth over time, error rate by endpoint
  - Mount as provisioned dashboard in Docker Compose so it loads automatically
  - _Requirements: 30.4_

- [ ] 70. Write end-to-end integration tests
  - [ ] 70.1 Write `tests/integration/discoveryToApplication.test.ts` (Vitest): spin up Docker Compose test stack (real PostgreSQL, Redis, SeaweedFS; stubbed LLM; mock ATS HTTP server); execute full flow: enqueue discovery → rank → optimize resume → generate cover letter → submit application → assert `ApplicationRecord` created with status `submitted`
    - _Requirements: 7.4, 13.1, 28.4_
  - [ ] 70.2 Write `tests/integration/concurrentDedup.test.ts` (Vitest): fire 10 concurrent application submissions for the same `(userId, fingerprint)` pair; assert exactly one `ApplicationRecord` created
    - _Requirements: 13.1, 13.2_
  - [ ] 70.3 Write `tests/integration/websocketEvents.test.ts` (Vitest): connect WebSocket client; trigger application submission; assert all required lifecycle events are received within 5 seconds
    - _Requirements: 32.1, 32.2, 32.3_
  - [ ] 70.4 Write `tests/integration/rateLimiterWorkers.test.ts` (Vitest): start 3 concurrent BullMQ discovery workers for the same platform; assert aggregate requests in any window never exceed configured Token Bucket max
    - _Requirements: 31.5_

- [ ] 71. Write Docker Compose production configuration
  - Create `docker-compose.prod.yml` overriding development config with: production environment variables, restart policies (`restart: unless-stopped` on all services), resource limits, read-only filesystem mounts for config files, Nginx TLS termination config
  - Verify `docker compose -f docker-compose.yml -f docker-compose.prod.yml up` starts all services and health checks pass
  - _Requirements: 30.1_

- [ ] 72. Final Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirement numbers for traceability back to requirements.md
- Property tests use `fast-check` (TypeScript); each property sub-task references its Property number from design.md
- Checkpoints at the end of each phase enforce incremental validation before advancing
- The automation gate (completeness ≥ 70%) must be working before any end-to-end flow can be tested
- Browser pool tasks (Phase 6) require a Docker environment with Playwright Chromium installed: `npx playwright install chromium`
- Embedding model (`all-MiniLM-L6-v2`) is downloaded on first use by `@xenova/transformers` — first startup is slower while the model downloads (~22 MB)
- All LLM calls must use the `getLLMClient()` factory from `src/core/llmProvider.ts` so provider switching works at runtime via the `LLM_PROVIDER` environment variable
- The entire backend is TypeScript (Fastify/Node.js) — no Python required anywhere in the project
- Run backend tests: `cd backend && npx vitest run`
- Run frontend: `cd frontend && npm run dev`
- Run all services: `docker compose up`


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "3.1", "5.1", "6.1", "7"]
    },
    {
      "id": 1,
      "tasks": ["2.2", "2.3", "3.2", "4.1", "8"]
    },
    {
      "id": 2,
      "tasks": ["4.2", "5.2", "6.2", "10.1", "11.1", "16.1", "16.2"]
    },
    {
      "id": 3,
      "tasks": ["10.2", "12.1", "13", "14", "16.3", "17", "18", "19", "22.2", "23.1"]
    },
    {
      "id": 4,
      "tasks": ["10.3", "12.2", "20.1", "21.1", "22.1", "23.2", "26"]
    },
    {
      "id": 5,
      "tasks": ["20.2", "20.3", "21.2", "22.3", "24", "27.1", "31.1", "33.1", "34.1"]
    },
    {
      "id": 6,
      "tasks": ["27.2", "27.3", "27.4", "28", "29.1", "31.2", "31.3", "31.4", "31.5", "32", "33.2", "35"]
    },
    {
      "id": 7,
      "tasks": ["29.2", "37", "38.1", "39.1", "40", "44.1", "46", "51.1", "53.1", "55.1", "60"]
    },
    {
      "id": 8,
      "tasks": ["38.2", "38.3", "38.4", "39.2", "41", "44.2", "45.1", "47.1", "51.2", "53.2", "55.2", "59.1", "63.1", "67.1", "68"]
    },
    {
      "id": 9,
      "tasks": ["39.3", "42", "45.2", "47.2", "48", "49", "52", "54", "56", "57", "59.2", "61", "63.2", "64", "65.1", "66", "67.2", "67.3", "69"]
    },
    {
      "id": 10,
      "tasks": ["59.3", "65.2", "70.1", "70.2", "70.3", "70.4", "71"]
    }
  ]
}
```
