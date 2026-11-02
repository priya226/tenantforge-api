# TenantForge API

Backend API for **TenantForge**, a multi-tenant feature flag service. Product teams turn features on or off for each customer without redeploying, using percentage rollouts and attribute-based rules.

## Tech stack

- [NestJS](https://nestjs.com/) 12
- TypeScript (strict mode, ES modules)
- [PostgreSQL](https://www.postgresql.org/) 17, run locally with Docker Compose
- [Vitest](https://vitest.dev/) for tests, [oxlint](https://oxc.rs/) for linting

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

The app fails at startup if any of these variables is missing.

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

### Companies

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/companies` | `{ "name": string, "description"?: string \| null }` | `201` with the created company |
| `GET` | `/companies` | | `200` with all companies that are not deleted, newest first |
| `GET` | `/companies/:id` | | `200` with the company, or `404` |
| `PATCH` | `/companies/:id` | any of `name`, `description` | `200` with the updated company. Only the fields you send change. Send `"description": null` to clear it |
| `DELETE` | `/companies/:id` | | `204`. Soft delete: sets `is_deleted = true` and keeps the row |

- `name` is required, trimmed, and at most 200 characters.
- Unknown fields in the body are rejected with `400`, so a client can't set fields such as `isDeleted`.
- A malformed `:id` (not a UUID) returns `400` before any database query runs.
- These endpoints have no authentication yet. Later, only platform admins will be able to use them.

### Users

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/users` | `{ "companyId": uuid, "name": string, "email": string, "password": string }` | `201` with the created user (never includes the password hash) |
| `GET` | `/users/:id` | | `200` with the user, or `404` |

- Each user belongs to one company (`company_id`). The company must exist and not be deleted, otherwise the response is `404`. A `NULL` company is reserved for platform admins, who can't be created through this endpoint.
- `email` is trimmed and lowercased before saving. It must be unique among users that are not deleted, so a duplicate returns `409`.
- `password` must be 12–128 characters, with no rules about symbols or digits, and it is not trimmed. It is stored only as an argon2id hash in `password_hash`. That column is `select: false`, so normal queries never load it.
- No authentication yet. Later, only company admins will be able to create users, and only in their own company.

## Database migrations

The schema is managed by [Flyway](https://documentation.red-gate.com/flyway), run from the `flyway/flyway` Docker image. Java is not needed on your machine. Migrations are plain SQL files in `db/migration/`:

```
db/migration/
├─ V1__create_company.sql
└─ V2__create_app_user.sql
```

- Name files `V<version>__<description>.sql`, with two underscores. Flyway runs them in version order and records each one in the `flyway_schema_history` table, so each file runs only once.
- Never edit a migration that has already been applied. Flyway stores a checksum and refuses to run if an applied file changes. To change the schema, add a new file, for example `V3__add_company_slug.sql`.
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

## Project structure

```
src/
├─ main.ts          Entry point: creates the Nest app and starts the HTTP server
├─ app.module.ts    Root module: every feature module gets imported here
├─ common/
│  ├─ base.entity.ts      Shared columns: id, created_at, updated_at, is_deleted
│  └─ base.repository.ts  Wraps a TypeORM repository; hides soft-deleted rows by default
├─ companies/
│  ├─ dto/                  Request bodies with validation rules
│  ├─ companies.controller.ts  HTTP routes
│  ├─ companies.service.ts     Business logic (no database calls)
│  ├─ company.repository.ts    All database calls for companies
│  ├─ companies.module.ts
│  └─ company.entity.ts   The company table
├─ users/
│  ├─ dto/                 Request body for creating a user
│  ├─ users.controller.ts  HTTP routes
│  ├─ users.service.ts     Create (company check, duplicate email, argon2 hash) and verifyCredentials for login
│  ├─ user.repository.ts   All database calls for users; findForLogin is the only query that loads the hash
│  ├─ users.module.ts
│  ├─ user.entity.ts       The app_user table ("user" is a reserved word in Postgres)
│  └─ normalize-email.ts   Trim + lowercase, used wherever an email is stored or looked up
└─ database/
   └─ database.module.ts  TypeORM connection to Postgres, configured from .env
db/
└─ migration/             Flyway SQL migrations
```

**Layers:** controller (HTTP) → service (business logic) → repository (database). Each feature has its own repository that extends `BaseRepository`. Every read adds `is_deleted = false` automatically. Pass `{ includeDeleted: true }` to also get deleted rows. Services never call TypeORM directly.

The schema is changed only through Flyway migrations in `db/migration/`. TypeORM's `synchronize` is turned off.

## Project status

Milestone 1 is in progress. The NestJS project is set up and connected to a local PostgreSQL database through TypeORM, with Flyway managing the schema. The companies API (CRUD with soft delete) and the users API (one company per user, argon2-hashed passwords) work end to end. Roles, authentication (JWT) and the feature flag modules come next.
