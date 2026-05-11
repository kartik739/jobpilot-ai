# Requirements Document

## Introduction

JobPilot AI is a production-ready, AI-powered job application automation platform for software engineers. The system enables users to build a comprehensive professional profile once, then automatically discovers job opportunities from over a dozen sources, ranks them using AI-powered matching, tailors application materials without fabricating any information, automates form submission via browser automation, monitors email for recruiter responses, tracks all applications centrally, and provides analytics on job-search performance.

The system is entirely composed of free and open-source components — no paid APIs, no trial tiers, no credit cards required anywhere in the stack.

## Glossary

- **System**: The JobPilot AI backend (FastAPI) and frontend (Next.js) taken together.
- **Backend**: The FastAPI Python application responsible for all business logic, agent orchestration, and data persistence.
- **Frontend**: The Next.js/React web application served to the user's browser.
- **Profile**: The user's structured professional record containing personal info, work history, education, projects, skills, certifications, resume versions, and job preferences.
- **Resume_Version**: A named, specialization-tagged variant of the user's resume stored in the system.
- **Job_Discovery_Agent**: The agent responsible for fetching and parsing job postings from all configured sources.
- **Job_Ranking_Agent**: The agent that computes composite match scores between job postings and the user's profile.
- **Resume_Optimizer_Agent**: The agent that reorders and restructures a Resume_Version to match a specific job description without fabricating content.
- **Cover_Letter_Agent**: The agent that generates personalized cover letters and screening question answers.
- **Application_Agent**: The agent that automates browser-based job application form submission via Playwright.
- **Email_Monitor_Agent**: The agent that polls Gmail, classifies recruitment emails, and updates application status.
- **Interview_Prep_Agent**: The agent that generates tailored interview preparation questions per application.
- **Analytics_Agent**: The agent that computes application metrics, keyword effectiveness, and source performance.
- **Notification_Manager**: The component that persists and delivers in-app notification events to the user.
- **Job_Posting**: A parsed, structured record of a job opportunity discovered from any source.
- **Application_Record**: A database record representing one application submission by the user for one Job_Posting.
- **Match_Score**: The composite numeric score (0–100) representing how well a Job_Posting matches the user's profile.
- **Fingerprint**: The deduplication hash computed as SHA-256(lowercase(title + '|' + company + '|' + url)) for a Job_Posting.
- **ATS**: Applicant Tracking System (e.g., Greenhouse, Lever, Ashby, Workday, SmartRecruiters).
- **Playwright**: The browser automation library used for scraping and form submission.
- **LLM_Provider**: Any configured free large language model provider (Ollama, Gemini free tier, Groq free tier, OpenRouter free tier).
- **pgvector**: The PostgreSQL vector extension used for semantic similarity search.
- **SeaweedFS**: The self-hosted S3-compatible file storage service used for resumes, cover letters, and screenshots.
- **BullMQ**: The async Redis-backed task queue used for background worker processing.
- **GlitchTip**: The self-hosted Sentry-compatible error tracking service.
- **pino**: The structured JSON logging library used for all Backend log output.
- **Token_Bucket**: The per-platform rate-limiting mechanism that controls request frequency.
- **Truthfulness_Report**: The output of the truthfulness validation function, indicating whether any fabrications were introduced during resume optimization.

## Requirements

---

### Requirement 1: User Profile Management

**User Story:** As a software engineer, I want to build and maintain a comprehensive professional profile, so that the system has accurate data to tailor all application materials and job matching on my behalf.

#### Acceptance Criteria

1. THE System SHALL store a user profile containing: full name (max 200 characters), email (max 254 characters, per RFC 5321), phone, location, LinkedIn URL, GitHub URL, portfolio URL, website URL, work authorization types, sponsorship requirement flag, notice period in days, work experiences, education records, projects, skills, certifications, and job preferences.
2. WHEN a user submits a profile update with an invalid or duplicate email, THE Backend SHALL return HTTP 422 with a field-level error indicating the email must be a valid format and unique across all users.
3. WHEN a user submits a profile update with an empty work authorization list, THE Backend SHALL return HTTP 422 indicating that work authorization must contain at least one value.
4. WHEN a user submits a profile update with a negative notice period, THE Backend SHALL return HTTP 422 indicating that notice period must be greater than or equal to zero.
5. WHEN a user submits a salary range where minimum exceeds maximum, THE Backend SHALL return HTTP 422 indicating that salary minimum must be less than or equal to salary maximum.
6. WHEN a user submits job preferences with an empty target roles list, THE Backend SHALL return HTTP 422 indicating that target roles must contain at least one entry.
7. THE System SHALL support multiple Resume_Version records per user, each tagged with a specialization: backend, frontend, fullstack, devops, cloud, ai_ml, mobile, data, or general.
8. WHEN a profile section is updated, THE Backend SHALL recompute and store the profile completeness score between 0 and 100. The required sections for a complete profile are: personal info (full name, email, phone, location), at least one work experience, at least one skill, work authorization, and job preferences (target roles and preferred locations).
9. THE System SHALL encrypt the phone number, salary expectations, and portal credentials fields using AES-256-GCM before persisting them.
10. WHEN a user requests their profile, THE Backend SHALL return all fields with sensitive fields decrypted in the response body and never expose the raw encryption key. WHEN decryption fails for any sensitive field, THE Backend SHALL return HTTP 500 and log the error without exposing the encryption key.

---

### Requirement 2: Multi-Step Onboarding Wizard

**User Story:** As a new user, I want a guided onboarding experience, so that I can set up my complete profile in a structured way before the system starts applying to jobs on my behalf.

#### Acceptance Criteria

1. THE Frontend SHALL present a multi-step onboarding wizard with the following sequential steps: Personal Info, Work Experience, Education, Projects, Skills, Resume Upload, Preferences, Source Configuration, and Review.
2. WHEN a user completes each wizard step, THE Frontend SHALL validate the step's required fields before allowing progression to the next step.
3. THE Frontend SHALL display a profile completeness percentage in the navigation header throughout the onboarding and post-onboarding experience.
4. WHEN a user's profile completeness score is below 70, THE Backend SHALL reject requests to start automation with an HTTP 422 response indicating the minimum completeness threshold is not met.
5. WHEN a user's profile completeness score is 70 or above, THE Backend SHALL permit automation to be started.

---

### Requirement 3: Job Discovery — ATS and Job Board Platforms

**User Story:** As a user, I want the system to automatically discover relevant job postings from major ATS platforms and job boards, so that I am exposed to a broad set of opportunities without manual searching.

#### Acceptance Criteria

1. THE Job_Discovery_Agent SHALL discover job postings from Greenhouse via its public jobs API.
2. THE Job_Discovery_Agent SHALL discover job postings from Lever via its public jobs API.
3. THE Job_Discovery_Agent SHALL discover job postings from Ashby via its public jobs API.
4. THE Job_Discovery_Agent SHALL discover job postings from Workday via its jobs RSS feed or API.
5. THE Job_Discovery_Agent SHALL discover job postings from SmartRecruiters via its public jobs API.
6. THE Job_Discovery_Agent SHALL discover job postings from Wellfound via its available API or RSS feed.
7. THE Job_Discovery_Agent SHALL discover job postings from Y Combinator Jobs via its available API or RSS feed.
8. THE Job_Discovery_Agent SHALL discover job postings from RemoteOK via its public API.
9. THE Job_Discovery_Agent SHALL discover job postings from Indeed via its available API or RSS feed.
10. THE Job_Discovery_Agent SHALL discover job postings from Naukri via its available API or RSS feed.
11. WHEN a job source returns an error or network failure, THE Job_Discovery_Agent SHALL log the error, yield no postings from that source, and continue processing remaining sources without raising an unhandled exception.
12. THE Job_Discovery_Agent SHALL respect the robots.txt policy of each scraped platform before initiating any Playwright-based automation.

---

### Requirement 4: Job Discovery — X/Twitter Playwright Scraping

**User Story:** As a user, I want the system to find job postings shared on X/Twitter by extracting ATS links from tweets, so that I can capture opportunities posted informally on social media.

#### Acceptance Criteria

1. WHEN X/Twitter discovery is enabled, THE Job_Discovery_Agent SHALL use Playwright to navigate to X search result pages using the user's encrypted X credentials.
2. THE Job_Discovery_Agent SHALL scroll through search results and extract all outbound URLs from tweets, resolving t.co short links to their final destination URLs.
3. THE Job_Discovery_Agent SHALL filter extracted URLs to pass only those matching a configurable allowlist of known ATS hostnames (greenhouse.io, lever.co, ashby.hq.com, and equivalent job board domains) downstream to the job parsing pipeline.
4. WHEN an extracted URL does not match any known ATS or job board hostname, THE Job_Discovery_Agent SHALL discard that URL and not queue it for application.
5. THE Job_Discovery_Agent SHALL enforce a maximum of 3 X/Twitter search queries per hour per user using a Token_Bucket rate limiter.
6. THE Job_Discovery_Agent SHALL limit each search session to a maximum of 50 tweets processed per search query.
7. THE Job_Discovery_Agent SHALL tag all Job_Postings sourced from X/Twitter with source value 'twitter_x' and pass them to the standard parseJobDescription pipeline.

---

### Requirement 5: Job Discovery — LinkedIn Playwright Scraping

**User Story:** As a user, I want the system to discover jobs from LinkedIn by scraping the public jobs search page, so that I can access LinkedIn's large job inventory without a paid API agreement.

#### Acceptance Criteria

1. WHEN LinkedIn discovery is enabled, THE Job_Discovery_Agent SHALL use Playwright to navigate to the LinkedIn Jobs search page using the user's encrypted LinkedIn credentials.
2. THE Job_Discovery_Agent SHALL extract job card URLs, job titles, company names, and locations from the LinkedIn Jobs search results page, using the user's targetRoles as search keywords and the user's preferredLocations as location parameters.
3. THE Job_Discovery_Agent SHALL follow each job card link and capture the external ATS redirect URL for jobs that do not show a LinkedIn Easy Apply button. WHEN a job card's detail page redirects to an external URL, THE Job_Discovery_Agent SHALL capture that external URL as the application URL.
4. WHEN a job card shows the LinkedIn Easy Apply button, THE Job_Discovery_Agent SHALL skip that job card and not queue it for application in this version.
5. THE Job_Discovery_Agent SHALL enforce a maximum of 20 job cards processed per LinkedIn session using a Token_Bucket rate limiter. This limit is per-session and is enforced before starting each new session.
6. THE Job_Discovery_Agent SHALL enforce a minimum 10-minute interval between consecutive LinkedIn discovery sessions.
7. WHEN LinkedIn presents a CAPTCHA or verification prompt during scraping, THE Job_Discovery_Agent SHALL immediately pause the session, capture a screenshot, and emit a manual_intervention_required notification to the user without attempting to bypass the challenge.

---

### Requirement 6: Job Description Parsing

**User Story:** As a user, I want job postings to be parsed into structured data, so that the ranking and matching engine has precise information to compare against my profile.

#### Acceptance Criteria

1. WHEN a raw job posting is received from any source, THE Job_Discovery_Agent SHALL parse it and extract: company name, job title, required skills list, preferred skills list, minimum years of experience, maximum years of experience, location list, remote flag, hybrid flag, salary minimum, salary maximum, currency, employment type, visa requirements, application deadline, and application URL.
2. WHEN a field cannot be extracted from a job posting, THE Job_Discovery_Agent SHALL store that field as null rather than a default or fabricated value.
3. THE Job_Discovery_Agent SHALL store the full raw HTML or JSON of each job posting alongside the parsed structured fields for auditability.
4. THE Job_Discovery_Agent SHALL generate a vector embedding for each parsed job description using sentence-transformers and store it in the pgvector-enabled PostgreSQL database.
5. WHEN a job posting has fewer than 3 extractable structured fields, THE Job_Discovery_Agent SHALL mark it as parse_failed and skip it without queuing it for ranking or application.
6. WHEN embedding generation fails for a job posting, THE Job_Discovery_Agent SHALL store the posting without an embedding and mark it as embedding_pending for retry.

---

### Requirement 7: Job Deduplication

**User Story:** As a user, I want the system to automatically deduplicate job postings discovered from multiple sources, so that I am not presented with or applied to the same job multiple times.

#### Acceptance Criteria

1. THE Job_Discovery_Agent SHALL compute a Fingerprint for each parsed Job_Posting as the SHA-256 hash of the concatenation lowercase(title + '|' + company + '|' + url).
2. WHEN a Job_Posting with an already-existing Fingerprint is discovered, THE Job_Discovery_Agent SHALL discard the duplicate and not create a new database record.
3. WHEN deduplication is applied to a set of Job_Postings, applying it a second time to the output SHALL produce a set of the same size (idempotency).
4. THE Backend SHALL enforce the Fingerprint uniqueness constraint at the database level to prevent race-condition duplicates from concurrent discovery workers.

---

### Requirement 8: AI-Powered Job Ranking

**User Story:** As a user, I want the system to rank discovered jobs by how well they match my profile, so that automation focuses on the most promising opportunities first.

#### Acceptance Criteria

1. THE Job_Ranking_Agent SHALL compute a Match_Score for each Job_Posting using the following weighted components: skill match at 35%, experience match at 20%, location match at 15%, salary match at 10%, technology stack match at 10%, and LLM holistic evaluation at 10%.
2. THE Match_Score overall value SHALL always be within the range 0 to 100 inclusive.
3. WHEN a Job_Posting's company is in the user's preferred companies list, THE Job_Ranking_Agent SHALL multiply the computed overall score by 1.2 before clamping to 100.
4. WHEN a Job_Posting's visa requirements are incompatible with the user's work authorization, THE Job_Ranking_Agent SHALL assign an overall score of 0 and record 'work_authorization_incompatible' as a disqualifier.
5. WHEN the user's skill coverage of a Job_Posting's required skills is below 50%, THE Job_Ranking_Agent SHALL assign an overall score of 0 and record 'insufficient_required_skills' as a disqualifier.
6. WHEN any hard disqualifier is present, THE Job_Ranking_Agent SHALL exclude that Job_Posting from application queuing regardless of other score components.
7. WHEN the LLM_Provider is unavailable during scoring, THE Job_Ranking_Agent SHALL fall back to a default holistic score of 50 for the LLM component and continue scoring with the remaining components.
8. THE Job_Ranking_Agent SHALL retrieve the top 200 candidate Job_Postings by pgvector cosine similarity before applying LLM re-ranking for precision.

---

### Requirement 9: Resume Optimizer

**User Story:** As a user, I want the system to tailor my resume for each specific job without inventing experience I do not have, so that my application is both relevant and truthful.

#### Acceptance Criteria

1. WHEN optimizing a resume, THE Resume_Optimizer_Agent SHALL reorder work experiences and projects so that the most relevant entries appear first, based on keyword and skill overlap with the job description.
2. WHEN optimizing a resume, THE Resume_Optimizer_Agent SHALL reorder the skills section so that skills matching the job's required and preferred skills appear first.
3. WHEN optimizing a resume, THE Resume_Optimizer_Agent SHALL generate a tailored professional summary using the LLM, constrained to use only information already present in the original resume summary.
4. THE Resume_Optimizer_Agent SHALL not add any new work experiences, projects, certifications, skills, or education entries that are not present in the base Resume_Version.
5. THE number of work experiences in the optimized resume SHALL equal the number in the base Resume_Version.
6. THE number of projects in the optimized resume SHALL equal the number in the base Resume_Version.
7. THE skills set in the optimized resume SHALL be a subset of the skills set in the base Resume_Version.
8. WHEN truthfulness validation detects fabrications in an optimized resume, THE Resume_Optimizer_Agent SHALL discard the optimized version and fall back to the original base Resume_Version for that application.
9. THE Resume_Optimizer_Agent SHALL run truthfulness validation before every application submission and never submit an optimized resume that fails validation.
10. THE Resume_Optimizer_Agent SHALL export the final selected resume to PDF format using weasyprint and store it in SeaweedFS.
11. WHEN the LLM_Provider is unavailable during optimization, THE Resume_Optimizer_Agent SHALL fall back to the base Resume_Version without attempting optimization.
12. WHEN the LLM prompt for summary generation fails to produce output constrained to the original facts, THE Resume_Optimizer_Agent SHALL use the original summary unchanged.
13. WHEN PDF export fails, THE Resume_Optimizer_Agent SHALL fall back to uploading the original base resume file already stored in SeaweedFS.

---

### Requirement 10: Cover Letter Generation

**User Story:** As a user, I want the system to generate personalized cover letters for each application, so that I can apply with professional materials without writing each letter manually.

#### Acceptance Criteria

1. THE Cover_Letter_Agent SHALL generate a cover letter referencing the specific company name, job title, and key requirements from the job description.
2. THE Cover_Letter_Agent SHALL generate cover letters using only facts present in the user's profile and shall not fabricate achievements, companies, or dates.
3. WHERE the user's cover letter review mode is set to 'review_first', THE System SHALL present the generated cover letter to the user for approval via a WebSocket event before submitting the application.
4. WHEN cover letter review mode is 'review_first' and the user does not respond within 24 hours, THE System SHALL proceed with the original generated cover letter.
5. WHERE the user's cover letter review mode is set to 'auto', THE System SHALL submit the generated cover letter without requiring user approval.
6. WHEN the user edits a cover letter draft before submission, THE System SHALL use the user's edited version and not regenerate it.
7. THE System SHALL store all generated cover letter drafts linked to their Application_Record in SeaweedFS.

---

### Requirement 11: Screening Question Answering

**User Story:** As a user, I want the system to answer application screening questions on my behalf using my profile data, so that I do not need to manually fill in repetitive fields on every application.

#### Acceptance Criteria

1. THE Cover_Letter_Agent SHALL generate screening question answers using only data present in the user's profile and shall not fabricate any responses.
2. WHEN a screening question cannot be answered from profile data, THE Cover_Letter_Agent SHALL leave the answer blank and flag the field for manual completion rather than fabricating a response.
3. THE System SHALL maintain a reusable answer library per user, keyed by question type, that stores previously generated or user-approved answers for common questions.
4. WHEN a screening question matches a type with an existing reusable answer, THE Cover_Letter_Agent SHALL retrieve and use the stored answer rather than regenerating it.
5. WHEN a new screening question answer is generated and approved, THE System SHALL store it in the user's reusable answer library for future use.

---

### Requirement 12: Application Automation via Playwright

**User Story:** As a user, I want the system to automatically fill and submit job application forms using my profile and generated materials, so that I do not have to complete every form manually.

#### Acceptance Criteria

1. THE Application_Agent SHALL use Playwright to navigate to the job's application URL, detect form fields, fill them using profile data and screening answers, upload the resume PDF and cover letter PDF, and submit the form.
2. WHEN a job portal requires login, THE Application_Agent SHALL retrieve the user's encrypted portal credentials, authenticate with the portal, and proceed with form filling.
3. WHEN portal credentials for a required login are absent, THE Application_Agent SHALL return a result with success=false, requires_manual_intervention=true, and failure_reason='portal_credentials_missing'.
4. WHEN portal credential retrieval from encrypted storage fails, THE Application_Agent SHALL return a result with requires_manual_intervention=true and not attempt to proceed with form filling.
5. WHEN a CAPTCHA challenge is detected during any phase of the application, THE Application_Agent SHALL immediately pause automation, capture a screenshot of the current page state, set requires_manual_intervention=true and success=false, and never attempt to solve or bypass the CAPTCHA.
6. WHEN an MFA prompt is detected during any phase of the application, THE Application_Agent SHALL immediately pause automation, capture a screenshot, set requires_manual_intervention=true and success=false, and never attempt to bypass the MFA step.
7. THE Application_Agent SHALL capture a screenshot on every application outcome, whether successful or failed, and store it in SeaweedFS.
8. WHEN an application fails with a retryable error (network timeout or connection error), THE Application_Agent SHALL re-queue the application task with exponential backoff delays of 2^attempt seconds (attempt starts at 0, yielding delays of 1s, 2s, 4s) up to a maximum of 3 retry attempts.
9. WHEN a retryable error persists after 3 attempts, THE Application_Agent SHALL record the application as failed_submission.
10. WHEN an application fails with a non-retryable error, THE Application_Agent SHALL record the application as failed_submission and notify the user with a link to the original job posting.
11. THE Application_Agent SHALL always release the Playwright browser session back to the pool in a FINALLY block, regardless of whether the application succeeded or failed.
12. THE Application_Agent SHALL emit real-time application progress events via WebSocket throughout the submission process.

---

### Requirement 13: Duplicate Application Prevention

**User Story:** As a user, I want the system to never submit more than one application for the same job, so that I do not appear unprofessional to employers by applying multiple times.

#### Acceptance Criteria

1. THE Backend SHALL enforce a unique database constraint on the combination of (user_id, job_fingerprint) in the application_records table.
2. WHEN the Application_Agent attempts to submit an application for a (user_id, job_fingerprint) pair that already exists, THE Backend SHALL raise an integrity error, skip the submission, log the deduplication event, and not count the skip against the daily apply limit.
3. THE Job_Ranking_Agent SHALL check whether a job has already been applied to before queuing it for application, and SHALL exclude already-applied jobs from the ranked results.

---

### Requirement 14: Daily Apply Limit and Automation Controls

**User Story:** As a user, I want to control how many applications are submitted per day and be able to pause the automation, so that I can manage my job search pace and comply with platform policies.

#### Acceptance Criteria

1. THE System SHALL enforce a configurable daily application limit per user, defaulting to 10 applications per day. The daily limit resets at midnight UTC.
2. WHEN a user's daily application count reaches their configured limit, THE System SHALL stop queuing new applications for that calendar day and emit a daily_limit_reached notification.
3. THE daily apply limit SHALL be configurable by the user up to a maximum of 50 applications per day.
4. THE Frontend SHALL provide controls to pause and resume the automation agent.
5. WHILE automation is paused, THE Application_Agent SHALL not dequeue or submit any new applications.
6. WHEN automation is paused with queued applications pending, THE Application_Agent SHALL hold those tasks in the queue and not discard them.
7. WHEN automation is resumed, THE Application_Agent SHALL resume processing queued applications up to the remaining daily limit.

---

### Requirement 15: Manual Job Application Override

**User Story:** As a user, I want to manually paste a specific job URL and have the system apply to it, so that I can target jobs I find myself outside the automated discovery flow.

#### Acceptance Criteria

1. THE Frontend SHALL provide a form where the user can paste a job posting URL.
2. WHEN a user submits a job URL via the manual flow, THE Backend SHALL validate that the submitted URL is a valid URL format and return HTTP 400 if it is not.
3. WHEN the URL is valid, THE Backend SHALL parse the job description at that URL using the standard job parsing pipeline.
4. WHEN parsing succeeds, THE Backend SHALL rank the job against the user's profile and display the Match_Score to the user.
5. WHEN the user confirms after reviewing the Match_Score, THE Backend SHALL queue the job for application.
6. WHEN a manually submitted URL matches an existing Job_Posting Fingerprint, THE Backend SHALL return the existing Match_Score and not re-parse the job description.
7. WHEN parsing fails for a manually submitted URL, THE Backend SHALL return an error response describing why the URL could not be parsed.

---

### Requirement 16: Gmail Integration and Email Monitoring

**User Story:** As a user, I want the system to monitor my Gmail inbox for recruitment emails and automatically update my application statuses, so that I always have an up-to-date view of my job search without manually checking email.

#### Acceptance Criteria

1. THE Email_Monitor_Agent SHALL authenticate with Gmail using OAuth 2.0, requesting only the gmail.readonly and gmail.modify scopes.
2. THE Email_Monitor_Agent SHALL poll Gmail for unread recruitment emails every 15 minutes.
3. THE Email_Monitor_Agent SHALL classify each recruitment email into one of the following types: interview_invite, rejection, offer, assessment, followup, or other.
4. WHEN the LLM_Provider is unavailable during email classification, THE Email_Monitor_Agent SHALL classify the email as type 'other' with confidence 0.0 and continue processing.
5. WHEN an email is classified with confidence below 0.7, THE Email_Monitor_Agent SHALL skip updating application status for that email and mark it as processed to prevent re-processing in future polling cycles.
6. WHEN an email is successfully classified, THE Email_Monitor_Agent SHALL match it to an existing Application_Record using company name and role fuzzy matching with a company name similarity threshold of at least 0.8 (using Levenshtein or equivalent distance metric), and update the application status accordingly.
7. WHEN an email cannot be matched to any Application_Record, THE Email_Monitor_Agent SHALL log the event and continue without raising an unhandled exception.
8. WHEN a Gmail OAuth token expires, THE Email_Monitor_Agent SHALL stop polling, emit a gmail_auth_expired event to the user via WebSocket, and resume monitoring automatically once the user re-authorizes.

---

### Requirement 17: Google Calendar Integration

**User Story:** As a user, I want the system to create Google Calendar events for interview invitations detected in my email, so that I never miss a scheduled interview.

#### Acceptance Criteria

1. WHERE the user has enabled Google Calendar integration, THE Email_Monitor_Agent SHALL request the calendar write OAuth scope during authentication.
2. WHEN an email is classified as an interview_invite and Google Calendar integration is enabled, THE Email_Monitor_Agent SHALL extract the interview date, time, duration, and format from the email body.
3. WHEN the interview duration cannot be extracted from the email, THE Email_Monitor_Agent SHALL default to a 60-minute event duration.
4. WHEN interview details are extracted, THE Email_Monitor_Agent SHALL create a Google Calendar event with the interview details and link it to the Application_Record.
5. WHEN Google Calendar API returns an error, THE Email_Monitor_Agent SHALL log the error, store the interview details in the database, and notify the user to create the calendar event manually.
6. WHEN Google Calendar integration is disabled, THE Email_Monitor_Agent SHALL store interview details in the database without creating a calendar event.

---

### Requirement 18: Application Tracker

**User Story:** As a user, I want a complete history of all my applications and their status transitions, so that I have a single source of truth for my entire job search.

#### Acceptance Criteria

1. THE System SHALL create an Application_Record for every application submission attempt, whether successful or failed.
2. THE Application_Record SHALL include: applied_at timestamp, source platform, application URL, resume version used, cover letter storage path (nullable), current status, status history, automation session ID (nullable), screenshot paths, confirmation number if available (nullable), form answers snapshot, match score snapshot at time of application, and user notes.
3. THE System SHALL record every status transition as an immutable StatusTransition entry containing: from status, to status, triggered_by (user, email_monitor, or automation), timestamp, and an optional note. Once an Application_Record reaches a later status (phone_screen, technical_interview, final_round, offer_received, offer_accepted, or offer_declined), no status transition SHALL revert it to an earlier status.
4. THE match_score_snapshot field SHALL be written once at application creation time and never modified after creation.
5. THE System SHALL support all of the following application statuses: draft, submitted, under_review, phone_screen, technical_interview, final_round, offer_received, offer_accepted, offer_declined, rejected, withdrawn, ghosted, and failed_submission.

---

### Requirement 19: Interview Preparation Agent

**User Story:** As a user preparing for an interview, I want the system to generate tailored interview questions based on the job and my background, so that I can practice effectively without spending hours on research.

#### Acceptance Criteria

1. WHEN a user requests interview preparation for an Application_Record, THE Interview_Prep_Agent SHALL generate between 5 and 10 interview questions using a free LLM_Provider.
2. THE Interview_Prep_Agent SHALL generate a mix of behavioral and technical questions grounded in the job description and the user's profile, with at least 2 behavioral questions and at least 2 technical questions in every prep sheet.
3. THE Interview_Prep_Agent SHALL store the generated prep sheet linked to the Application_Record for later retrieval.
4. THE Interview_Prep_Agent SHALL suggest answers to behavioral questions using only facts from the user's actual profile data and shall not fabricate experiences.

---

### Requirement 20: Analytics Dashboard

**User Story:** As a user, I want to see analytics about my job search performance over time, so that I can identify what is working and adjust my strategy.

#### Acceptance Criteria

1. THE Analytics_Agent SHALL compute and expose the following summary metrics for a configurable date range: total applications, interview rate, rejection rate, offer rate, and pending application count. The default date range is the last 30 days; the maximum supported date range is 365 days.
2. THE Analytics_Agent SHALL compute application counts grouped by source platform.
3. THE Analytics_Agent SHALL compute application counts grouped by tech stack.
4. THE Analytics_Agent SHALL compute the ATS success rate (proportion of applications to ATS platforms that advanced past submission).
5. THE Analytics_Agent SHALL compute keyword effectiveness: which keywords in resumes and cover letters correlate with higher response rates.
6. THE Analytics_Agent SHALL compute resume version performance: interview rate per Resume_Version.
7. WHEN an Application_Record transitions to phone_screen, technical_interview, final_round, offer_received, or offer_accepted, THE Analytics_Agent SHALL increment the success_count on the associated Resume_Version record.
8. THE Analytics_Agent SHALL compute and expose weekly application count trend data representing the last 12 weeks.

---

### Requirement 21: In-App Notification Center

**User Story:** As a user, I want to receive in-app notifications for important job search events, so that I am promptly informed when action is needed or milestones are reached.

#### Acceptance Criteria

1. THE Notification_Manager SHALL create a notification record for each of the following events: application_submitted, interview_detected, offer_received, manual_intervention_required, source_error, and daily_limit_reached.
2. THE Notification_Manager SHALL deliver notifications to the user in real-time via WebSocket with a delivery latency of no more than 5 seconds from the time the notification event is created.
3. THE Frontend SHALL poll for unread notifications every 30 seconds as a fallback for missed WebSocket events.
4. THE Frontend SHALL display an unread notification count in the navigation header.
5. WHEN a user marks a notification as read, THE System SHALL update the notification record's is_read flag and readAt timestamp.
6. WHEN a user marks all notifications as read, THE Backend SHALL update all unread notification records for that user atomically in a single database transaction.

---

### Requirement 22: Job Source Health Dashboard

**User Story:** As a user, I want to monitor the health of each configured job source, so that I can quickly identify and respond to sources that are failing or rate-limited.

#### Acceptance Criteria

1. THE Frontend SHALL display a job source health page showing each configured source with: platform name, last run timestamp, number of jobs found in last run, and current status (active, rate_limited, error, or never_run).
2. WHEN a source encounters a rate limit response (HTTP 429 or equivalent platform signal), THE Job_Discovery_Agent SHALL record the status as rate_limited and cease requests to that source for the remainder of the rate limit window. WHEN the rate-limit window duration is unknown, THE Job_Discovery_Agent SHALL default to a 60-minute backoff before retrying.
3. WHEN a source encounters an error, THE Job_Discovery_Agent SHALL record the error message and set the source status to error.
4. THE Frontend SHALL provide a manual "run now" button per source that enqueues an immediate discovery task for that source. WHEN a source is currently running, THE Frontend SHALL disable the 'run now' button for that source.

---

### Requirement 23: Authentication

**User Story:** As a user, I want my account to be secured with JWT-based authentication, so that only I can access my profile and application data.

#### Acceptance Criteria

1. THE Backend SHALL issue JWT access tokens with a 1-hour expiry upon successful login.
2. THE Backend SHALL hash all user passwords using bcrypt before storing them and shall never store plaintext passwords.
3. THE Backend SHALL issue refresh tokens stored in Redis with a 7-day TTL for session renewal.
4. WHEN an access token expires, THE Backend SHALL allow the user to obtain a new access token by presenting a valid refresh token.
5. WHEN a refresh token expires or is revoked, THE Backend SHALL require the user to log in again.
6. THE Backend SHALL implement role-based access such that a standard user cannot access another user's data.

---

### Requirement 24: Sensitive Data Encryption

**User Story:** As a user, I want my sensitive personal data encrypted at rest, so that a database breach does not expose my private information.

#### Acceptance Criteria

1. THE Backend SHALL encrypt the user's phone number, salary expectations, and job portal credentials using AES-256-GCM before persisting them to the database.
2. THE Backend SHALL derive the encryption key from the ENCRYPTION_KEY environment variable and shall not use any external key management service.
3. WHEN sensitive data is encrypted then decrypted, THE Backend SHALL produce a value equivalent to the original plaintext.
4. THE Backend SHALL never include raw encryption keys or decrypted sensitive values in log output or error messages.
5. THE Backend SHALL serve resume files, cover letters, and screenshots only through pre-signed time-limited tokens generated by the Backend, with a maximum expiry of 15 minutes per token.

---

### Requirement 25: Data Export (GDPR/CCPA Compliance)

**User Story:** As a user, I want to download all my data in a machine-readable format, so that I can exercise my data portability rights and maintain personal records of my job search.

#### Acceptance Criteria

1. THE Backend SHALL expose a data export endpoint at /api/user/export that returns a ZIP file when requested by the authenticated user.
2. THE ZIP file SHALL contain: all Application_Records as a CSV file, all uploaded resumes as their original files, all generated cover letters as text files, all application screenshots as image files, and the user's profile as a JSON file.
3. WHEN a user account is deleted, THE Backend SHALL permanently delete all of that user's data including application records, resumes, cover letters, screenshots, and profile data.

---

### Requirement 26: Free LLM Provider Configuration

**User Story:** As a user, I want to configure which free LLM provider the system uses, so that I can choose between local inference and cloud-based free tiers based on my setup.

#### Acceptance Criteria

1. THE Backend SHALL support the following LLM_Provider configurations: Ollama (local, OpenAI-compatible at http://localhost:11434/v1), Google Gemini free tier, Groq free tier, and OpenRouter free tier.
2. THE Backend SHALL accept any OpenAI-compatible base_url and api_key as LLM_Provider configuration, enabling the active provider to be switched via environment variable without code changes.
3. WHEN the active LLM_Provider returns an error or timeout, THE Backend SHALL fall back to safe default behavior for the affected operation (original resume for optimization, 'other' classification for emails, keyword-only scoring for ranking).
4. THE System SHALL not require any paid API keys or credit card registration to operate any LLM_Provider.

---

### Requirement 27: Vector Search and Embeddings

**User Story:** As a user, I want job matching to use semantic similarity rather than exact keyword matching, so that relevant jobs are surfaced even when they use different terminology.

#### Acceptance Criteria

1. THE Backend SHALL use the pgvector PostgreSQL extension for all vector similarity search operations, with no separate vector database service required.
2. THE Backend SHALL generate embeddings using the sentence-transformers library with the all-MiniLM-L6-v2 model (384-dimensional output) running locally without any external API call.
3. WHEN a job description embedding is generated from valid non-empty text, THE Backend SHALL produce a 384-dimensional vector.
4. THE Backend SHALL use cosine similarity for all semantic search queries against the pgvector-indexed job and profile embedding columns.

---

### Requirement 28: File Storage and Task Queue

**User Story:** As a developer operating the system, I want file storage and background task processing to be handled by self-hosted free services, so that the system has no dependency on paid cloud infrastructure.

#### Acceptance Criteria

1. THE System SHALL store all resume files, cover letter files, and application screenshots in SeaweedFS using its S3-compatible API.
2. WHEN a file is stored in SeaweedFS and then retrieved, THE System SHALL return byte-for-byte identical content.
3. THE Backend SHALL use BullMQ as the async task queue for all background workers (job discovery, application submission, email monitoring, analytics).
4. WHEN a task is enqueued via BullMQ, THE Backend SHALL eventually consume and execute it unless the system is shut down.

---

### Requirement 29: Error Tracking

**User Story:** As a developer operating the system, I want self-hosted error tracking, so that I can diagnose and fix production issues without paying for external error monitoring services.

#### Acceptance Criteria

1. THE Backend SHALL report all unhandled exceptions to GlitchTip using the Sentry-compatible Python SDK.
2. THE Backend SHALL configure GlitchTip using a DSN environment variable and shall not require any external Sentry account.
3. THE Backend SHALL never include plaintext passwords, encryption keys, or OAuth tokens in error reports sent to GlitchTip.

---

### Requirement 30: Infrastructure and Observability

**User Story:** As a developer operating the system, I want all services to be runnable with a single Docker Compose command and observable through metrics and structured logs, so that I can operate and debug the system efficiently.

#### Acceptance Criteria

1. THE System SHALL provide a Docker Compose configuration that starts all required services: Backend, Frontend, PostgreSQL with pgvector, Redis, SeaweedFS, Prometheus, Grafana, and GlitchTip.
2. THE Backend SHALL emit all log output as structured JSON using structlog.
3. THE Backend SHALL expose Prometheus-compatible metrics for key operations including job discovery counts, application submission counts, LLM call latency, and task queue depth.
4. THE System SHALL provide a Grafana dashboard configuration for the metrics exposed by the Backend.

---

### Requirement 31: Rate Limiting and Platform Compliance

**User Story:** As a user, I want the system to respect each platform's rate limits and usage policies, so that my accounts are not blocked or banned due to excessive automated requests.

#### Acceptance Criteria

1. THE Job_Discovery_Agent SHALL implement a per-platform Token_Bucket rate limiter that enforces the maximum requests per time window for each job source.
2. WHEN a platform's Token_Bucket is exhausted, THE Job_Discovery_Agent SHALL wait until the bucket refills before sending additional requests to that platform.
3. THE Job_Discovery_Agent SHALL read and comply with the robots.txt directives of each web-scraped platform before initiating Playwright automation.
4. THE System SHALL never attempt to solve, bypass, or automate responses to CAPTCHA challenges on any platform.
5. WHEN concurrent discovery workers are running, THE Backend SHALL use a shared Redis-backed rate limit state so that the aggregate request rate across all workers does not exceed the per-platform limit.

---

### Requirement 32: WebSocket Real-Time Updates

**User Story:** As a user monitoring my automation session, I want to see real-time updates in the browser as jobs are discovered and applications are submitted, so that I do not need to refresh the page to check progress.

#### Acceptance Criteria

1. THE Backend SHALL maintain a WebSocket server that authenticated clients can connect to for receiving real-time events.
2. THE Application_Agent SHALL emit WebSocket events for at least the following application lifecycle moments: job discovered, resume optimized, cover letter generated, application submitted (success), and application failed.
3. THE Notification_Manager SHALL deliver all notification events to the user's active WebSocket connections in real-time.
4. WHEN a WebSocket connection is lost, THE Frontend SHALL attempt to reconnect automatically without requiring a page reload.

---

### Requirement 33: REST API Quality and Security

**User Story:** As a developer integrating with the system, I want the REST API to enforce strict input validation and security policies, so that the system is safe from injection attacks and unauthorized access.

#### Acceptance Criteria

1. THE Backend SHALL validate all incoming request bodies using Pydantic models on every API endpoint and return HTTP 422 with field-level error details for invalid input.
2. THE Backend SHALL use the SQLAlchemy ORM for all database operations and shall not construct or execute raw SQL strings.
3. THE Backend SHALL enforce CORS by allowing requests only from the configured frontend origin.
4. THE Backend SHALL include the following security headers on all HTTP responses: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, and Content-Security-Policy.
5. THE Backend SHALL enforce per-IP and per-user rate limits on all API endpoints using a Redis-backed rate limiter.
6. WHEN an unauthenticated request is made to a protected endpoint, THE Backend SHALL return HTTP 401.
7. WHEN an authenticated user requests a resource belonging to a different user, THE Backend SHALL return HTTP 403.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Profile Completeness Score Boundedness

*For any* user profile with any combination of populated and empty fields, the computed profile completeness score SHALL be within the range [0, 100] inclusive.

**Validates: Requirements 1.8**

---

### Property 2: Profile Completeness Automation Gate

*For any* user profile, the automation start request SHALL be accepted if and only if the profile completeness score is 70 or above; for any profile with a score below 70, the request SHALL be rejected with HTTP 422.

**Validates: Requirements 2.4, 2.5**

---

### Property 3: Social Media URL Safety (Allowlist Enforcement)

*For any* set of URLs extracted from X/Twitter or LinkedIn scraping, every URL that is queued for application SHALL match at least one entry in the known ATS or job board hostname allowlist; no URL that does not match the allowlist SHALL be queued.

**Validates: Requirements 4.3, 4.4, 5.4**

---

### Property 4: X/Twitter Search Rate Limit

*For any* one-hour time window and any user, the number of X/Twitter search queries issued by the Job_Discovery_Agent SHALL not exceed 3.

**Validates: Requirements 4.5**

---

### Property 5: LinkedIn Session Rate Limits

*For any* LinkedIn discovery session, the number of job cards processed SHALL not exceed 20; and for any two consecutive LinkedIn sessions, the time elapsed between them SHALL be at least 10 minutes.

**Validates: Requirements 5.5, 5.6**

---

### Property 6: Job Deduplication Idempotency

*For any* list of Job_Postings, applying the deduplication function twice SHALL produce a result of the same size as applying it once; no additional records are removed or added on the second pass.

**Validates: Requirements 7.3**

---

### Property 7: Match Score Boundedness

*For any* job posting and user profile, the overall Match_Score SHALL be within [0, 100]; all component scores (skill_match, experience_match, location_match, salary_match, technology_match) SHALL be within [0, 100].

**Validates: Requirements 8.2**

---

### Property 8: Hard Disqualifier Zero Score

*For any* job posting where work authorization is incompatible with the user's profile, OR where the user's required skill coverage is below 50%, the overall Match_Score SHALL be 0 and the disqualifiers list SHALL be non-empty.

**Validates: Requirements 8.4, 8.5, 8.6**

---

### Property 9: Preferred Company Score Boost

*For any* job posting at a company in the user's preferred companies list, the final overall score SHALL equal the pre-boost score multiplied by 1.2 (before clamping), and SHALL be strictly greater than the score for an equivalent job at a non-preferred company with the same component scores.

**Validates: Requirements 8.3**

---

### Property 10: Resume Optimization Fact Preservation

*For any* base Resume_Version and any job description, the optimized resume produced by the Resume_Optimizer_Agent SHALL contain no work experience, project, certification, skill, or education entry that is not present in the base Resume_Version; the set of skills in the optimized resume SHALL be a subset of the skills in the base Resume_Version.

**Validates: Requirements 9.4, 9.5, 9.6, 9.7**

---

### Property 11: Resume Count Invariant

*For any* base Resume_Version and any job description, the number of work experiences in the optimized resume SHALL equal the number in the base Resume_Version, and the number of projects SHALL equal the number in the base Resume_Version.

**Validates: Requirements 9.5, 9.6**

---

### Property 12: Truthfulness Validation Fallback

*For any* base Resume_Version and optimized resume where the truthfulness validation reports has_fabrications=true, the Resume_Optimizer_Agent SHALL return the original base Resume_Version unchanged for that application submission.

**Validates: Requirements 9.8, 9.9**

---

### Property 13: CAPTCHA and MFA Non-Bypass

*For any* Playwright browser session where a CAPTCHA or MFA prompt is detected at any point, the Application_Agent SHALL produce a result with success=false and requires_manual_intervention=true and SHALL NOT submit the form or advance past the challenge.

**Validates: Requirements 12.5, 12.6, 31.4**

---

### Property 14: Screenshot Capture Invariant

*For any* application attempt that produces a non-trivial outcome (login failure, form error, CAPTCHA, success confirmation, or unexpected page state), the Application_Record SHALL contain at least one screenshot path in SeaweedFS.

**Validates: Requirements 12.7**

---

### Property 15: Browser Session Release Guarantee

*For any* call to the Application_Agent's submit_application function, regardless of whether the application succeeds, fails, encounters an exception, or detects a CAPTCHA, the acquired Playwright browser session SHALL be released back to the pool before the function returns.

**Validates: Requirements 12.11**

---

### Property 16: No Duplicate Applications

*For any* user and any job fingerprint, the count of Application_Records for that (user_id, job_fingerprint) pair in the database SHALL never exceed 1.

**Validates: Requirements 13.1, 13.2**

---

### Property 17: Daily Apply Limit Enforcement

*For any* user on any calendar day, the number of applications submitted by the Application_Agent SHALL not exceed the user's configured daily_apply_limit.

**Validates: Requirements 14.1, 14.2**

---

### Property 18: Email Classification Safe Fallback

*For any* email processed by the Email_Monitor_Agent when the LLM_Provider is unavailable, the email SHALL be classified as type 'other' with confidence 0.0 and no application status update SHALL be triggered.

**Validates: Requirements 16.4**

---

### Property 19: Application Status Transition Audit Trail

*For any* Application_Record, every change to the status field SHALL be accompanied by a new immutable StatusTransition record containing the from status, to status, triggered_by source, and timestamp; the match_score_snapshot field SHALL never be modified after the record is created.

**Validates: Requirements 18.3, 18.4**

---

### Property 20: Interview Prep Question Count

*For any* application for which interview prep is requested, the generated InterviewPrepSheet SHALL contain between 5 and 10 questions (inclusive).

**Validates: Requirements 19.1**

---

### Property 21: Encryption Round-Trip

*For any* plaintext value encrypted using AES-256-GCM with the system's ENCRYPTION_KEY, decrypting the ciphertext SHALL produce a value equal to the original plaintext.

**Validates: Requirements 24.1, 24.3**

---

### Property 22: Data Export Completeness

*For any* user with at least one Application_Record, the ZIP file produced by the data export endpoint SHALL contain: a CSV file with all Application_Records, all resume files associated with that user, all cover letter files, all screenshot files, and a JSON file with the user's profile.

**Validates: Requirements 25.2**

---

### Property 23: Embedding Dimensionality

*For any* non-empty text input passed to the sentence-transformers embedding function using the all-MiniLM-L6-v2 model, the output SHALL be a vector of exactly 384 dimensions.

**Validates: Requirements 27.3**

---

### Property 24: File Storage Round-Trip

*For any* file stored in SeaweedFS, retrieving it using the same key SHALL return byte-for-byte identical content.

**Validates: Requirements 28.2**

---

### Property 25: Platform Rate Limit Compliance

*For any* job source platform and any applicable time window, the total number of requests issued to that platform by all Job_Discovery_Agent workers combined SHALL not exceed the platform's configured Token_Bucket maximum.

**Validates: Requirements 31.1, 31.2, 31.5**

---

### Property 26: API Input Validation

*For any* request to a Backend API endpoint with a body that violates the Pydantic schema for that endpoint, the Backend SHALL return HTTP 422 with field-level error details and SHALL NOT process the request further.

**Validates: Requirements 33.1**

---

### Property 27: Security Headers Presence

*For any* HTTP response from the Backend, the response SHALL include the Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, and Content-Security-Policy headers.

**Validates: Requirements 33.4**
