# Implementation progress

Status: phase 01 implemented, awaiting owner review. No business features, production
integrations or real money.

| Phase | Status                 | Commit                       | Tests                                  | Blockers                              |
| ----- | ---------------------- | ---------------------------- | -------------------------------------- | ------------------------------------- |
| 01    | Implemented, in review | branch `phase-01-foundation` | 17 unit, 3 integration, all apps build | None for this phase                   |
| 02    | Not started            | —                            | —                                      | D12 (sign-in channels, SMS vendor)    |
| 03    | Not started            | —                            | —                                      | See decision register                 |
| 04    | Not started            | —                            | —                                      | See decision register                 |
| 05    | Not started            | —                            | —                                      | D13 (brand) before production copy    |
| 06    | Not started            | —                            | —                                      | D02, D06 for real pricing             |
| 07    | Not started            | —                            | —                                      | D02–D04, D06 before any live provider |
| 08    | Not started            | —                            | —                                      | D05, D10                              |
| 09    | Deferred (not in MVP)  | —                            | —                                      | D07, D08, D14, D16                    |
| 10    | Not started            | —                            | —                                      | See decision register                 |
| 11    | Not started            | —                            | —                                      | See decision register                 |
| 12    | Not started            | —                            | —                                      | D01, D11, D15 and all money decisions |

## Phase 01 — Foundation (2026-11-27)

### Scope completed

- pnpm workspace: `apps/mobile` (Expo SDK 58), `apps/merchant` (Next.js 16, tablet route
  `/tablet`), `apps/admin` (Next.js 16), `apps/api` (NestJS 12, Prisma 7 with the pg driver
  adapter, ioredis), `packages/contracts`, `packages/ui`, `packages/config`.
- `GET /health` (PostgreSQL `SELECT 1` and Redis `PING`; 200 or 503) and `GET /health/live`.
- Startup configuration validation (`apps/api/src/config/env.ts`): required URLs, fake
  provider refused in production, CORS allowlist required in production, live payments
  blocked, error messages never include values.
- `docker-compose.yml` (PostgreSQL 16, Redis 7, bound to 127.0.0.1, separate `beans_test`
  database), `.env.example` with placeholders only.
- CI (`.github/workflows/ci.yml`): format, lint, typecheck, unit tests, build; integration
  tests against PostgreSQL/Redis service containers with migrations applied to an empty
  database; gitleaks secret scan; `pnpm audit --prod --audit-level high`.
- Design tokens from docs/09 with an automated WCAG AA contrast test for text colours.

### Excluded (later phases)

Data model and migrations, authentication, every business feature, English/Arabic and RTL
(pages declare `lang="en" dir="ltr"` until phase 5), web E2E (Playwright) and mobile E2E,
mobile lint (typecheck only for now).

### Version choices

Versions verified against the npm registry on 2026-11-27. Prisma CLI is pinned to 7.10.1
because the registry's `latest` tag points at an 8.0 release candidate. TypeScript is ~6.0.3,
the version the Expo SDK 58 template uses. `effect` is overridden to 3.22.5 to clear a
high-severity advisory in Prisma's pinned dependency (see `pnpm-workspace.yaml`).

### Commands and actual results (local run, 2026-11-27)

| Command                                | Result                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm install`                         | OK, 997 packages, workspace packages built                                      |
| `pnpm format:check`                    | All files formatted                                                             |
| `pnpm lint`                            | OK (api, merchant, admin)                                                       |
| `pnpm typecheck`                       | OK (all 7 projects)                                                             |
| `pnpm test`                            | 17 passed: contracts 3, ui 5, api 9                                             |
| `pnpm test:integration`                | 3 passed: health ok with real DB/Redis, liveness, 503 when Redis unreachable    |
| `pnpm build`                           | OK: api (tsc), merchant (`/`, `/tablet`), admin (`/`), mobile Android bundle    |
| `pnpm db:migrate`                      | "No pending migrations to apply" (none exist yet)                               |
| `curl /health` (built API)             | 200 `ok`; stopping Redis gave 503 `degraded`; restarting Redis recovered to 200 |
| `pnpm audit --prod --audit-level high` | Passes; 1 moderate remains (minimatch inside Expo tooling)                      |

Environment note: Docker Hub rate-limited image pulls in the build environment, so the local
run used PostgreSQL 16.15 and Redis 7.0.15 installed directly, same major versions as
`docker-compose.yml` (validated with `docker compose config`). CI uses the Docker images.
Expo's online dependency check (`expo install --check`) could not reach api.expo.dev from the
build environment; versions come from the official SDK 58 template.

### Acceptance gate

- All apps build: met.
- Health endpoint responds: met.
- Local DB/Redis reachable: met (see environment note).
- No secrets committed: `.env*` ignored except `.env.example` (placeholders only); gitleaks
  runs in CI.

### Migration and rollback

No database migrations in this phase. Rollback is reverting the merge commit.

### Risks and next step

- Moderate advisory in Expo tooling (minimatch, dev tooling path); revisit on next Expo patch.
- Next: phase 02 (core schema, identity, membership guards, audit, idempotency, outbox).
  Needs D12 for production sign-in; development can use a local/test Supabase project.

## Decision and change log

Record date, author, decision ID, old/new behavior, approval and affected files.

| Date       | Author | Decision | Change                                                                   | Approval                       |
| ---------- | ------ | -------- | ------------------------------------------------------------------------ | ------------------------------ |
| 2026-11-27 | Claude | D13      | Neutral working name "Coffee Marketplace" used in all UI; no BEANZ marks | Proposed default, not approved |

## Phase handoff template

- Scope completed / excluded
- Files and migration IDs
- Commands and actual results
- Acceptance criteria met / failing
- Risks, unapproved decisions, rollback and next step
