-- Enable pgvector extension for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- Users (auth)
-- ─────────────────────────────────────────────

CREATE TABLE users (
    id            TEXT        NOT NULL PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Profiles
-- ─────────────────────────────────────────────

CREATE TABLE profiles (
    id                      TEXT        NOT NULL PRIMARY KEY,
    user_id                 TEXT        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Personal Information
    full_name               TEXT        NOT NULL,
    email                   TEXT        NOT NULL,
    phone                   TEXT,                    -- encrypted
    location                TEXT        NOT NULL,
    linkedin_url            TEXT,
    github_url              TEXT,
    portfolio_url           TEXT,
    website_url             TEXT,

    -- Work Authorization
    work_authorization      TEXT[]      NOT NULL DEFAULT '{}',
    requires_sponsorship    BOOLEAN     NOT NULL DEFAULT FALSE,
    notice_period           INTEGER     NOT NULL DEFAULT 0,

    -- Job Preferences
    remote_preference       TEXT        NOT NULL DEFAULT 'flexible',
    target_roles            TEXT[]      NOT NULL DEFAULT '{}',
    preferred_locations     TEXT[]      NOT NULL DEFAULT '{}',
    salary_min              TEXT,                    -- encrypted
    salary_max              TEXT,                    -- encrypted
    currency                TEXT        NOT NULL DEFAULT 'USD',
    employment_types        TEXT[]      NOT NULL DEFAULT '{}',
    excluded_companies      TEXT[]      NOT NULL DEFAULT '{}',
    preferred_companies     TEXT[]      NOT NULL DEFAULT '{}',
    target_industries       TEXT[]      NOT NULL DEFAULT '{}',
    target_company_sizes    TEXT[]      NOT NULL DEFAULT '{}',
    daily_apply_limit       INTEGER     NOT NULL DEFAULT 10,
    auto_pause_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    cover_letter_review_mode TEXT       NOT NULL DEFAULT 'auto',

    -- Portal credentials (encrypted)
    portal_credentials      TEXT,                    -- encrypted

    -- Metadata
    profile_completeness    INTEGER     NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Work Experiences
-- ─────────────────────────────────────────────

CREATE TABLE work_experiences (
    id          TEXT        NOT NULL PRIMARY KEY,
    profile_id  TEXT        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company     TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    location    TEXT,
    start_date  TIMESTAMPTZ NOT NULL,
    end_date    TIMESTAMPTZ,
    is_current  BOOLEAN     NOT NULL DEFAULT FALSE,
    description TEXT,
    bullets     TEXT[]      NOT NULL DEFAULT '{}',
    skills      TEXT[]      NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Education
-- ─────────────────────────────────────────────

CREATE TABLE educations (
    id          TEXT        NOT NULL PRIMARY KEY,
    profile_id  TEXT        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    institution TEXT        NOT NULL,
    degree      TEXT        NOT NULL,
    field       TEXT,
    start_date  TIMESTAMPTZ NOT NULL,
    end_date    TIMESTAMPTZ,
    gpa         DOUBLE PRECISION,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────

CREATE TABLE projects (
    id          TEXT        NOT NULL PRIMARY KEY,
    profile_id  TEXT        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    description TEXT,
    url         TEXT,
    repo_url    TEXT,
    skills      TEXT[]      NOT NULL DEFAULT '{}',
    start_date  TIMESTAMPTZ,
    end_date    TIMESTAMPTZ,
    is_current  BOOLEAN     NOT NULL DEFAULT FALSE,
    highlights  TEXT[]      NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Skills
-- ─────────────────────────────────────────────

CREATE TABLE skills (
    id          TEXT        NOT NULL PRIMARY KEY,
    profile_id  TEXT        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    category    TEXT,
    proficiency TEXT,
    years_of_exp DOUBLE PRECISION,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Certifications
-- ─────────────────────────────────────────────

CREATE TABLE certifications (
    id             TEXT        NOT NULL PRIMARY KEY,
    profile_id     TEXT        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    issuer         TEXT,
    issue_date     TIMESTAMPTZ,
    expiry_date    TIMESTAMPTZ,
    credential_id  TEXT,
    credential_url TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Resume Versions
-- ─────────────────────────────────────────────

CREATE TABLE resume_versions (
    id             TEXT        NOT NULL PRIMARY KEY,
    user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT        NOT NULL,
    specialization TEXT        NOT NULL,
    file_url       TEXT        NOT NULL,
    file_hash      TEXT        NOT NULL,
    is_default     BOOLEAN     NOT NULL DEFAULT FALSE,
    usage_count    INTEGER     NOT NULL DEFAULT 0,
    last_used_at   TIMESTAMPTZ,
    success_rate   DOUBLE PRECISION,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Job Postings
-- ─────────────────────────────────────────────

CREATE TABLE job_postings (
    id                   TEXT        NOT NULL PRIMARY KEY,
    external_id          TEXT,
    source_url           TEXT        NOT NULL,
    platform             TEXT        NOT NULL,
    fingerprint          TEXT        NOT NULL UNIQUE,

    -- Extracted fields
    company              TEXT        NOT NULL,
    title                TEXT        NOT NULL,
    description          TEXT        NOT NULL,
    description_html     TEXT,
    required_skills      TEXT[]      NOT NULL DEFAULT '{}',
    preferred_skills     TEXT[]      NOT NULL DEFAULT '{}',
    years_experience_min INTEGER,
    years_experience_max INTEGER,
    location             TEXT[]      NOT NULL DEFAULT '{}',
    is_remote            BOOLEAN     NOT NULL DEFAULT FALSE,
    is_hybrid            BOOLEAN     NOT NULL DEFAULT FALSE,
    salary_min           DOUBLE PRECISION,
    salary_max           DOUBLE PRECISION,
    currency             TEXT,
    employment_type      TEXT,
    visa_requirements    TEXT[]      NOT NULL DEFAULT '{}',
    application_deadline TIMESTAMPTZ,
    application_url      TEXT        NOT NULL,
    ats_type             TEXT,

    -- Processing metadata
    discovered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parsed_at            TIMESTAMPTZ,

    -- pgvector embedding (384 dimensions)
    embedding            vector(384),

    raw_data             JSONB       NOT NULL DEFAULT '{}',
    status               TEXT        NOT NULL DEFAULT 'new'
);

-- Indexes on job_postings
CREATE INDEX idx_job_postings_fingerprint ON job_postings(fingerprint);
CREATE INDEX idx_job_postings_status ON job_postings(status);
CREATE INDEX idx_job_postings_platform ON job_postings(platform);
CREATE INDEX idx_job_postings_discovered_at ON job_postings(discovered_at);

-- IVFFlat index for cosine similarity search on embeddings
CREATE INDEX idx_job_postings_embedding
    ON job_postings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ─────────────────────────────────────────────
-- Job Matches
-- ─────────────────────────────────────────────

CREATE TABLE job_matches (
    id              TEXT            NOT NULL PRIMARY KEY,
    user_id         TEXT            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_posting_id  TEXT            NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,

    overall              DOUBLE PRECISION NOT NULL,
    skill_match          DOUBLE PRECISION NOT NULL,
    experience_match     DOUBLE PRECISION NOT NULL,
    location_match       DOUBLE PRECISION NOT NULL,
    salary_match         DOUBLE PRECISION NOT NULL,
    technology_match     DOUBLE PRECISION NOT NULL,
    work_auth_match      BOOLEAN          NOT NULL,
    success_probability  DOUBLE PRECISION NOT NULL,
    disqualifiers        JSONB            NOT NULL DEFAULT '[]',

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_job_matches_user_job UNIQUE (user_id, job_posting_id)
);

CREATE INDEX idx_job_matches_user_id ON job_matches(user_id);
CREATE INDEX idx_job_matches_overall ON job_matches(user_id, overall DESC);

-- ─────────────────────────────────────────────
-- Application Records
-- ─────────────────────────────────────────────

CREATE TABLE application_records (
    id                    TEXT        NOT NULL PRIMARY KEY,
    user_id               TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_posting_id        TEXT        NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,

    applied_at            TIMESTAMPTZ NOT NULL,
    source                TEXT        NOT NULL,
    application_url       TEXT        NOT NULL,
    resume_version_id     TEXT        NOT NULL REFERENCES resume_versions(id),
    cover_letter_path     TEXT,

    -- Status tracking
    status                TEXT        NOT NULL DEFAULT 'draft',

    -- Automation metadata
    automation_session_id TEXT,
    screenshot_paths      TEXT[]      NOT NULL DEFAULT '{}',
    confirmation_number   TEXT,
    form_answers_snapshot JSONB       NOT NULL DEFAULT '{}',
    fingerprint           TEXT        NOT NULL,

    -- Results
    rejection_reason      TEXT,
    notes                 TEXT        NOT NULL DEFAULT '',
    match_score_snapshot  JSONB       NOT NULL DEFAULT '{}',

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_application_records_user_fingerprint UNIQUE (user_id, fingerprint)
);

CREATE INDEX idx_application_records_user_status ON application_records(user_id, status);
CREATE INDEX idx_application_records_applied_at ON application_records(applied_at);
CREATE INDEX idx_application_records_job_posting ON application_records(job_posting_id);

-- ─────────────────────────────────────────────
-- Status Transitions
-- ─────────────────────────────────────────────

CREATE TABLE status_transitions (
    id                    TEXT        NOT NULL PRIMARY KEY,
    application_record_id TEXT        NOT NULL REFERENCES application_records(id) ON DELETE CASCADE,
    "from"                TEXT        NOT NULL,
    "to"                  TEXT        NOT NULL,
    triggered_by          TEXT        NOT NULL,
    "timestamp"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note                  TEXT
);

CREATE INDEX idx_status_transitions_application ON status_transitions(application_record_id);

-- ─────────────────────────────────────────────
-- Agent Tasks
-- ─────────────────────────────────────────────

CREATE TABLE agent_tasks (
    id           TEXT        NOT NULL PRIMARY KEY,
    type         TEXT        NOT NULL,
    user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload      JSONB       NOT NULL DEFAULT '{}',
    priority     TEXT        NOT NULL DEFAULT 'normal',
    status       TEXT        NOT NULL DEFAULT 'queued',
    attempts     INTEGER     NOT NULL DEFAULT 0,
    max_attempts INTEGER     NOT NULL DEFAULT 3,
    last_error   TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_user_status ON agent_tasks(user_id, status);
CREATE INDEX idx_agent_tasks_scheduled_at ON agent_tasks(scheduled_at);

-- ─────────────────────────────────────────────
-- Notifications
-- ─────────────────────────────────────────────

CREATE TABLE notifications (
    id         TEXT        NOT NULL PRIMARY KEY,
    user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    title      TEXT        NOT NULL,
    body       TEXT        NOT NULL,
    metadata   JSONB       NOT NULL DEFAULT '{}',
    is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at    TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- ─────────────────────────────────────────────
-- Job Source Configuration
-- ─────────────────────────────────────────────

CREATE TABLE job_source_configs (
    id                 TEXT        NOT NULL PRIMARY KEY,
    user_id            TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform           TEXT        NOT NULL,
    enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
    config             JSONB       NOT NULL DEFAULT '{}',
    last_run_at        TIMESTAMPTZ,
    last_run_status    TEXT        NOT NULL DEFAULT 'never_run',
    last_run_jobs_found INTEGER    NOT NULL DEFAULT 0,
    error_message      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_source_configs_user ON job_source_configs(user_id, platform);

-- ─────────────────────────────────────────────
-- LLM Cache
-- ─────────────────────────────────────────────

CREATE TABLE llm_cache (
    id          TEXT        NOT NULL PRIMARY KEY,
    prompt_hash TEXT        NOT NULL UNIQUE,
    response    TEXT        NOT NULL,
    model       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX idx_llm_cache_expires_at ON llm_cache(expires_at);

-- ─────────────────────────────────────────────
-- Interview Prep Sheets
-- ─────────────────────────────────────────────

CREATE TABLE interview_prep_sheets (
    id                   TEXT        NOT NULL PRIMARY KEY,
    application_id       TEXT        NOT NULL UNIQUE REFERENCES application_records(id) ON DELETE CASCADE,
    behavioral_questions JSONB       NOT NULL DEFAULT '[]',
    technical_questions  JSONB       NOT NULL DEFAULT '[]',
    company_summary      TEXT        NOT NULL,
    role_specific_tips   JSONB       NOT NULL DEFAULT '[]',
    generated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Reusable Screening Answers
-- ─────────────────────────────────────────────

CREATE TABLE reusable_answers (
    id            TEXT        NOT NULL PRIMARY KEY,
    user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_type TEXT        NOT NULL,
    answer        TEXT        NOT NULL,
    usage_count   INTEGER     NOT NULL DEFAULT 0,
    last_used_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_reusable_answers_user_question UNIQUE (user_id, question_type)
);
