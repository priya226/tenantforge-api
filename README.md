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

## Database migrations

The schema is managed by [Flyway](https://documentation.red-gate.com/flyway), run from the `flyway/flyway` Docker image. Java is not needed on your machine. Migrations are plain SQL files in `db/migration/`:

```
db/migration/
└─ V1__create_company.sql
```

- Name files `V<version>__<description>.sql`, with two underscores. Flyway runs them in version order and records each one in the `flyway_schema_history` table, so each file runs only once.
- Never edit a migration that has already been applied. Flyway stores a checksum and refuses to run if an applied file changes. To change the schema, add a new file, for example `V2__add_company_slug.sql`.
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
│  └─ base.entity.ts      Shared columns: id, created_at, updated_at, is_deleted
├─ companies/
│  ├─ companies.module.ts
│  └─ company.entity.ts   The company table
└─ database/
   └─ database.module.ts  TypeORM connection to Postgres, configured from .env
db/
└─ migration/             Flyway SQL migrations
```

The schema is changed only through Flyway migrations in `db/migration/`. TypeORM's `synchronize` is turned off.

## Project status

Milestone 1 is in progress. The NestJS project is set up and connected to a local PostgreSQL database through TypeORM, with Flyway managing the schema. The `company` table exists. Authentication and the feature flag modules come next.
