-- Roles a user can hold. The rows are fixed: they are inserted here, and there is no API to add roles,
-- because code checks roles by name and a new role would do nothing without code changes.
CREATE TABLE role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    description TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_role_name_active ON role (name) WHERE is_deleted = false;

INSERT INTO role (name, description) VALUES
    ('PLATFORM_ADMIN', 'Runs the TenantForge platform; belongs to no company'),
    ('COMPANY_ADMIN', 'Manages one company''s flags, settings and users'),
    ('VIEWER', 'Read-only access to one company''s flags and history');

-- Mapping table: which user holds which role. A user can hold several roles.
-- No company_id: the company comes from app_user.company_id.
CREATE TABLE user_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user (id),
    role_id UUID NOT NULL REFERENCES role (id),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A user can't hold the same role twice (removed mappings are soft-deleted, so they don't count).
-- user_id comes first, so this index also serves "all roles of user X" lookups.
CREATE UNIQUE INDEX uq_user_role_active ON user_role (user_id, role_id) WHERE is_deleted = false;
