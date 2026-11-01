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
docker compose up -d
npm run start:dev
```

Open <http://localhost:3000>. You should see `Hello World!`.

The server listens on port `3000` by default. To use another port, set the `PORT` environment variable.

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

## Project structure

```
src/
├─ main.ts          Entry point: creates the Nest app and starts the HTTP server
└─ app.module.ts    Root module: every feature module gets imported here
```

## Project status

Milestone 1 is in progress. The NestJS project and the local PostgreSQL database are set up. Connecting the API to the database, authentication and the feature flag modules come next.
