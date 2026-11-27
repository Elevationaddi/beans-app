# Implementation progress

Status: phases 01–02 merged; phase 03 implemented, awaiting owner review. No production
integrations or real money.

| Phase | Status                 | Commit                                | Tests                                  | Blockers                                |
| ----- | ---------------------- | ------------------------------------- | -------------------------------------- | --------------------------------------- |
| 01    | Done (merged)          | 2db5b9c                               | 17 unit, 3 integration, all apps build | None                                    |
| 02    | Done (merged)          | 6a8a569                               | 28 unit, 52 integration                | D12 before production sign-in           |
| 03    | Implemented, in review | branch `phase-03-merchant-onboarding` | 32 unit, 71 integration                | Storage provider, malware scanner (D11) |
| 04    | Not started            | —                                     | —                                      | See decision register                   |
| 05    | Not started            | —                                     | —                                      | D13 (brand) before production copy      |
| 06    | Not started            | —                                     | —                                      | D02, D06 for real pricing               |
| 07    | Not started            | —                                     | —                                      | D02–D04, D06 before any live provider   |
| 08    | Not started            | —                                     | —                                      | D05, D10                                |
| 09    | Deferred (not in MVP)  | —                                     | —                                      | D07, D08, D14, D16                      |
| 10    | Not started            | —                                     | —                                      | See decision register                   |
| 11    | Not started            | —                                     | —                                      | See decision register                   |
| 12    | Not started            | —                                     | —                                      | D01, D11, D15 and all money decisions   |

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

## Phase 02 — Data and identity (2026-11-27)

### Scope completed

- **Schema and migration** `20261127190450_core_identity_tenancy_catalog`: users, admin_roles,
  merchants, branches, branch_hours, branch_exceptions, memberships, membership_branches,
  categories, products, modifier_groups, modifier_options, product_groups, branch_products,
  branch_options, policies, idempotency_keys, outbox, audit_events (docs/06).
  Hand-written SQL adds what Prisma cannot express: CHECKs (non-negative fils, modifier
  min/max, stock reserved <= on hand, ISO weekday, allowed fulfilment modes), an exclusion
  constraint against overlapping opening hours, composite `(id, merchant_id)` foreign keys so
  a membership, product, option or branch assignment can never cross tenants, an append-only
  trigger on audit_events (UPDATE/DELETE/TRUNCATE rejected), and a trigger making approved,
  effective policies immutable.
- **Seed** (`pnpm db:seed`, repeatable, refuses production): 7 synthetic users (customer,
  owner/manager/barista of merchant A, owner of merchant B, security and operations admins),
  2 merchants x 2 branches, hours, an English/Arabic test menu with modifiers and tracked
  stock, and a `commission/sandbox-v1` policy left unapproved. Arabic strings are prefixed
  `[للمراجعة]` ("for review") and are not production translations.
- **Identity**: global deny-by-default guard; Supabase access tokens verified with `jose`
  against the JWKS (asymmetric algorithms only), issuer, audience, expiry and not-before.
  Role claims in tokens are ignored. Users are created on first sign-in; user status, admin
  roles and memberships are read from the database on every request, so suspension and
  revocation are immediate. Without verification settings every token is rejected.
- **Admin**: `@RequireAdmin(...roles)` needs a listed role from the database and an `aal2`
  (MFA) session. No implicit super_admin bypass.
- **Tenancy**: `MerchantAccessService` scopes queries to active memberships of operating
  merchants (owners: all branches; other roles: assigned branches). Out-of-scope IDs answer 404. Suspended or rejected merchants lock out their staff.
- **Audit**: `AuditService.record` in the same transaction as the change, with secrets
  removed and personal data masked. `GET /v1/admin/audit` (security role + MFA) audits each
  read.
- **Idempotency**: `@Idempotent()` interceptor and `IdempotencyService` (actor + route + key,
  canonical body hash, 24 h retention, 409 on a different body or a concurrent duplicate,
  key released on failure). No production route uses it yet; orders/payments will.
- **Outbox**: `OutboxService.enqueue(tx, …)` with unique dedupe keys; `OutboxRelayService`
  leases rows with `FOR UPDATE SKIP LOCKED`, publishes to BullMQ outside the transaction
  (`jobId` = dedupe key), and backs off exponentially, marking rows failed after 10 attempts.
- **API conventions**: `/v1` prefix, `{ data }` / `{ data, meta: { nextCursor } }` envelopes,
  `{ error: { code, message, fieldErrors?, requestId } }` errors, X-Request-Id, strict request
  validation (unknown fields rejected), opaque keyset cursors.
- **Endpoints**: `GET /v1/me`, `PATCH /v1/me`, `GET /v1/merchant/branches`,
  `GET /v1/merchant/branches/{id}`, `GET /v1/admin/audit`.
- **OpenAPI and client**: route registry in `packages/contracts/src/api/routes.ts`,
  rendered to `packages/contracts/openapi.json` (OpenAPI 3.1) with generated types and a
  typed `createApiClient` (openapi-fetch). A test checks the registry matches the routes Nest
  actually registers; CI fails if the committed document is stale.

### Excluded (later phases)

Order, cart, payment, finance, support and phase-two tables; merchant documents (phase 3);
merchant write endpoints (phases 3–4); rate limiting (phase 11); sign-in UI. Step-up MFA for
owner bank/role changes arrives with those endpoints.

### Decisions and spec notes

- D12 not approved: verification works with any Supabase project (email/password or phone
  OTP). Production needs the chosen channels and SMS vendor.
- docs/06 lists `memberships.status` as free text; implemented as enum `invited/active/revoked`.
- docs/06 does not say whether owners hold `membership_branches` rows; implemented as
  "owners operate every branch of their merchant without assignment rows".
- docs/10 says suspended merchants must not take new actions; phase 2 hides all of a
  suspended merchant's branches from its staff. Revisit in phase 3 (owners may need read access
  to resolve a suspension).
- Tenant-owned join tables carry `merchant_id` so composite foreign keys can enforce tenant
  consistency (docs/06: "composite branch/merchant foreign keys where applicable").

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                                                          |
| `pnpm test`                                          | 28 passed: contracts 6, ui 5, api 17                                                          |
| `pnpm test:integration`                              | 52 passed in 8 files; 4 consecutive runs all green                                            |
| `pnpm build`                                         | All packages and apps build                                                                   |
| `pnpm db:migrate` on an empty database               | Migration applied                                                                             |
| `prisma migrate diff … --exit-code`                  | No difference between schema and migrations                                                   |
| `pnpm db:seed` twice                                 | Same counts both runs (7 users, 2 merchants, 4 branches, 6 products, 4 memberships, 1 policy) |
| Built API: `GET /health`, `GET /v1/me`               | 200; 401 `UNAUTHENTICATED` with request ID (no verifier configured)                           |

Integration coverage: token signature/issuer/audience/expiry/nbf/`alg: none`; first sign-in
race creates one user; role claims ignored; suspension immediate; tenant A cannot read
tenant B (404, same as non-existent); barista limited to assigned branch; membership
revocation and branch unassignment immediate; merchant suspension; database rejects
cross-tenant assignments and products; admin role + MFA, no super_admin bypass, revocation
immediate; audit read audited; profile update audited with masking; audit table rejects
UPDATE/DELETE/TRUNCATE; idempotency replay, conflict, per-actor scope, concurrency and
release on failure; outbox atomicity, dedupe, concurrent relays publish once, backoff;
BullMQ job dedupe; hours overlap, money and stock CHECKs; policy immutability; route
registry matches Nest.

### Signing in locally

Run a local Supabase stack (`supabase start`) or use a test project with asymmetric JWT
signing keys, then set `SUPABASE_JWKS_URL` and `SUPABASE_JWT_ISSUER` in `apps/api/.env`.
To act as a seeded persona, set that user's `auth_subject` to the Supabase user ID, e.g.
`UPDATE users SET auth_subject = '<supabase-user-id>' WHERE email = 'owner-a@example.test';`.
Admin routes also need an MFA (aal2) session.

### Migration and rollback

Forward-only. Rolling back before any real data exists: revert the merge and drop/recreate the
development database. After real data exists, write a new forward migration instead.
Requires the `btree_gist` extension (trusted in PostgreSQL 13+, so a database owner can
create it; managed providers must allow it).

### Risks and next step

- `openapi-typescript` 7.13 declares a TypeScript ^5 peer; it runs correctly with 6.0.
- Rate limiting for sign-in-adjacent routes is not built yet (phase 11 hardening).
- Next: phase 03 (merchant applications, document quarantine, admin review queue).

## Phase 03 — Merchant onboarding (2026-11-27)

### Scope completed

- **Migration** `20261127192540_merchant_onboarding`: `uploads` and `merchant_documents`
  tables; merchant `contact`, `review_note`, `submitted_at`, `reviewed_at`; composite
  `(upload_id, merchant_id)` foreign key so a document can only point at its own merchant's
  upload; a database trigger that refuses an `active` branch or a `published` product unless
  the merchant is `approved` (B01 "unapproved merchant cannot publish").
- **Applications** (`/v1/merchant/applications`): create (caller becomes owner; duplicate
  licence → 409), list own, get, edit while draft, submit with documents. Submission needs
  every listed document to belong to the application and pass the file check, including a
  trade licence. All writes audited; submission emits `merchant.application_submitted`.
- **Uploads** (`/v1/uploads`): server-generated, tenant-bound object keys
  (`merchants/{id}/documents/{uploadId}`); 15-minute HMAC-signed upload links bound to one
  upload, type and maximum size; PDF/JPEG/PNG up to 10 MB; size and type enforced on receipt;
  `complete` quarantines the file and enqueues `file.scan_requested` in the same transaction.
  The outbox worker runs the file check and marks the upload clean or rejected (audited).
  Download links (5 minutes, signed, `Content-Disposition: attachment`, `nosniff`,
  `no-store`) exist only for clean files and only open the file they name.
- **Admin review** (`/v1/admin/merchants`, operations role + MFA): queue with status filter,
  detail with document links (each issue audited), and review decisions with a mandatory
  reason and the status the reviewer saw (`expectedStatus`, stale → 409):

  | Decision        | From      | To        |
  | --------------- | --------- | --------- |
  | start_review    | submitted | review    |
  | approve         | review    | approved  |
  | reject          | review    | rejected  |
  | request_changes | review    | draft     |
  | suspend         | approved  | suspended |
  | reinstate       | suspended | approved  |

  Approval needs a clean trade licence. Admins cannot review a merchant they belong to.
  Concurrent decisions: one wins, the other gets 409. Every decision is audited with reason,
  before/after status and request ID, and emits `merchant.status_changed`.

- **Outbox fixes found by these tests**: BullMQ job IDs cannot contain `:` (phase 2 used the
  dedupe key directly); job IDs are now a SHA-256 of the dedupe key. Topics now go to one
  queue per domain (`outbox.file`, `outbox.merchant`), so a consumer only receives its own
  events. Integration test files now run one at a time because they share the outbox table.

### Development adapters (production blockers)

- `STORAGE_DRIVER=local` stores files on local disk behind signed links served by the API.
- `FILE_SCANNER=basic` checks that content matches the declared type and rejects the EICAR
  test file and PDFs with scripts or embedded files. **It is not a malware scanner.**
- Both are refused when `NODE_ENV=production`. Before launch: choose private object storage
  (for example Supabase Storage or S3 in an approved region, D11) and a malware scanning
  service, then add their adapters behind the same interfaces.

### Excluded / follow-ups

- Merchant portal and admin console screens for onboarding: they need a Supabase project to
  sign in (see "Signing in locally"). The API is complete and typed for them.
- Payout onboarding (B01 lists it): depends on the payment provider (D03/D04).
- Branch creation during onboarding: phase 4 (branches can be drafted before approval; the
  database refuses to activate them until approval).
- Suspension "prevents new checkout; active orders resolved" (A02): checkout is phase 6,
  fulfilment phase 8.

### Spec notes

- docs/06 does not list `uploads`; docs/07 requires `/uploads` endpoints, so the table was
  added. `merchant_documents.object_key` is kept as specified and mirrors the upload's key.
- "Request corrections" (B01) has no status of its own; it returns the application to
  `draft` with the reviewer's note.
- Which documents are mandatory is not specified; only the trade licence is required for now.
- Added `GET /v1/merchant/applications[/{id}]` and `PATCH /v1/merchant/applications/{id}`
  (not in docs/07) so applicants can see review notes and fix drafts.

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                                           |
| `pnpm test`                                          | 32 passed: contracts 6, ui 5, api 21                                           |
| `pnpm test:integration`                              | 71 passed in 9 files; 3 consecutive runs green                                 |
| `pnpm build`                                         | All packages and apps build                                                    |
| Migrations on empty databases + `pnpm db:seed`       | Applied; seed unchanged                                                        |
| Built API smoke test                                 | Starts; `/health` 200; `/v1/uploads` 401 without token; forged upload link 403 |

New integration coverage (19 tests): application ownership and privacy, duplicate licence,
strict validation, submission rules, upload quarantine and type mismatch rejection, wrong
content type, oversize body (413), forged/foreign/expired-purpose links, size mismatch;
cross-tenant denial for tickets, completion, submission and download links; download only
for clean files; admin role and MFA; queue listing; full review cycle with mandatory reasons
and audit trail; rejection; self-review blocked; concurrent decisions; suspension lockout
and reinstatement; publish lock before approval and after suspension; file check end-to-end
through outbox relay and BullMQ worker.

### Migration and rollback

Forward-only. Adds tables, nullable columns and a defaulted `contact` column, so existing rows
are unaffected. Rollback before production: revert the merge and recreate development
databases.

### Next step

Phase 04: branches, hours, exceptions, capacity slots, categories, products, modifiers,
availability and staff invites.

## Decision and change log

Record date, author, decision ID, old/new behavior, approval and affected files.

| Date       | Author | Decision | Change                                                                              | Approval                           |
| ---------- | ------ | -------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-11-27 | Claude | D13      | Neutral working name "Coffee Marketplace" used in all UI; no BEANZ marks            | Proposed default, not approved     |
| 2026-11-27 | Claude | D02      | Seeded `commission/sandbox-v1` (10%, sandbox flag, unapproved) for development only | Proposed default, not approved     |
| 2026-11-27 | Claude | D12      | Sign-in verified via any Supabase provider; admin routes require aal2 (MFA)         | Channels and SMS vendor not chosen |

## Phase handoff template

- Scope completed / excluded
- Files and migration IDs
- Commands and actual results
- Acceptance criteria met / failing
- Risks, unapproved decisions, rollback and next step
