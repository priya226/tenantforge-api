# TenantForge API

Backend API for **TenantForge**, a multi-tenant feature-flag and config service. Product teams turn features on or off and change app config for each customer without redeploying, using percentage rollouts, attribute-based rules, versioned changes with rollback, and live updates.

## Design docs

- [High-level design](docs/hld.md): requirements, estimates, architecture, key decisions, flows, roadmap
- [Low-level design](docs/lld.md): code layers, schema, optimistic locking, rollback, APIs, decisions log

## Tech stack

In use now:

- [NestJS](https://nestjs.com/) 12
- TypeScript (strict mode, ES modules)
- [PostgreSQL](https://www.postgresql.org/) 17 with [Flyway](https://flywaydb.org/) migrations, run locally with Docker Compose
- [Vitest](https://vitest.dev/) for tests, [oxlint](https://oxc.rs/) for linting

Planned (see the [roadmap](docs/hld.md#11-roadmap)): Redis (cache + pub/sub), WebSockets (live delivery to SDKs), React and Angular micro-frontend console.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later (npm comes with it)
- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)

## Getting started

```bash
git clone https://github.com/priya226/tenantforge-api.git
cd tenantforge-api
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run seed:admin    # first platform admin, from BOOTSTRAP_ADMIN_* in .env
npm run start:dev
```

Open <http://localhost:3000>. You should see `Hello World!`.

The server listens on port `3000` by default. To use another port, set the `PORT` environment variable.

## Configuration

The app reads its settings from a `.env` file in the project root, loaded by `@nestjs/config`. The file is git-ignored. Copy `.env.example` to create it.

| Variable | Description | Local value |
| --- | --- | --- |
| `DB_HOST` | Postgres host | `localhost` |
| `DB_PORT` | Postgres port | `5433` |
| `DB_USER` | Postgres user | `postgres` |
| `DB_PASSWORD` | Postgres password | must match `POSTGRES_PASSWORD` in `docker-compose.yml` |
| `DB_NAME` | Database name | `tenantforge` |
| `BOOTSTRAP_ADMIN_EMAIL` | Email of the first platform admin (used only by `seed:admin`) | `admin@tenantforge.local` |
| `BOOTSTRAP_ADMIN_PASSWORD` | That admin's password, 12–128 characters (used only by `seed:admin`) | any local value; a real secret elsewhere |
| `BOOTSTRAP_ADMIN_NAME` | Optional display name, default `Platform Admin` | `Platform Admin` |
| `JWT_SECRET` | Signs access tokens (HS256). Long and random; never commit it | generate: `node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"` |
| `JWT_ACCESS_TTL_SECONDS` | Access token lifetime | `900` (15 min) |
| `REFRESH_IDLE_DAYS` | A session ends after this many days without a refresh | `7` |
| `REFRESH_ABSOLUTE_DAYS` | A session ends this many days after login, however active | `30` |

The app fails at startup if any `DB_*` variable is missing. `seed:admin` fails if a required `BOOTSTRAP_ADMIN_*` variable is missing.

### The first platform admin

`npm run seed:admin` creates the first platform admin: a user with no company and the `PLATFORM_ADMIN` role. It does nothing if an active platform admin already exists, so it's safe to run again. It is a seed command, not a migration, for two reasons: the password must never be committed to git, and each environment sets its own admin.

## Database

`docker compose up -d` starts PostgreSQL 17 in a container named `tenantforge-postgres`.

| Setting | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5433` (not the default 5432, so it doesn't clash with a Postgres installed on the machine) |
| User | `postgres` |
| Password | `postgres` |
| Database | `tenantforge` |

These are local development credentials only.

Data is stored in the `pgdata` Docker volume, so it survives `docker compose down`. To wipe the database and start fresh, run `docker compose down -v`.

## API

### Auth

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `{ "email", "password" }` | `200` with `{ "accessToken", "expiresIn", "refreshToken" }`, or `401` "Invalid email or password" |
| `POST` | `/auth/refresh` | `{ "refreshToken" }` | `200` with a new `{ accessToken, expiresIn, refreshToken }`. The old refresh token stops working. `401` if it is unknown, expired, revoked or the user was deleted |
| `POST` | `/auth/logout` | `{ "refreshToken" }` | `204`. Ends that login session (other devices stay logged in). Unknown tokens also get `204` |

- `accessToken` is a JWT valid for `expiresIn` seconds (900). Send it as `Authorization: Bearer <accessToken>`. It holds the user id (`sub`), `companyId` and `roles`.
- `refreshToken` is a random string, not a JWT. The server stores only its SHA-256 hash.
- Each refresh returns a **new** refresh token. Using an old one again is treated as theft and ends the whole session.
- A session ends after 7 days without a refresh, or 30 days after login.
- Wrong email and wrong password get the same `401`, so the API doesn't reveal which emails exist.

### Companies

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/companies` | `{ "name": string, "description"?: string \| null }` | `201` with the created company |
| `GET` | `/companies` | | `200` with all companies that are not deleted, newest first |
| `GET` | `/companies/:id` | | `200` with the company, or `404` |
| `PATCH` | `/companies/:id` | any of `name`, `description` | `200` with the updated company. Only the fields you send change. Send `"description": null` to clear it |
| `DELETE` | `/companies/:id` | | `204`. Soft delete: sets `is_deleted = true` and keeps the row. **Cascades** in one transaction: all users of the company and their role mappings are soft-deleted too, so their emails become free to reuse |

- `name` is required, trimmed, and at most 200 characters.
- Unknown fields in the body are rejected with `400`, so a client can't set fields such as `isDeleted`.
- A malformed `:id` (not a UUID) returns `400` before any database query runs.
- Requires a `PLATFORM_ADMIN` token. Others get `403`; no token gets `401`.

### Users

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/users` | `{ "companyId": uuid, "name": string, "email": string, "password": string, "roles"?: string[] }` | `201` with the created user and its `roles` (never includes the password hash) |
| `GET` | `/users/me` | | `200` with the caller's own user and `roles`. **Any logged-in user**, including `VIEWER`. `404` if the account was deleted after login |
| `GET` | `/users/:id` | | `200` with the user and its `roles`, or `404` |
| `GET` | `/users/:id/roles` | | `200` `{ "roles": [...] }`, or `404` |
| `PUT` | `/users/:id/roles` | `{ "roles": string[] }` | `200` `{ "roles": [...] }`. **Replaces** the whole set: removed roles are soft-deleted, new ones added |

**Roles:** `PLATFORM_ADMIN`, `COMPANY_ADMIN`, `VIEWER`. They are inserted by the V3 migration, and a user can hold several.
- `roles` on create is optional and defaults to `["VIEWER"]`. The user and its roles are saved in one transaction, so there is never a user without a role.
- A user with a company can't be `PLATFORM_ADMIN`, and a user without a company can only be `PLATFORM_ADMIN`. Breaking either rule returns `400`.
- An empty list or an unknown role name returns `400`. If two requests change the same user's roles at once, the loser gets `409`.
- A company must keep at least one `COMPANY_ADMIN` (any number is allowed). Removing that role from the last admin returns `409` "Company must keep at least one admin".

- Each user belongs to one company (`company_id`). The company must exist and not be deleted, otherwise the response is `404`. A `NULL` company is reserved for platform admins, who can't be created through this endpoint.
- `email` is trimmed and lowercased before saving. It must be unique among users that are not deleted, so a duplicate returns `409`.
- `password` must be 12–128 characters, with no rules about symbols or digits, and it is not trimmed. It is stored only as an argon2id hash in `password_hash`. That column is `select: false`, so normal queries never load it.
- Requires a `COMPANY_ADMIN` or `PLATFORM_ADMIN` token (`403` otherwise), except `GET /users/me`.
- A company admin works only inside their own company: another company's user (or company id in `POST /users`) returns `404`, as if it didn't exist. A platform admin works in every company.

### Roles

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/roles` | `200` with the roles that can be assigned: `[{ "name", "description" }]`, sorted by name |

## Database migrations

The schema is managed by [Flyway](https://documentation.red-gate.com/flyway), run from the `flyway/flyway` Docker image. Java is not needed on your machine. Migrations are plain SQL files in `db/migration/`:

```
db/migration/
├─ V1__create_company.sql
├─ V2__create_app_user.sql
├─ V3__create_role_and_user_role.sql   (also inserts the 3 roles)
└─ V4__create_refresh_token.sql        (login sessions; stores only token hashes)
```

- Name files `V<version>__<description>.sql`, with two underscores. Flyway runs them in version order and records each one in the `flyway_schema_history` table, so each file runs only once.
- Never edit a migration that has already been applied. Flyway stores a checksum and refuses to run if an applied file changes. To change the schema, add a new file, for example `V4__add_company_slug.sql`.
- TypeORM never changes the schema (`synchronize: false`). When you change an entity, write the matching migration by hand and keep the column names and types identical.
- The `flyway` service uses the `tools` profile, so `docker compose up` doesn't start it. Run it through the npm scripts.

To open a SQL shell inside the container:

```bash
docker compose exec postgres psql -U postgres -d tenantforge
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | Starts the API and restarts it whenever a file changes |
| `npm run build` | Compiles TypeScript into `dist/` |
| `npm run start:prod` | Runs the compiled app from `dist/` |
| `npm test` | Runs the unit tests once |
| `npm run test:watch` | Re-runs the unit tests whenever a file changes |
| `npm run test:e2e` | Runs the end-to-end tests |
| `npm run lint` | Checks the code with oxlint |
| `npm run format` | Formats the code with Prettier |
| `npm run db:migrate` | Applies pending database migrations with Flyway |
| `npm run db:info` | Lists every migration and whether it has been applied |
| `npm run seed:admin` | Builds the app, then creates the first platform admin from `.env` if none exists |

## Project structure

```
src/
├─ main.ts          Entry point: creates the Nest app and starts the HTTP server
├─ app.module.ts    Root module: config, database, ApiModule
├─ api/             HTTP layer: controllers + the one facade they all call
│  ├─ api.module.ts          Imports the feature modules the facade uses
│  ├─ feature-flag.facade.ts FeatureFlagFacade: the single entry point; calls the right service(s), no business rules
│  ├─ auth/
│  │  ├─ dto/                       Bodies of login, refresh and logout
│  │  ├─ auth.controller.ts         POST /auth/login, /auth/refresh, /auth/logout (public)
│  │  ├─ jwt-auth.guard.ts          Global guard: every route needs a valid access token unless @Public()
│  │  ├─ roles.guard.ts             Global guard: 403 unless the token holds one of the route's @Roles
│  │  ├─ public.decorator.ts        @Public()
│  │  ├─ roles.decorator.ts         @Roles(...)
│  │  └─ current-user.decorator.ts  @CurrentUser(): { userId, companyId, roles } from the token
│  ├─ companies/
│  │  ├─ dto/                     Request bodies with validation rules
│  │  └─ companies.controller.ts  HTTP routes
│  ├─ users/
│  │  ├─ dto/                 Bodies of POST /users and PUT /users/:id/roles
│  │  └─ users.controller.ts  HTTP routes
│  └─ roles/
│     └─ roles.controller.ts  GET /roles
├─ common/
│  ├─ base.entity.ts      Shared columns: id, created_at, updated_at, is_deleted
│  ├─ base.repository.ts  Wraps a TypeORM repository; hides soft-deleted rows; turns Postgres unique violations into UniqueViolationError
│  └─ unique-violation.error.ts  The error services catch for duplicates (instead of a Postgres code)
├─ companies/              Feature module, no controller
│  ├─ companies.service.ts     Company rules only (no database calls, no other features)
│  ├─ company.repository.ts    All database calls for companies
│  ├─ companies.module.ts
│  └─ company.entity.ts   The company table
├─ users/                  Feature module, no controller
│  ├─ users.service.ts     Users only: create (duplicate email, argon2 hash), soft delete by company, verifyCredentials for login
│  ├─ user.repository.ts   All database calls for users; findForLogin is the only query that loads the hash
│  ├─ users.module.ts
│  ├─ user.entity.ts       The app_user table ("user" is a reserved word in Postgres)
│  ├─ normalize-email.ts   Trim + lowercase, used wherever an email is stored or looked up
│  └─ password-policy.ts   Password length rules (12–128), shared by the DTO and seed:admin
├─ roles/                  Feature module, no controller (roles never imports users)
│  ├─ role-name.ts           The 3 role names (must match the rows inserted by V3)
│  ├─ role.entity.ts         The role table
│  ├─ user-role.entity.ts    The user_role mapping table (a user can hold several roles)
│  ├─ role.repository.ts     List roles, look up roles by name
│  ├─ user-role.repository.ts  A user's active role mappings; count users holding a role
│  ├─ roles.service.ts       Company rule, last-admin rule, replace a user's set of roles
│  └─ roles.module.ts
├─ auth/                   Feature module, no controller (tokens only; knows nothing about users or roles)
│  ├─ auth.service.ts              Sign access tokens; start, check, rotate and end refresh-token sessions
│  ├─ jwt.strategy.ts              Checks the Bearer token's HS256 signature and expiry; puts the claims on the request
│  ├─ refresh-token.entity.ts      The refresh_token table (stores only token hashes)
│  ├─ refresh-token.repository.ts  Find by hash, rotate one token, revoke a whole family
│  └─ auth.module.ts               JWT settings (HS256, JWT_SECRET)
├─ seed/
│  └─ seed-admin.ts       npm run seed:admin: starts Nest without HTTP, calls FeatureFlagFacade.ensurePlatformAdmin
└─ database/
   ├─ database.module.ts     TypeORM connection to Postgres, configured from .env
   └─ transaction-runner.ts  Runs a block of work in one DB transaction
db/
└─ migration/             Flyway SQL migrations
```

**Layers:** controller (HTTP) → `FeatureFlagFacade`, one for the whole app (only calls services in order, owns cross-feature transactions, combines results; no business rules) → service (rules for one feature) → repository (database). Feature services never call each other; the facade does. Every controller calls the same facade. Each feature has its own repository that extends `BaseRepository`. Every read adds `is_deleted = false` automatically. Pass `{ includeDeleted: true }` to also get deleted rows. Services never call TypeORM directly.

**Who does what:**

| Layer | Does | Never |
|---|---|---|
| Controller | Routes, DTO validation, `ParseUUIDPipe`, response shape | Call services or repositories |
| `FeatureFlagFacade` | Calls services in order, owns cross-feature transactions, combines results | Business rules, repositories, TypeORM |
| Service | Business rules for one feature: defaults, validation, duplicates (409), 404s, hashing | Call another service, import TypeORM, build queries |
| Repository | All DB access: query operators/options, `is_deleted` filter, Postgres error → `UniqueViolationError` | HTTP errors, business rules (e.g. email normalizing) |

**Transactions:** when several writes must succeed or fail together, a facade (or a service, for writes inside one feature) wraps them in `transactionRunner.run(async (tx) => { ... })` and calls `repository.withTransaction(tx)` for each repository involved. If the block throws, everything is rolled back.

The schema is changed only through Flyway migrations in `db/migration/`. TypeORM's `synchronize` is turned off.

## Design rules

**Modules**
- Feature modules (`companies/`, `users/`, `roles/`) have no controllers and never import each other. They export only their service, never the repository.
- `ApiModule` imports the feature modules, so dependencies only point downwards.
- `roles/` uses a small `RoleHolder { id, companyId }` type instead of importing `User`, so it doesn't depend on `users/`.

**Repositories**
- `BaseRepository` wraps a TypeORM repository instead of extending it. TypeORM's own methods stay private, so nothing can skip the `is_deleted` filter by accident.
- `withTransaction(tx)` returns a copy of the repository that runs its queries inside `tx`.
- Services may use plain field filters (`findOneBy({ id })`), `create` and `save`. Anything with a TypeORM operator or option (`In`, `order`, `select`, relations) gets a named repository method.
- A write that breaks a unique index throws `UniqueViolationError`. The service turns it into 409. This covers two requests racing past the duplicate check.

**Validation**
- The global `ValidationPipe` uses `whitelist`, `forbidNonWhitelisted` and `transform`. Unknown fields are rejected with 400, and bodies become DTO instances.
- DTOs trim names and emails. Passwords are not trimmed.
- Services check the same rules again (email format, password 12–128), because not every caller goes through HTTP (e.g. `seed:admin`).

**Users and passwords**
- Emails are lowercased and trimmed by `UsersService` before they are stored or looked up.
- `password_hash` is `select: false`. `UserRepository.findForLogin` is the only query that loads it, and the hash is removed before a user leaves the service.
- Login runs an argon2 verify even for unknown emails, so response time doesn't reveal which emails have accounts.

**Roles**
- A company can have any number of admins, but never zero. `PUT /users/:id/roles` runs in one transaction: lock the company row (`SELECT … FOR UPDATE`), load the company's user ids, then `RolesService.replaceUserRoles` returns 409 if the change would remove `COMPANY_ADMIN` from the last admin.
- The lock makes role changes in the same company run one after another. Without it, two admins demoting each other at the same moment would both see "another admin exists" and both succeed. Other companies are not blocked.
- Platform users are not locked: they can only hold `PLATFORM_ADMIN`, and a user must keep at least one role.

**Authentication and access**
- Every route needs a valid access token by default (`JwtAuthGuard` is global). Only `@Public()` routes skip it: `/auth/*` and `GET /`.
- `RolesGuard` (also global) runs after it. A route or controller with `@Roles(...)` needs at least one of those roles; a method-level `@Roles` overrides the controller's. Without `@Roles`, any logged-in user may call it.
- Only HS256 tokens signed with `JWT_SECRET` are accepted; `alg: none` and other algorithms are rejected.
- Roles are read from the token, so a role change applies within one access-token lifetime (15 minutes).

| Routes | Roles |
| --- | --- |
| `/auth/*`, `GET /` | public |
| `/companies` | `PLATFORM_ADMIN` |
| `/users` | `COMPANY_ADMIN`, `PLATFORM_ADMIN` |
| `GET /users/me` | any logged-in user (method-level `@Roles` with every role) |
| `/roles` | any logged-in user |

**Tenant scope**
- The caller's company always comes from the token. `AuthService.tenantScope(caller)` turns it into a `TenantScope`: `{ kind: 'company', companyId }` for a company user, `{ kind: 'all' }` for a platform admin.
- The facade passes that scope to the services, and the services put it into the query (`WHERE id = ? AND company_id = ?`). A row in another company is simply not found, so the answer is `404`, not `403`: the API doesn't reveal that it exists.
- Every new company-owned feature (flags, settings, audit) takes a `TenantScope` the same way.

**Deleting a company**
- `FeatureFlagFacade.removeCompany` soft-deletes the company, its users and their role mappings in one transaction.
- When a new feature owns company data (flags, API keys, settings), its cleanup step is added there.

## Project status

Milestone 1 is in progress. The NestJS project is set up and connected to a local PostgreSQL database through TypeORM, with Flyway managing the schema. Working end to end: the companies API (CRUD with soft delete), the users API (one company per user, argon2-hashed passwords), roles (a user can hold several; managed through `/users/:id/roles`; `GET /roles`; a company always keeps at least one admin), and `seed:admin` for the first platform admin. Authentication: login, refresh (rotating refresh tokens with reuse detection) and logout, with a global JWT guard and role checks on every route. Tenant scoping: company admins only see and change users of their own company. `GET /users/me` for every logged-in user. Next: the rest of the users API, then flags and config with versioning, optimistic locking (409), audit and rollback. See the [roadmap](docs/hld.md#11-roadmap).
