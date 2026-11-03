-- Feature flags. Each flag belongs to one company and is identified by its key inside that company.
-- version starts at 1 and goes up by one on every change; an update must send the version it read.
-- Rollout: PERCENT gives the flag to rollout_value % of users; COUNT gives it to the first rollout_value users.
CREATE TABLE feature_flag (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID        NOT NULL REFERENCES company (id),
    key           VARCHAR(64) NOT NULL,
    description   TEXT,
    enabled       BOOLEAN     NOT NULL DEFAULT false,
    rollout_type  VARCHAR(10) NOT NULL DEFAULT 'PERCENT',
    rollout_value INTEGER     NOT NULL DEFAULT 100,
    rules         JSONB       NOT NULL DEFAULT '[]',
    version       INTEGER     NOT NULL DEFAULT 1,
    is_deleted    BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT ck_feature_flag_key CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
    CONSTRAINT ck_feature_flag_rollout CHECK (
        (rollout_type = 'PERCENT' AND rollout_value BETWEEN 0 AND 100)
        OR (rollout_type = 'COUNT' AND rollout_value BETWEEN 1 AND 10000)
    ),
    CONSTRAINT ck_feature_flag_rules_array CHECK (
        jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) <= 50
    ),
    -- Every rule is {"attribute": non-empty text, "value": non-empty text, "percent": whole number 0-100}.
    CONSTRAINT ck_feature_flag_rules_shape CHECK (NOT jsonb_path_exists(rules,
        '$[*] ? (!exists(@.attribute ? (@.type() == "string" && @ != ""))
              || !exists(@.value ? (@.type() == "string" && @ != ""))
              || !exists(@.percent ? (@.type() == "number" && @ >= 0 && @ <= 100 && @ == @.floor())))')),
    -- Attribute rules only apply to PERCENT rollouts.
    CONSTRAINT ck_feature_flag_count_without_rules CHECK (rollout_type = 'PERCENT' OR rules = '[]'),
    CONSTRAINT ck_feature_flag_version CHECK (version >= 1)
);

-- One active flag per key in a company; a deleted flag's key can be used again.
-- Also serves "all flags of a company" (company_id is the first column).
CREATE UNIQUE INDEX uq_feature_flag_company_key_active
    ON feature_flag (company_id, key)
    WHERE is_deleted = false;

-- Append-only history of every change to a flag (later also settings), with full before/after snapshots.
-- before_json is NULL for CREATE, after_json is NULL for DELETE. Snapshots are what rollback restores.
CREATE TABLE audit_event (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES company (id),
    user_id     UUID        NOT NULL REFERENCES app_user (id),
    entity_type VARCHAR(20) NOT NULL,
    entity_id   UUID        NOT NULL,
    version     INTEGER     NOT NULL,
    action      VARCHAR(20) NOT NULL,
    before_json JSONB,
    after_json  JSONB,
    is_deleted  BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT ck_audit_event_entity_type CHECK (entity_type IN ('FLAG', 'SETTING')),
    CONSTRAINT ck_audit_event_action CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'ROLLBACK')),
    CONSTRAINT ck_audit_event_snapshots CHECK (
        (action = 'CREATE' AND before_json IS NULL AND after_json IS NOT NULL)
        OR (action = 'DELETE' AND before_json IS NOT NULL AND after_json IS NULL)
        OR (action IN ('UPDATE', 'ROLLBACK') AND before_json IS NOT NULL AND after_json IS NOT NULL)
    )
);

-- Exactly one audit row per entity version; also the index for "history of this flag, by version".
CREATE UNIQUE INDEX uq_audit_event_entity_version
    ON audit_event (entity_type, entity_id, version);

-- "Recent changes in my company".
CREATE INDEX ix_audit_event_company_created
    ON audit_event (company_id, created_at DESC);
