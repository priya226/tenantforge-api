# TenantForge API

Backend API for **TenantForge**, a multi-tenant feature flag service. Product teams turn features on or off for each customer without redeploying, using percentage rollouts and attribute-based rules.

## Tech stack

- [NestJS](https://nestjs.com/) 12
- TypeScript (strict mode, ES modules)
- [Vitest](https://vitest.dev/) for tests, [oxlint](https://oxc.rs/) for linting

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later (npm comes with it)
- Git

## Getting started

```bash
git clone https://github.com/priya226/tenantforge-api.git
cd tenantforge-api
npm install
npm run start:dev
```

Open <http://localhost:3000>. You should see `Hello World!`.

The server listens on port `3000` by default. To use another port, set the `PORT` environment variable.

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

Milestone 1 is in progress. The NestJS project is set up; the database, authentication and feature flag modules come next.
