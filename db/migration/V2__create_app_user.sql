-- Platform users. Each user belongs to exactly one company.
-- company_id is NULL only for platform admins, who manage all companies and belong to none.
CREATE TABLE app_user (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID         REFERENCES company (id),
    name          VARCHAR(200) NOT NULL,
    email         VARCHAR(254) NOT NULL,
    password_hash TEXT         NOT NULL,
    is_deleted    BOOLEAN      NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The app lowercases and trims emails before saving. This rejects any row that skipped that step.
    CONSTRAINT ck_app_user_email_normalized CHECK (email = lower(trim(email)))
);

-- One active account per email across the whole platform, so login needs only email + password.
-- Soft-deleted users don't count, so their email can be used again.
-- This index also makes the login lookup (WHERE email = ? AND is_deleted = false) fast.
CREATE UNIQUE INDEX uq_app_user_email_active
    ON app_user (email)
    WHERE is_deleted = false;

-- Postgres does not index foreign keys automatically. This speeds up "all users of a company".
CREATE INDEX ix_app_user_company_id
    ON app_user (company_id);
