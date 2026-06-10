-- Add Gmail OAuth token fields to users table
-- Tokens are stored encrypted (AES-256-GCM) via the application layer

ALTER TABLE users
    ADD COLUMN gmail_access_token   TEXT,
    ADD COLUMN gmail_refresh_token  TEXT,
    ADD COLUMN gmail_token_expiry   TIMESTAMPTZ,
    ADD COLUMN gmail_calendar_scope BOOLEAN NOT NULL DEFAULT FALSE;
