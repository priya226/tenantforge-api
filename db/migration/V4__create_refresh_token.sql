-- Refresh tokens for logged-in sessions. Only the SHA-256 of the token is stored, never the token itself.
-- All tokens rotated from one login share a family_id.
CREATE TABLE refresh_token (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES app_user (id),
    family_id         UUID        NOT NULL,
    token_hash        CHAR(64)    NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    family_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    replaced_by_id    UUID        REFERENCES refresh_token (id),
    is_deleted        BOOLEAN     NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT ck_refresh_token_expiry CHECK (expires_at <= family_expires_at)
);

-- Not partial: a revoked token must still be found, so a replayed one can be detected.
CREATE UNIQUE INDEX uq_refresh_token_hash ON refresh_token (token_hash);

CREATE INDEX ix_refresh_token_user_id ON refresh_token (user_id);

CREATE INDEX ix_refresh_token_family_id ON refresh_token (family_id);
