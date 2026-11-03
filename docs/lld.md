# TenantForge: Low-Level Design

Schema, APIs, code structure and the decisions behind them. The big picture is in [hld.md](hld.md).

---

## 1. Code layers

```
HTTP request
  → Controller          src/api/<resource>/       routes, DTO validation, response shape
  → FeatureFlagFacade   src/api/                  one facade; calls services in order, owns cross-feature transactions
  → Service             src/<feature>/            business rules for one feature
  → Repository          src/<feature>/            all database access
  → PostgreSQL
```

| Layer | Does | Never |
| --- | --- | --- |
| Controller | Routes, DTOs, `ParseUUIDPipe`, response shape | Call services or repositories |
| FeatureFlagFacade | Calls services in order, runs one transaction when several features change, combines results | Business rules, repositories, TypeORM |
| Service | Defaults, validation, normalizing, 404/409, hashing | Call another service, import TypeORM, build queries |
| Repository | Query operators/options, `is_deleted` filter, Postgres error → `UniqueViolationError` | HTTP errors, business rules |

- Feature modules (`companies`, `users`, `roles`, later `flags`, `settings`, `audit`, `api-keys`) have no controllers and never import each other. They export only their service.
- `ApiModule` imports the feature modules, so dependencies point one way.
- Every repository extends `BaseRepository`, which adds `is_deleted = false` to reads unless `{ includeDeleted: true }` is passed.
- Transactions are explicit: `transactionRunner.run(async (tx) => …)` and `repository.withTransaction(tx)`.

## 2. Schema

Every table has the base columns `id UUID`, `created_at`, `updated_at` (TIMESTAMPTZ, UTC) and `is_deleted BOOLEAN`. Names are singular snake_case. Flyway owns the schema (`db/migration/V<n>__*.sql`); TypeORM runs with `synchronize: false`.

### Built

```
company(name VARCHAR(200), description TEXT NULL)                          -- V1

app_user(company_id NULL → company, name, email, password_hash)            -- V2
    -- one company per user; company_id NULL = platform admin
    -- email trimmed + lowercased (CHECK), unique among active rows (partial index)
    -- password_hash argon2id, select: false in the entity

role(name VARCHAR(50), description TEXT)                                   -- V3
    -- rows: PLATFORM_ADMIN, COMPANY_ADMIN, VIEWER; name unique among active rows

user_role(user_id → app_user, role_id → role)                              -- V3
    -- a user can hold several roles; UNIQUE (user_id, role_id) WHERE is_deleted = false

refresh_token(user_id → app_user, family_id, token_hash CHAR(64),          -- V4
              expires_at, family_expires_at, revoked_at NULL,
              replaced_by_id NULL → refresh_token)
    -- token_hash = SHA-256 hex of the raw token; the raw token is never stored
    -- family_id groups every token rotated from one login
    -- CHECK (expires_at <= family_expires_at)
    -- UNIQUE (token_hash), not partial: revoked rows must stay findable to detect reuse
    -- indexes on user_id and family_id
```

### Planned

```
api_key(company_id → company, key_hash, revoked_at NULL)

feature_flag(company_id → company, key, description, enabled, default_percent, version INT)
    -- UNIQUE (company_id, key) WHERE is_deleted = false

feature_flag_rule(flag_id → feature_flag, attribute, value, percent)

company_setting(company_id → company, key, value_json JSONB, version INT)
    -- UNIQUE (company_id, key) WHERE is_deleted = false

audit_event(company_id, user_id, entity_type ('FLAG' | 'SETTING'), entity_id,
            version INT, action, before_json JSONB, after_json JSONB)
    -- append-only; full snapshots; history + rollback for flags and settings
```

Every flag, setting and audit query filters by `company_id`, enforced in one place so a new endpoint can't forget it.

## 3. Optimistic locking (flags and settings)

```sql
UPDATE feature_flag
SET enabled = $1, version = version + 1, updated_at = now()
WHERE id = $2 AND company_id = $3 AND version = $expectedVersion AND is_deleted = false
```
- 0 rows updated → the row changed since the client read it → **409 "changed by someone else"** (or 404 if it doesn't exist).
- The update and the `audit_event` insert run in one transaction.
- `company_setting` works the same way.

## 4. Rollback

1. Load the audit row for `(entity_type, entity_id, toVersion)`.
2. Apply its `after_json` as a normal update with the current version as `expectedVersion`.
3. That writes a new version and a new audit row with `action = 'ROLLBACK'`.
4. Then cache update, publish and push, as for any change.

## 5. APIs

| Method and path | Who | Purpose | Status |
| --- | --- | --- | --- |
| `POST/GET/PATCH/DELETE /companies[/{id}]` | Platform admin | Company CRUD; delete cascades to users and roles | Built |
| `POST /users` | Company admin, platform admin | Create a user (optional `roles[]`, default VIEWER) | Built |
| `GET /users/{id}` | Company admin, platform admin | User with roles | Built |
| `GET/PUT /users/{id}/roles` | Company admin, platform admin | Read / replace a user's roles | Built |
| `GET /roles` | Any user | Roles that can be assigned | Built |
| `POST /auth/login` | Anyone | Email + password → access token + refresh token | Built |
| `POST /auth/refresh` | Anyone with a refresh token | Rotate: new access token + new refresh token | Built |
| `POST /auth/logout` | Anyone with a refresh token | Revoke the session (token family) | Built |
| `GET /users/me` | Any user | Own record with roles | Next |
| `GET /users?q=&companyId=&limit=&offset=` | Company admin (own company), platform admin (all) | Paged search, `{ items, total }` | After auth |
| `PATCH/DELETE /users/{id}` | Company admin | Rename, delete | After auth |
| `GET/POST /flags`, `PUT/DELETE /flags/{key}` | Admin (viewer: read) | Flags; `PUT` takes `expectedVersion` | Planned |
| `POST /flags/{key}/rollback` | Admin | Roll back to a version | Planned |
| `GET/PUT /settings/{key}` | Admin (viewer: read) | Config; `PUT` takes `expectedVersion` | Planned |
| `POST /settings/{key}/rollback` | Admin | Roll back to a version | Planned |
| `GET /audit?type=&key=&user=&from=&to=` | Admin, viewer | History | Planned |
| `GET /sdk/flags?sinceVersion=`, `GET /sdk/config` | SDK (API key) | Bootstrap and polling | Planned |
| `WS /sdk/stream` | SDK (API key) | Live changes for the key's company | Planned |

### Error mapping

| Case | Status |
| --- | --- |
| DTO validation, bad UUID, role not allowed for the user | 400 |
| Not logged in / wrong company or role | 401 / 403 |
| Missing or soft-deleted row | 404 |
| Duplicate (email, flag key), stale `expectedVersion`, removing the last company admin | 409 |

## 6. Users, roles and auth

- PLATFORM_ADMIN is only for users without a company. COMPANY_ADMIN and VIEWER are only for users with one. The service enforces this (400).
- A company keeps at least one COMPANY_ADMIN (no upper limit). Role changes lock the company row (`SELECT … FOR UPDATE`) in the same transaction as the check, so two simultaneous demotions can't both pass; the second gets 409.
- The 3 roles are seeded by Flyway V3 and looked up by name; there is no role-creation API.
- The first platform admin is created by `npm run seed:admin` from env vars. It is idempotent and not a migration, so no secret ever lands in git.
- Passwords: argon2id, 12–128 characters, no composition rules. Login verifies against a dummy hash for unknown emails, so timing doesn't reveal which accounts exist.

### Tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Format | JWT, HS256, signed with `JWT_SECRET` | 32 random bytes, base64url; not a JWT |
| Contents | `sub` (user id), `companyId` (null for platform admin), `roles`, `iat`, `exp` | Nothing; a random key |
| Lifetime | 15 minutes | 7 days idle, 30 days absolute |
| Stored | Nowhere; checked by signature | Only its SHA-256 hash, in `refresh_token` |
| Sent on | Every request: `Authorization: Bearer …` | Only `/auth/refresh` and `/auth/logout` (JSON body) |

- No email or name in the JWT: anyone holding a token can read it, and the user id is enough.
- `companyId` for tenant scoping is always read from the token, never from the request. Only a platform admin may filter by a `companyId` query parameter.
- Login returns `{ accessToken, expiresIn, refreshToken }`. Login creates a new family: `family_expires_at = now + 30 days`, `expires_at = min(now + 7 days, family_expires_at)`.
- `POST /auth/refresh`:
  1. Hash the token and find the row. Not found → 401.
  2. Already revoked → reuse: revoke every token in the family → 401.
  3. Expired → 401.
  4. User or their company deleted → 401.
  5. One transaction: revoke the row, insert the next token (same family, `family_expires_at` copied, `expires_at = min(now + 7 days, family_expires_at)`, `replaced_by_id` set), and return a new access token with roles reloaded from the database.
- Logout revokes the whole family.
- `AuthService` handles tokens only. `FeatureFlagFacade` coordinates:
  - login: `UsersService.verifyCredentials` → `RolesService.getUserRoles` → `AuthService.startSession`
  - refresh: `AuthService.findSession` → `UsersService.findActive` (deleted user → session ended) → `RolesService.getUserRoles` → `AuthService.rotate`
  - A deleted company soft-deletes its users, so the user check also covers a deleted company.
- Rotation inserts the new token, then revokes the old one with `UPDATE … WHERE revoked_at IS NULL` in the same transaction. If another refresh already rotated it (0 rows), the transaction rolls back and the family is revoked.
- Wrong email and wrong password both return the same 401 message.
- A role change takes effect when the current access token expires (at most 15 minutes).
- Every route needs a valid access token: `JwtAuthGuard` (passport-jwt, HS256 only) is a global guard; `@Public()` opts out (`/auth/*`, `GET /`). `RolesGuard` is global too: `@Roles(...)` on a controller or method requires one of those roles (403 otherwise); method-level overrides class-level; no `@Roles` = any logged-in user. `@CurrentUser()` gives `{ userId, companyId, roles }`.
- Company admins are not yet limited to their own company's users (next step: tenant scoping).
- Client rules:
  - Refresh only when a request needs it: the token has expired or is about to, or a request returned 401. Never on a timer, so an idle open tab still expires after 7 days.
  - Run only one refresh at a time. Two parallel refreshes with the same token would look like reuse and end the session.

## 7. Decisions log

| Decision | Rejected alternative and why |
| --- | --- |
| Flags, API keys and roles are company-wide; no application level inside a company. | Per-application flags: more complex than needed. |
| One company per user (`app_user.company_id`). | Multi-company users: harder login and tenant scoping. |
| Email globally unique, stored lowercased. | Unique per company: one email could log into several companies. |
| argon2id, 12–128 chars, no composition rules (NIST). | bcrypt (older); symbol/digit rules (don't add strength). |
| Roles via a mapping table (`role` + `user_role`). | A single role column: one role per user. |
| Roles seeded by Flyway, looked up by name. | `POST /roles`: a new role does nothing until code checks for it. |
| Role/company fit enforced in the service. | DB trigger: hidden logic; a CHECK can't look across tables. |
| `POST /users` roles optional, default VIEWER; user + roles in one transaction. | Required roles; or no roles on create. |
| First admin via `seed:admin` command and env vars. | Migration (password hash in git, same login everywhere); creating on startup (side effect on every boot). |
| Explicit transactions (`TransactionRunner` + `withTransaction`). | CLS-based hidden transactions: less visible. |
| Deleting a company soft-deletes everything it owns, in one transaction. | Blocking the delete while users exist. |
| One `FeatureFlagFacade` above feature services; it holds no business rules. | One facade per resource (more files for no gain); deletion hooks (flow hidden across modules); services calling each other (circular modules). |
| Auth is built before list/rename/delete users, so those endpoints are token-scoped from the start. | Query-param scoping first, replaced later. |
| JWT claims: `sub`, `companyId`, `roles`; no email or name. | Email as a claim: readable by anyone holding the token, goes stale. |
| Short access token plus a rotating refresh token; roles in the JWT. | Roles loaded from the DB on every request (extra query each time); one long-lived token. |
| Refresh token is an opaque random string; only its SHA-256 is stored, in Postgres. | Refresh token as a JWT (can't be revoked without a table anyway); argon2 for it (salted, so no indexed lookup; not needed for 256-bit random values); Redis storage (a flush logs everyone out). |
| Rotation with reuse detection: a revoked token used again revokes the whole family. | No rotation: a stolen token works until it expires. |
| Expiry: 7 days idle (sliding) and 30 days absolute, as `expires_at = min(now + 7d, family_expires_at)`. | Sliding only (an active session never ends); absolute only (active users logged out every 7 days). A separate session table (only needed for an active-sessions screen). |
| Tenant scope comes from the token; VIEWER sees only `/users/me`, COMPANY_ADMIN lists own company, PLATFORM_ADMIN lists all. | `companyId` from the request for everyone. |
| Repositories own all query details and translate DB errors (`UniqueViolationError`). | Services building TypeORM queries and checking Postgres codes. |
| Last company admin protected (409); company row locked `FOR UPDATE` during role changes. | Count check only (two demotions at once leave zero admins); SERIALIZABLE isolation with retries (more moving parts). |
| Optimistic locking with `version` + `expectedVersion`. | Pessimistic locks held during an edit. |
| Audit in the same transaction, full snapshots, rollback as a new change. | Async audit; diffs only; deleting newer versions. |
| Flags and settings share one versioning/audit/rollback mechanism. | Separate history tables per entity. |
| `PATCH /users/{id}` changes name only until email verification exists. | Email change without verification. |
| Flyway owns the schema; never edit an applied migration. | TypeORM `synchronize` / generated migrations. |
| Soft delete on every table; timestamps in UTC. | Hard deletes; local times. |
