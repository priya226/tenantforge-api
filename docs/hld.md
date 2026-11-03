# TenantForge: High-Level Design

A multi-tenant feature-flag and config service. Product teams turn features on or off, roll them out gradually, and change app configuration per customer without redeploying.

Low-level details (schema, APIs, code layers, decisions log) are in [lld.md](lld.md).

---

## 1. Problem

We run the service for many companies (tenants). Each company's admins manage flags and settings in a web console. Each company's apps read them through our SDK and must see changes within seconds.

## 2. Assumptions

| Question | Assumption |
| --- | --- |
| Companies | 1,000 |
| Flags per company | 500 on average (500,000 in total) |
| Active client apps/devices | 1 million |
| Freshness | A change must reach apps within 5 seconds |
| Who writes / who reads | Company admins write in the console; company apps read |
| Rollout | By percentage of users, and by attributes such as region or cohort |
| Service unreachable | Apps keep using the last values they received |
| Change rate | About 10 changes per company per day |

## 3. Functional requirements

| ID | Requirement |
| --- | --- |
| FR1 | An admin can create a flag for their company. |
| FR2 | An admin can turn a flag on or off. |
| FR3 | An admin can roll a flag out to a percentage of users. |
| FR4 | An admin can target a flag by attribute (region, cohort, plan), each with its own percentage. |
| FR5 | The same user always gets the same result for a flag until the flag or its rules change. |
| FR6 | An admin can change only their own company's flags, settings and users. |
| FR7 | Apps receive flag and config changes within 5 seconds, without redeploying. |
| FR8 | Apps keep working on the last known values if the service is down. |
| FR9 | An admin can see who changed a flag or setting, when, and the value before and after. |
| FR10 | An admin can roll a flag back to any earlier state in one action. |
| FR11 | If two admins edit the same flag or setting at once, the second save is rejected ("changed by someone else"), never silently overwritten. |
| FR12 | An admin can manage their company's users and roles. |
| FR13 | An admin can manage versioned company config (key → JSON value); every change creates a new version. |
| FR14 | An admin can roll a config value back to any earlier version in one action. |

## 4. Non-functional requirements

| ID | Quality | Target |
| --- | --- | --- |
| NFR1 | Read availability | 99.9% for flag/config reads |
| NFR2 | Write consistency | Strongly consistent writes; no lost updates |
| NFR3 | Evaluation speed | `isEnabled()` in the SDK under 1 ms, no network call |
| NFR4 | Propagation | Connected SDKs see a change within 5 s (about 1 s with push) |
| NFR5 | Tenant isolation | A company can never read or change another company's data |
| NFR6 | Scale out | Several identical service instances |
| NFR7 | Cost | Runs locally with `docker compose`; cloud only for a demo |

**Trade-off:** writes are rare and made by people, so they can wait and must be correct (consistency). Reads are constant and made by apps, so they must never fail, even if a few seconds old (availability).

## 5. Estimates

| Item | Calculation | Result |
| --- | --- | --- |
| Total flags | 1,000 × 500 | 500,000 |
| Reads if every app asked every second | 1M devices × 1/s | 1,000,000 req/s, so the SDK evaluates locally |
| Writes | 1,000 × 10/day ÷ ~100,000 s | ~0.1 writes/s |
| Storage | 500,000 × ~1 KB | ~500 MB, fits in memory and in Redis |

Read load is driven by active clients, not by the number of flags. That is why the SDK keeps rules in memory.

## 6. Tech stack

| Part | Technology | Used for |
| --- | --- | --- |
| API | NestJS (TypeScript) | Management API, SDK delivery endpoints, WebSocket gateway |
| Database | PostgreSQL + Flyway | Source of truth; schema owned by hand-written SQL migrations |
| Cache + fan-out | Redis | Per-company cache of flags/config; pub/sub channel between instances |
| Live updates | WebSockets | Push changes to connected SDKs, one room per company |
| Console | React (micro-frontend shell + flags app), Angular (settings app) | Admin UI, loaded at runtime with Module Federation |
| Auth | JWT (console), API keys (SDKs) | Users log in; apps authenticate per company with a revocable key |
| Local run | Docker Compose | Postgres, Redis, Flyway |

## 7. Architecture

```
                    ┌──────────────── TenantForge ───────────────────────────────┐
Admin console ──►   │  Load balancer                                             │
(React shell +      │        │                                                   │
 remotes)           │        ├──► Management API (writes, N instances)           │
                    │        │         1. check JWT, role, tenant                │
                    │        │         2. check expectedVersion (409 if stale)   │
                    │        │         3. DB transaction: change + audit row     │
                    │        │         4. update Redis cache                     │
                    │        │         5. publish to "changes" channel           │
                    │        │         ▼                                         │
                    │        │    PostgreSQL (source of truth)                   │
                    │        │    Redis: cache + pub/sub "changes"               │
                    │        │         ▲                                         │
                    │        └──► Delivery (reads, N instances)                  │
                    │                  - GET /sdk/flags, GET /sdk/config         │
                    │                  - WebSocket, one room per company         │
                    │                  - subscribed to "changes"                 │
                    └──────────────────────────│─────────────────────────────────┘
                                               │ WebSocket push / HTTP poll (API key)
                                               ▼
                         Company app with our SDK (rules + config in memory)
                         isEnabled("newCheckout", { userId, region })
                         getConfig("checkout.maxItems")
```

Management and delivery start as two modules in one NestJS app; splitting them into separate services is a scaling step.

## 8. Key design decisions

| Decision | Why | Rejected |
| --- | --- | --- |
| SDK evaluates flags locally from rules in memory | 1M reads/s becomes one fetch at startup plus one per change; < 1 ms; works when we are down | Calling the API on every check |
| Hashing inside the SDK, same algorithm everywhere | Same user gets the same answer on web, mobile and server | Each company choosing a hash |
| Bucket = SHA-256(`flagKey:userId`) % 100 | Even spread; flag key in the input so each flag picks a different "first 10%" | Using raw user ids (not evenly spread); storing per-user assignments (far too much data) |
| Optimistic locking: `version` column + `expectedVersion` on every update | Detects "someone else saved first" → 409, with no locks held while an admin edits | Pessimistic row locks |
| Audit row in the same transaction as the change, with full before/after snapshots | Both save or neither; the snapshot powers history and rollback | Async audit through a queue (change could save while audit is lost) |
| Rollback = apply an old snapshot as a new change | History stays append-only; a rollback can itself be rolled back | Deleting newer versions |
| One versioning/audit/rollback mechanism for flags and config | Same code path, same guarantees, same UI pattern | Separate history tables per entity |
| WebSocket push, HTTP polling as fallback | Push meets the 5 s target at ~1 s; polling covers broken connections | Polling only |
| Redis pub/sub between instances | The instance holding an SDK's socket may not be the one that saved the change | Sticky routing |
| Redis internal only | No per-company auth, browsers can't speak it, not built for internet-scale clients | SDKs subscribing to Redis directly |
| API key per company for SDKs | A company id is not secret; a key can be revoked and rotated | Trusting a client-sent company id |
| Console auth: 15-minute JWT access token + rotating refresh token (hash stored in Postgres) | No DB lookup per request, yet sessions can be revoked; 7-day idle and 30-day absolute expiry; reuse of an old refresh token ends the session | One long-lived JWT (can't be revoked); a DB session lookup on every request |
| Tenant scope read from the token | A user can't reach another company's data by changing a request parameter | Trusting a client-sent company id |
| Server SDK gets all rules; browser clients get only their own results | Rules must not leak to end-user devices | Shipping all rules to browsers |

## 9. Flows

### 9.0 Console login and token refresh
1. `POST /auth/login` with email and password → `{ accessToken (15 min), refreshToken }`.
2. Every request sends `Authorization: Bearer <accessToken>`. The server checks only the signature and reads user id, company and roles from it.
3. When a request needs a fresh token, the console calls `POST /auth/refresh`. The old refresh token is revoked and a new pair is returned, with roles reloaded from the database.
4. If a revoked refresh token is used again, the whole session is revoked (theft detection).
5. Unused for 7 days, or 30 days after login, the refresh fails and the user logs in again.

### 9.1 SDK startup
1. The app creates the SDK with its API key.
2. The SDK calls `GET /sdk/flags` and `GET /sdk/config`, getting all of its company's flags, rules, config and current versions.
3. It keeps them in memory and opens a WebSocket (joins its company's room).

### 9.2 Admin turns off a flag
1. Console sends `PUT /flags/newCheckout { enabled: false, expectedVersion: 41 }`.
2. Is the user an admin of this company? If not, 403.
3. Is the stored version still 41? If not, **409 "changed by someone else"**.
4. One transaction: update the flag (`version = 42`) and insert the audit row (before/after).
5. Update the company's Redis cache.
6. Publish `{ companyId, type: "flag", key: "newCheckout", version: 42 }` to `changes`.
7. Every delivery instance hears it; those holding the company's sockets push the new state.
8. The SDK updates memory; the next `isEnabled("newCheckout")` returns false.

### 9.3 Admin changes a config value
Same as 9.2 with `PUT /settings/checkout.maxItems { value: 20, expectedVersion: 7 }`: version check, transaction with audit row, cache, publish, push. The SDK's `getConfig()` returns the new value.

### 9.4 Rollback (flags and config)
`POST /flags/{key}/rollback` or `POST /settings/{key}/rollback` with `{ toVersion }` → read that version's snapshot from the audit log → apply it as a **new** change (new version, new audit row) → steps 4–8 above.

### 9.5 Polling fallback
While the WebSocket is down, the SDK calls `GET /sdk/flags?sinceVersion=` every 30 s. Any instance answers from the cache.

### 9.6 Flag evaluation inside the SDK
```
isEnabled(flagKey, ctx):
  flag = memory[flagKey]
  if flag missing or not flag.enabled: return false
  rule = first rule where ctx[rule.attribute] == rule.value
  percent = rule ? rule.percent : flag.default_percent
  bucket = sha256(flagKey + ":" + ctx.userId) as integer % 100
  return bucket < percent
```
Raising a rollout from 10% to 30% keeps the original 10% on, because a user's bucket never changes.

## 10. Admin console (micro-frontend)

```
Shell (React): login, menu, shared auth
 ├─ Flags app (React): list, toggle, percent, rules, history, rollback, 409 message
 └─ Settings app (Angular): company config with history and rollback, users and roles
```
Each app is built and deployed separately; the shell loads them at runtime (Module Federation).

## 11. Roadmap

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 | NestJS + Postgres: companies, users, roles, auth (JWT), tenant scoping, flags, rules, config, versioning, audit, rollback, 409 | In progress: companies, users, roles, seed admin, auth (JWT + refresh tokens), tenant scoping, flags with versioning, 409 and audit done; next flag history + rollback, then config |
| 2 | Redis cache + pub/sub, WebSocket delivery, SDK package, demo app reacting live | Planned |
| 3 | Console: React shell, React flags app, Angular settings app | Planned |
| 4 | Docker images, GitHub Actions CI, demo deploy | Planned |
