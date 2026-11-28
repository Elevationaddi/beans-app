# Implementation progress

Status: phases 01–08, 10 and 11 merged; phase 09 deferred (not in MVP); phase 12 (release
preparation) implemented and awaiting owner signoff. Nothing is deployed. The owner asked (2026-11-27) for the
remaining phases to be built and merged without per-phase approval, with one final report.
No production integrations or real money.

| Phase | Status                   | Commit                    | Tests                                  | Blockers                                      |
| ----- | ------------------------ | ------------------------- | -------------------------------------- | --------------------------------------------- |
| 01    | Done (merged)            | 2db5b9c                   | 17 unit, 3 integration, all apps build | None                                          |
| 02    | Done (merged)            | 6a8a569                   | 28 unit, 52 integration                | D12 before production sign-in                 |
| 03    | Done (merged)            | 6d21d02                   | 32 unit, 71 integration                | Storage provider, malware scanner (D11)       |
| 04    | Done (merged)            | 63496dc                   | 37 unit, 108 integration               | D10 (slot length), invite delivery            |
| 05    | Done (merged)            | ad02125                   | 54 unit, 122 integration               | D12 (app sign-in), D13 before production copy |
| 06    | Done (merged)            | 7818223                   | 62 unit, 137 integration               | D02, D06 for real pricing; D12 for app        |
| 07    | Done (merged)            | a5bcaa3                   | 71 unit, 145 integration               | D02–D04, D06 before any live provider         |
| 08    | Done (merged)            | 58ec117                   | 76 unit, 161 integration               | D05, D10; D12 for tablet and app screens      |
| 09    | Deferred (not in MVP)    | —                         | —                                      | D07, D08, D14, D16 and legal review           |
| 10    | Done (merged)            | 8e82873                   | 76 unit, 168 integration               | D11 (retention), D12 for screens              |
| 11    | Done (merged)            | dec9a24                   | 77 unit, 172 integration               | Staging (hosting), D15 device audit, pen test |
| 12    | Done, owner signoff open | branch `phase-12-release` | 83 unit, 172 integration               | Launch gates G1–G12 (docs/15)                 |

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

## Phase 04 — Catalog and branch management (2026-11-27)

### Scope completed

- **Branches** (`apps/api/src/merchant`): create (owner, starts as draft), edit, replace weekly
  hours, open/pause/resume/close with explicit transitions (draft → active/closed, active ⇄
  paused, any → closed, closed → active). Opening needs an approved merchant (API check plus
  the phase 3 database trigger) and at least one opening interval. Assigned managers may change
  hours and pause/resume only; everything else is the owner's. Coordinates and phone added.
- **Hours and holidays**: intervals validated per weekday (no overlap, closes after opens;
  overnight opening is sent as two intervals, so 23:59 is the latest closing time). The
  existing exclusion constraint backs this up. `PUT …/exceptions/:date` sets a closed day or
  replacement intervals for one local date (today or later).
- **Pickup slots** (`apps/api/src/inventory`): 15-minute slots (sandbox D10) derived from the
  hours or that day's exception, in the branch timezone (Asia/Dubai), stored as UTC. Slots are
  reconciled per day: missing ones created, empty ones outside new hours removed, slots holding
  orders always kept. Capacity changes apply to future slots but never below what they hold.
  `SlotService.hold/release` are single conditional updates backed by the new
  `reserved + confirmed <= capacity` CHECK. Merchant read endpoint only; the customer endpoint
  comes in phase 5.
- **Menu** (`apps/api/src/catalog`): categories, modifier groups with options, products.
  Money is whole fils as decimal strings on the wire, BigInt in the database. Products are
  created as drafts; edits need `expectedVersion` (stale → 409 with the current version).
  Modifier groups are versioned too; options left out of an update are deactivated, never
  deleted. No delete endpoints anywhere: products are archived.
- **Publish rules**: approved merchant, active category, every attached option group
  satisfiable by its active options (`minCount` ≤ active options, at least one). Checked on the
  final state of every edit, so editing a published product cannot leave it invalid. A
  category with published products cannot be deactivated.
- **Branch overrides** (B05): `PUT …/products/:productId` (enabled/sold out, branch price,
  optional tracked stock) and `PUT …/options/:optionId` (enabled, branch price), audited with
  before/after. Stock cannot be set below units held (409). Archived products and removed
  options cannot be enabled. `StockService.hold/release` for checkout: one conditional update,
  backed by the existing CHECK, so the last unit cannot be sold twice.
- **Staff** (`apps/api/src/staff`): owner lists members and pending invitations, invites a
  manager/barista/analyst with branches, revokes invitations, changes role/branches, revokes
  access (effective next request, reason audited). Invitations carry a one-time token shown
  once and stored as a SHA-256 hash, expire after 72 hours, and can only be accepted by a user
  signed in with the invited email. Owners can never be invited or edited here. Managers and
  baristas need at least one branch; menu editing (`catalogDelegated`) is for managers only and
  is dropped when the role changes.
- **Access** (docs/10): menu reads for owner/manager, menu writes for owner or a delegated
  manager, availability for owner or assigned manager, staff for owner only. Every merchant
  ID in a request is a lookup key; cross-tenant IDs answer 404 with the resource's own name.
- **Contracts and OpenAPI** (0.3.0): 21 new routes, all registered in `routes.ts` and checked
  against Nest by the route test.

### Database (migration `20261127194455_catalog_slots_staff`)

New tables `slots`, `staff_invitations`; new columns `branches.phone`,
`memberships.catalog_delegated`, `modifier_groups.version`. Hand-written: slot counts CHECK,
modifier group version CHECK, invitation checks (no owner role, delegation only for managers,
accepted ⇔ accepter set, lowercase email), one pending invitation per email per merchant.

### Excluded / follow-ups

- Product photos: uploads only accept merchant documents today; photo upload needs the
  production storage provider (phase 3 blocker).
- Invitation delivery: no email is sent. A `staff.invited` outbox event is written and the
  owner shares the token. Real delivery waits for an approved notification provider.
- Customer menu, branch list and slot availability endpoints are phase 5.
- Portal screens for these endpoints still need a Supabase test project to sign in.

### Decisions and spec notes

- **D10**: 15-minute slots and per-branch capacity are the proposed sandbox values.
- **Invitation expiry (72 hours)** is an operational default, not a commercial policy. Please
  confirm or change.
- **Invitation acceptance** compares the email stored at first sign-in. Supabase only issues
  tokens for confirmed emails with the default settings; recheck once D12 picks sign-in methods.
- **Role changes and MFA**: docs/10 asks for step-up on role changes for privileged users.
  Merchant owners are not required to use MFA yet; recorded as an open item for D12.
- **Added routes not in docs/07**: `GET …/branches/:id/slots`, `GET /merchant/products/:id`,
  `POST /merchant/staff/invitations/:id/revoke`, `POST /merchant/invitations/accept`. Invite
  and revoke need them to work end to end.
- **Allergens** are free-form lowercase labels until a reviewed list exists (docs/09).

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                           |
| `pnpm test`                                          | 37 passed: contracts 6, ui 5, api 26                           |
| `pnpm test:integration`                              | 108 passed in 13 files                                         |
| `pnpm build`                                         | All packages and apps build                                    |
| Migrations on empty databases                        | Applied; `prisma migrate diff --exit-code` shows no difference |
| `pnpm db:seed` twice                                 | Same counts both runs                                          |
| `pnpm audit --prod --audit-level high`               | Passes (1 moderate, unchanged)                                 |
| Built API smoke test                                 | `/health` 200; new merchant routes 401 without a token         |

New integration coverage (37 tests), mapped to the phase gate:

- **Publish rules**: draft → published; unapproved merchant refused by API and database;
  inactive category; category deactivation blocked by published products; failed publish
  rolls back; archived products must return to draft; stale versions; option min/max rules;
  options deactivated not deleted; foreign IDs cannot be attached.
- **Branch overrides**: branch price, sold out, tracked stock with audit; archived products
  cannot be enabled; option overrides; barista, unassigned manager and other tenants refused.
- **Stock constraints**: 12 concurrent holds on the last unit → exactly 1 succeeds;
  multi-unit holds; release; untracked stock; stock cannot be set below held units; database
  CHECK refuses oversell directly; 10 concurrent slot holds on capacity 3 → exactly 3.
- **Staff assignment**: invite → accept → sees only assigned branch; one-time token stored
  hashed; wrong email, unknown and expired tokens; no owner invitations or owner edits;
  branches required and must belong to the merchant; owner-only management; reassignment
  and revocation effective on the next request; menu delegation granted and dropped.
- **Branches**: owner-only creation, interval validation, opening rules and transitions,
  manager limits, holidays driving slots (07:00 Dubai = 03:00 UTC), schedule changes keeping
  held slots.

### Migration and rollback

Forward-only and additive (new tables, defaulted columns), so existing rows are unaffected.
Rollback before production: revert the merge and recreate development databases.

### Next step

Phase 05: discovery (customer branch list, branch details, menu and slot availability).

## Phase 05 — Customer discovery (2026-11-27)

### Scope completed

- **Public API** (`apps/api/src/discovery`, no sign-in):
  - `GET /v1/branches`: search by café or branch name, emirate, pickup type, open now. Sorted
    nearest first only when the request carries a location, otherwise by café name.
  - `GET /v1/branches/:id`: details, hours in branch time, holidays, sibling branches.
  - `GET /v1/branches/:id/menu`: published products in active categories, with branch prices,
    sold-out flags (switched off, or tracked stock used up), drink options, and a content
    `version` that changes whenever the menu changes.
  - `POST /v1/branches/:id/items/price`: server price of one customized item (Q02).
  - `GET /v1/branches/:id/slots`: future pickup times for a date and pickup type, as
    available or full (no counts). A paused branch offers none.
  - Only active or paused branches of approved merchants are listed; drafts, closed
    branches and unapproved merchants answer 404. `availability` is `open`, `closed`
    (outside hours: visible, no ASAP orders) or `paused`.
- **Favorites** (signed in): `GET /v1/favorites`, `PUT/DELETE /v1/favorites/:merchantId`.
  Only approved cafés can be saved or are listed; each customer sees only their own.
- **Branch emirate**: new nullable `branches.city` (the seven emirates, CHECK constraint),
  editable by the owner in the merchant API, used by the customer emirate filter. Seed
  branches are set to Abu Dhabi (D01 proposed pilot).
- **Customer app** (`apps/mobile`, React Navigation):
  - Screens: welcome (language, emirate, optional location, browse as guest), Home, Explore
    (search, open now, pickup type, clear filters), café page (status, hours in Dubai time,
    other branches, menu with sold-out), drink options (min/max, quantity 1–20, notes with an
    allergy disclaimer), cart, Orders and Profile (language, emirate).
  - Prices are always the server's: the options screen asks the API for the price of the
    current choice and adds that to the cart.
  - The cart holds one branch; adding from another branch asks first (Q03).
  - Guests see "Sign in to check out" and no checkout action.
  - Loading, error with retry, offline (last results kept and labelled) and empty states.
  - English and Arabic, with right-to-left layout for Arabic. Arabic text is a draft and the
    app shows a notice while Arabic is selected.
- **Privacy fix**: server error logs now omit query strings, so a customer location sent to
  search never lands in logs.

### Database (migration `20261127200703_discovery_city_favorites`)

New column `branches.city` (nullable, CHECK on the seven emirates, index with status); new
table `favorites` (unique per customer and café, cascades with the user).

### Excluded / follow-ups

- **Sign-in in the app**: needs the Supabase test project and D12. Until then the app runs
  as a guest: saving cafés, orders and checkout show a sign-in message, with no fake action.
- **Map view** in Explore: list only for now; a map needs a maps provider decision.
- **Featured shops, offers, reorder** on Home: need campaigns (phase 2) and orders (phase 6+).
- **Product photos**: wait on the production storage provider.
- **Device testing**: VoiceOver/TalkBack, 200% zoom and contrast on real devices are still to
  do (D15). Automated checks cover roles, labels and RTL only.

### Decisions and spec notes

- **D01**: the welcome screen defaults to Abu Dhabi; all seven emirates can be chosen.
- **Quantity limit of 20 per item** is a sandbox value. Please confirm.
- **No branch override row** means the product is offered at its base price with stock not
  tracked. The owner switches it off per branch to hide it as sold out.
- **Location** is optional, kept in memory on the device only, sent only with search requests
  and never stored by the server, and never required to browse (Q01).
- **Added routes not in docs/07**: `POST /v1/branches/:id/items/price` (needed for Q02 and the
  customizer price) and `DELETE /v1/favorites/:merchantId`.
- **Search ranks up to 500 branches in memory** (fine for the pilot); move ranking into SQL
  before wider launch.

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                                     |
| `pnpm test`                                          | 54 passed: contracts 6, ui 5, api 29, mobile 14                          |
| `pnpm test:integration`                              | 122 passed in 14 files                                                   |
| `pnpm build`                                         | All packages and apps build (mobile Android bundle, 1,000 modules)       |
| Migrations on existing databases                     | Applied; `prisma migrate diff --exit-code` shows no difference           |
| `pnpm db:seed` twice                                 | Same counts both runs                                                    |
| Built API with seed data                             | Search returns 4 branches nearest first; menu with prices; favorites 401 |

Gate evidence:

- **Q01** (guest declines location): app test declines location, picks Dubai, browses; the
  search request has the emirate and no coordinates. API test browses by emirate without
  location.
- **Q02** (required option missing / tampered price): API rejects a missing required option
  (422), too many choices, duplicates, foreign and switched-off options, bad quantities, and a
  client-supplied price field (400); the canonical total uses branch prices. App test: Add is
  disabled until the required option is chosen, and the price request carries choices only.
- **Q03** (switch branch with cart): app test shows the confirmation and cancelling keeps the
  cart; unit tests prove a cart never mixes branches.
- **Accessibility smoke**: every pressable on Home, options and cart has a role and a label,
  inputs are labelled, headers are marked, Arabic lays out right to left with the draft notice.
- **Guest cannot check out**: the cart shows the sign-in message and no checkout control.

### Migration and rollback

Forward-only and additive (nullable column, new table). Rollback before production: revert
the merge and recreate development databases.

### Next step

Phase 06: cart and checkout (server cart, quote, holds), which needs sign-in in the app.

## Phase 06 — Cart and checkout (2026-11-27)

### Scope completed

- **Vehicles** (`/v1/vehicles`): list, add, change, remove the customer's own cars (plate
  normalized to upper case, optional emirate and model, at most 10). Orders keep a copy, so
  removing a car never changes an order.
- **Server cart** (`/v1/cart`, `/v1/cart/items`): one active cart per customer, one branch per
  cart (F04). Every item is validated and priced on the server against the branch menu (Q02);
  client prices are unknown fields and are refused. Every change carries `expectedVersion` and
  bumps the version with one conditional update, so two devices cannot overwrite each other.
  Identical lines merge (still at most 20). Switching branch with items needs
  `replaceConfirmed` (Q03); the old cart is kept as abandoned. Lines that stop being orderable
  are shown with an issue (`unavailable`, `options_changed`) instead of being repriced or
  dropped silently.
- **Quotes** (`POST /v1/quotes`): an immutable snapshot of lines, branch prices, totals, pickup
  type, slot (or ASAP), car and policy version, valid 5 minutes (sandbox). Curbside needs one
  of the customer's cars. ASAP needs the branch open now and uses the current 15-minute slot.
  Paused branches, full slots, sold-out stock, dine-in, promo codes, rewards and table tokens
  are refused (the last four with `FEATURE_DISABLED`). A quote holds nothing.
- **Checkout** (`POST /v1/checkout`, Idempotency-Key required): one transaction checks that the
  cart is exactly the quoted version, re-prices every line against the live menu
  (`PRICE_CHANGED` on any difference, Q05), checks the branch, then holds the slot place and
  tracked stock with conditional updates (slot first, then products by ID), and creates the
  reservation, the order (`pending_payment`), immutable order lines, the first timeline event,
  payment attempt 1 and an outbox event. The payment provider is called after commit with the
  stable key `order:<id>:<attempt>`.
- **Payment results** (sandbox provider only):
  - captured: the held slot place becomes confirmed, the reservation is committed and the
    order moves to `received` in one transaction. Only then is it a paid order.
  - failed: the order keeps its holds; checking out the same quote again (new Idempotency-Key)
    makes attempt 2. A new attempt is only made after the previous one is recorded as failed.
  - pending: nothing changes; repeating checkout only re-checks with the provider.
  - Repeating checkout for a quote that already has an order never creates a second order or
    charge (double tap, lost response, replays).
- **Checkout sweep** (every 15 s, `CHECKOUT_SWEEP_ENABLED`): polls open payment attempts and,
  after asking the provider, releases expired holds (slot place and stock), marks the order
  `payment_failed` and gives the customer their cart back. A capture that arrives after the
  release keeps the order failed and raises a `payment.refund_required` outbox event (refunds
  arrive with phase 7, Q08).
- **Orders** (`GET /v1/orders`, `GET /v1/orders/:id`): the customer's own orders with lines,
  totals, pickup details, latest payment status and timeline. Others' orders answer 404.
- **Public slots** now include the slot `id` that quotes use.
- Contracts and OpenAPI 0.5.0 regenerated; route registry matches the API.

### Database (migration `20261127204136_checkout_orders_payments`)

New tables `vehicles`, `carts`, `cart_items`, `quotes`, `reservations`, `reservation_items`,
`orders`, `order_items`, `order_events`, `payments`. Hand-written guards: one active cart per
customer (partial unique index); quantities 1–20; quotes and order lines immutable and order
events append-only (triggers); orders carry the merchant through a composite branch FK;
payments: unique key and provider reference, at most one pending and one captured payment per
order, amount and identity fixed, final status never changes, no deletes. Every order and
payment FK is `ON DELETE RESTRICT`.

### Sandbox values (not approved; please confirm)

- **Pricing policy `sandbox-v1`** (D06): prices include a sample 5% VAT computed as
  round(total × 5 / 105), no customer fee, no discount. Not a legal tax calculation.
- **Quote valid 5 minutes** (docs/07 proposal) and **hold kept 10 minutes** for payment
  (`QUOTE_TTL_SECONDS`, `RESERVATION_TTL_SECONDS`).
- **Fake payment provider** only (refused in production by config). For testing, checkout
  accepts `sandboxOutcome` (succeed, fail, pending); it is refused for any other provider.

### Excluded / follow-ups

- **Checkout in the app**: needs sign-in (D12 and a Supabase test project). The app cart stays
  on the device until then.
- **Webhooks, refunds, real provider** (phase 7). The late-capture refund (Q08) is only flagged.
- **Staff order queue, accept/reject, pickup code** (phase 8). `pickup_code_hash` is set then.
- **Rewards, promo codes, dine-in QR** (phase 9, D07, D14, D16).

### Decisions and spec notes

- Holds are taken at checkout, not at quote time (docs/06: "Checkout atomically reserves";
  docs/02 C07: "Hold slot and stock on payment attempt").
- "Retry with same key" (docs/02 C07) is implemented as the same provider key per attempt: the
  same request key replays the earlier answer, and a retry is a new request for the same quote.
- `cart_items.options` stores the chosen option IDs (a JSON array); order lines store the
  full names and prices as charged.
- Stock stays reserved after payment until completion (docs/08: consumed on completion).
- Added `order_items.line_no` (keeps the cart order), `orders.merchant_id` and
  `orders.reservation_id`, `payments.provider_key` and `failure_code` beyond docs/06.

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                                              |
| `pnpm test`                                          | 62 passed: contracts 6, ui 5, api 37, mobile 14                                   |
| `pnpm test:integration`                              | 137 passed in 15 files (checkout file run 3 more times: 15/15 each, no flakes)    |
| `pnpm --filter @beans/api build`                     | Pass                                                                              |
| Migrations                                           | Applied to fresh databases; `prisma migrate diff --exit-code` shows no difference |
| `pnpm db:seed`                                       | Pass                                                                              |
| Built API with seed data                             | Health up; checkout without a token 401; public slots list slot IDs               |

Gate evidence (all in `apps/api/test/checkout.int.test.ts`):

- **Q02**: client price field 400; missing required option 422; switched-off option 409; cart
  and quote use branch prices (1700 + 300 + 250 = 2250 per cup).
- **Q03**: switching with items 409 until confirmed; cart unchanged; never two active carts;
  another café's product cannot be added.
- **Q04**: two customers race for the last croissant: one 201, one `OUT_OF_STOCK`, stock held
  once. Two race for the last slot place: one 201, one `SLOT_FULL`, slot confirmed 1. A double
  tap on one quote: one order, one charge.
- **Q05**: price change after quote `PRICE_CHANGED`, stock drop `OUT_OF_STOCK`, cart edit
  `QUOTE_EXPIRED`; nothing held or charged in each case.
- **Quote expiry**: an expired quote is refused with `QUOTE_EXPIRED`, no order created.
- **Q06**: success marks `received` only after capture; failure keeps holds and `retryable`,
  the same key replays, a new request makes attempt 2 and captures, no third attempt; pending
  never charges again and settles via the sweep; an expired hold is released only after asking
  the provider, a late capture raises a refund case, and a failed attempt is not retried after
  the hold expired.

### Migration and rollback

Forward-only and additive (new tables only). Rollback before production: revert the merge and
recreate development databases. No production data exists.

### Next step

Phase 07: payments (provider adapter contract, signed webhooks, refunds, Q07 and Q08), sandbox
only until D02–D08 are approved.

## Phase 07 — Payments and finance, sandbox (2026-11-27)

### Scope completed

- **Provider adapter**: the interface now has createPayment, fetchPayment, refund, fetchRefund,
  initiatePayout, fetchPayout, verifyWebhook and a statement for reconciliation. Only the fake
  (sandbox) provider exists; it is refused in production and live payments stay blocked.
- **Signed webhooks** (`POST /v1/webhooks/payments/:provider`): HMAC-SHA256 over the exact raw
  body with a timestamp, a 5-minute replay window, and a durable receipt unique per provider and
  event ID. Forged, altered or stale events answer 401 and store nothing; duplicates answer 2xx
  and do nothing. The handler re-fetches the object from the provider and applies its current
  state, so out-of-order events cannot move anything backwards. Only a hash of the body is
  stored, never the payload.
- **Ledger**: an append-only, balanced journal. Each event posts once (unique source and event
  key) and is checked in code and again by a deferred database trigger at commit. Postings:
  - capture: Dr provider clearing, Cr order liability;
  - completion (for phase 8 to call): Dr liability, Cr merchant payable and commission at the
    effective commission policy;
  - refund before completion: Dr liability, Cr clearing;
  - refund after completion: Dr payable and commission in proportion, Cr clearing;
  - payout paid: Dr merchant payable, Cr clearing.
- **Refunds with dual control**: a finance maker requests; a different finance checker approves
  or rejects. The database refuses self-approval, and a trigger keeps requested, approved,
  submitted and succeeded refunds at or below the captured amount under concurrency. The provider
  is called with `refund:<id>`, and the journal posts only on confirmation.
- **Late capture (Q08)**: a payment captured after its hold expired is refunded in full
  automatically, and a customer notice event is queued.
- **Reconciliation**: compares the provider statement for a period with our payments, refunds and
  payouts (reference, amount, currency, status). Differences become exceptions that block payouts
  for that merchant (or all payouts when no merchant is known) until a checker resolves them with
  a reason.
- **Payout simulation**: a maker drafts the merchant's available payable up to a period end.
  Earnings are allocated under a merchant lock, so two drafts never cover the same earnings. A
  different checker approves. A failed or rejected payout releases its earnings, and the journal
  posts only when the provider confirms.
- **Admin finance API** (finance roles with MFA): payments, refunds (list, request, approve,
  reject), payouts (list, draft, approve, reject), reconciliation (list, run, resolve), trial
  balance. Every decision is audited with reason and request ID. Money mutations need an
  Idempotency-Key.
- **Background sweep** (`CHECKOUT_SWEEP_ENABLED`, every 15 s): retries webhook receipts, polls
  payments, releases expired holds, retries approved refunds and payouts.
- Contracts and OpenAPI 0.6.0. The idempotency layer now honours `@HttpCode` (approvals answer 200).

### Database (migration `20261127205221_payments_finance`)

New tables: `payment_webhook_events`, `refunds`, `journal_transactions`, `journal_lines`,
`payouts`, `payout_allocations`, `reconciliation_runs` and `reconciliation_exceptions`.

Guards:

- Refund total kept within the captured amount (a trigger that locks the payment row).
- Maker must differ from checker on refunds and payouts (CHECKs).
- Final refund and payout statuses never change, and their amounts are fixed.
- Journals, journal lines and allocations are append-only.
- Each journal line has exactly one positive side, from a fixed list of accounts.
- Every journal is balanced with at least two lines (deferred constraint trigger).
- An exception can only be resolved with a reason.

### Sandbox values and open decisions (not approved)

- **Commission 10%** (`commission/sandbox-v1`, D02), on the amount paid less refunds before
  completion. **Payout schedule, holds, negative balances** (D04): payouts are drafted manually
  and refused when nothing is available.
- **Accounting treatment** is a model for sandbox only; an accountant and the provider must
  validate it. Processor fees and tax accounts are not posted until D03 and D06 are approved.
- **Late capture**: refunded, not restored. The docs/08 state machine has no way back from
  `payment_failed`.

### Excluded / follow-ups

- **Real provider, payout onboarding, bank details**: need D03 and D04 and a provider choice.
- **Automatic daily reconciliation schedule**: runs are started from the admin API for now.
- **Completion posting** is implemented and tested; phase 8 calls it when an order is completed.
  **Refunds for rejected or cancelled orders** come with phase 8.
- **Admin finance screens** (A05): API only. Screens need sign-in to the admin console (D12).

### Commands and actual results (local run, 2026-11-27)

| Command                                              | Result                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Pass                                                             |
| `pnpm test`                                          | 71 passed: contracts 6, ui 5, api 46, mobile 14                  |
| `pnpm test:integration`                              | 145 passed in 16 files (finance file run 3 more times: 8/8 each) |
| `pnpm --filter @beans/api build`                     | Pass                                                             |
| Migrations                                           | Applied; `prisma migrate diff --exit-code` shows no difference   |
| Built API                                            | Unsigned webhook 401; admin finance without a token 401          |

Gate evidence (`apps/api/test/finance.int.test.ts`, `checkout.int.test.ts`, unit tests):

- **Q06**: phase 6 evidence still passes. A pending payment captured by webhook makes the order
  received, and the capture is posted once.
- **Q07**:
  - Forged, altered, stale and unsigned webhooks give 401 and store nothing.
  - An unknown provider path gives 404.
  - A duplicate event ID is acknowledged as a duplicate.
  - The same change sent under a new event ID, and a stale "failed" event after capture, leave
    the order received with exactly one capture posting.
  - Unknown objects are ignored.
- **Q08**: a late capture after the hold expired keeps the order failed and refunds 2400 in
  full. The ledger nets to zero and the customer notice is queued.
- **Q13**:
  - Two makers racing to refund 1500 of 2400: one 201, one `REFUND_LIMIT`.
  - Self-approval is refused, even for a user holding both roles.
  - A failed provider refund frees the amount and posts nothing.
  - A replayed request returns the same refund.
  - A direct database insert over the limit is refused.
  - Every decision is audited.
- **Q14**:
  - A clean run has no differences.
  - A provider amount change creates an `amount_mismatch` exception for the merchant.
  - That exception blocks the merchant's payouts until a checker resolves it with a reason.
  - Makers cannot resolve.
- **Payouts**:
  - Two concurrent drafts: one 201, one 422.
  - The maker cannot approve their own draft.
  - The paid amount is the payable net of refund reversals (2160 − 540 = 1620).
  - A failed payout releases its earnings, and a rejected payout cannot be approved.
- **Q23 and no duplicate capture**:
  - The trial balance is balanced with no unbalanced journals.
  - An unbalanced posting fails at commit, a two-sided line is refused, and journal edits are
    refused.
  - Posting a capture again records nothing new.
  - For one merchant, clearing equals captured − refunded − paid out, payable nets to zero, and
    all lines sum to zero.

### Migration and rollback

Forward-only and additive (new tables, triggers and functions). Rollback before production:
revert the merge and recreate development databases.

### Next step

Phase 08: fulfillment (staff order queue, accept or reject with refund, preparation, pickup code,
curbside arrival, completion posting).

## Phase 08 — Fulfilment (2026-11-27)

### Scope completed

- **Branch queue** (`GET /v1/merchant/orders?branchId=`, `GET /v1/merchant/orders/:id`): the
  live queue (received, accepted, preparing, ready; oldest first) or one status (newest first).
  Owners see every branch; managers and baristas only their assigned branches; analysts are
  refused (403); other branches answer 404. Staff never see unpaid orders. The view is
  operational only: items, options, notes, pickup time, ETA, acceptance deadline, curbside car,
  arrival, and a "cancellation requested" flag. No customer name, contact or payment data.
- **Staff steps** (`POST /v1/merchant/orders/:id/transition`, Idempotency-Key required):
  `accept` (ETA 1–120 minutes), `reject` (reason), `start`, `ready`, `complete` (six-digit
  pickup code). Each step locks the order, checks `expectedVersion` (stale = 409 with the
  current version) and the state machine (`INVALID_TRANSITION`), and writes status, timeline
  event and outbox signal together. A database trigger enforces the same state machine, so
  terminal orders can never move and steps cannot be skipped.
- **Rejection and acceptance timeout (Q09)**: a rejected order, or one not accepted within
  120 s (sandbox D10, `ACCEPT_TIMEOUT_SECONDS`), ends; its slot place and held stock are
  released and an automatic full refund (kind `order_cancelled`) is sent to the sandbox
  provider; the customer notice is queued. The background sweep runs the timeout check every
  15 s, locking and re-checking each order so a tablet accepting at the same moment wins or
  loses cleanly. An accept after the deadline is refused even before the sweep runs.
- **Handoff**: the pickup code is derived from the order ID with a server secret
  (`PICKUP_CODE_SECRET`) so the customer app can always show it, while the database keeps
  only a salted hash (docs/10). Wrong codes answer 422; five in a row lock completion for five
  minutes (429). Completion consumes the held stock and posts the completion journal
  (commission sandbox 10%) exactly once.
- **Curbside (Q11)**: `POST /v1/orders/:id/arrival` after acceptance only; repeats return the
  same arrival. Staff acknowledge with `POST /v1/merchant/orders/:id/ack-arrival`; repeats
  return the same acknowledgement. Completion never happens from location, only with the code.
- **Cancellation (Q12, D05 sandbox)**: `POST /v1/orders/:id/cancel-requests`. Before
  acceptance the order is cancelled and refunded at once. After acceptance an open request is
  created for operations (one per order) and nothing else changes. Operations can decline
  (`POST /v1/admin/cancellation-requests/:id/decline`) or cancel the order
  (`POST /v1/admin/orders/:id/cancel`): before acceptance with an automatic refund; after
  acceptance without one (finance refunds through maker-checker). Both are audited.
- **Receipt** (`GET /v1/orders/:id/receipt`): from immutable snapshots only, with paid and
  refunded amounts; marked `sandbox: true, taxInvoice: false` (D06). 409 before payment.
- **Order detail** now includes ETA, pickup code (only while open), arrival, refunds and the
  latest cancellation request. History uses the existing `GET /v1/orders`.
- **Live updates (Q17)**: server-sent events at `GET /v1/merchant/branches/:id/order-events`
  and `GET /v1/orders/:id/events`. The outbox worker publishes each committed
  `order.updated` row to Redis pub/sub; every API instance forwards matching events as
  `{type, orderId, version, occurredAt}` with no personal data. Clients refetch the canonical
  order or queue on every event and after every reconnect; retried taps replay through the
  idempotency key and stale queued taps get 409, so reconnecting never duplicates a change.
  A heartbeat every 25 s re-checks access and ends the stream if it was removed.
- Contracts and OpenAPI 0.7.0 (11 new routes); route registry matches the API.

### Database (migration `20261127213746_fulfillment`)

New table `cancellation_requests` (one open request per order, reason 3–500 characters,
resolution reason required once decided). New order columns: `accept_by`, `arrived_at`,
`arrival_ack_at`, `arrival_ack_by`, `pickup_code_failures`, `pickup_code_locked_until`. New
refund kind `order_cancelled`. Trigger `orders_state_machine` (allowed status steps only,
version must increase, arrival only once and only for curbside open orders) and
`orders_no_delete`.

### Sandbox values and open decisions (not approved)

- **D10**: 120 s to accept; ETA 1–120 minutes (docs/07).
- **D05**: customer cancellation is automatic before acceptance, support review after. No
  no-show or forfeiture rules (none approved); no curbside pickup window enforced (not
  specified).
- Security defaults (not policy): six-digit code, lock after five wrong codes for five minutes.

### Excluded / follow-ups

- **Tablet and customer app screens** (T01–T06, C08, C09): the API is complete, but staff and
  customers cannot sign in to the web or mobile apps until D12 and a Supabase test project
  exist. The tablet route still says the queue is not built.
- Reorder (`POST /orders/:id/reorder`) and support tickets (`/tickets`) belong with operations
  (phase 10).
- Push notifications: events are queued in the outbox; no provider is approved.

### Commands and actual results (local run, 2026-11-27)

| Command                                            | Result                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                            |
| `pnpm test`                                        | 76 passed: contracts 6, ui 5, api 51, mobile 14 |
| `pnpm test:integration`                            | 161 passed in 17 files (fulfilment 16)          |
| `pnpm --filter @beans/api build`                   | Pass                                            |
| `prisma migrate diff … --exit-code`                | No difference                                   |

Phase gate: Q09, Q10, Q11, Q12 and Q17 each have an integration test, and one test runs a full
order end to end (pay, accept, prepare, ready, hand over with the code, receipt).

### Migration and rollback

Additive. Rollback: drop the two triggers and `guard_order_transition()`, drop
`cancellation_requests` and its enum, and drop the six new order columns. The enum value
`order_cancelled` cannot be removed while refunds use it.

### Next step

Phase 09 (rewards, gifts, table QR) was deferred here, then built in sandbox on 2026-11-28 (see below).

## Phase 09 — Engagement, sandbox (back end 2026-11-28)

Deferred on 2026-11-27. The founder un-deferred it on 2026-11-28 (stamp cards, promotions
moderated by admin, QR dine-in, sandbox gifting; no reloadable wallet). Built for development
and sandbox only. Commercial terms below are sandbox values waiting on the founder.

### Scope completed (API)

- **Rules for every benefit.** The server works out each benefit at quote time from what it
  stores; the client sends only a reward card ID, promo code or gift ID, never an amount. One
  benefit per order. Every benefit is funded by the merchant (D16 platform funding stays open).
  A discounted order still charges at least AED 1 (`MIN_CHARGE_FILS`, sandbox). The benefit is
  snapshotted on the quote and the order. It is held at checkout, confirmed when payment lands
  (`received`), and released when payment fails, the café rejects, or the order is cancelled.
- **Stamp cards** (`/v1/merchant/stamp-card`, `/v1/branches/:id/stamp-card`, `/v1/me/stamps`,
  `/v1/me/stamps/events`). One card per business. One stamp per item when an order is
  completed. A reward takes one item's price off, up to the card's maximum. The ledger
  (`stamp_events`) is append-only (database trigger), and has at most one earn, redeem,
  release and reverse per order (unique key), so replays do nothing. A full refund reverses
  the earned stamps once. The balance can go negative if the stamps were already spent.
  Owners change the card; each change bumps `termsVersion` and is audited.
- **Promotions** (`/v1/merchant/promotions…`, `/v1/admin/promotions…`). Owners create
  percent or fixed codes with a window, minimum, cap, total limit and per-customer limit.
  Codes go draft → submit → pending review → approved or rejected (marketing admins, with a
  reason, audited). Approved codes can be paused, resumed and ended. Redemptions are counted
  under a row lock and the database rejects going over the limit.
- **Dine-in tables** (`/v1/merchant/branches/:id/tables…`, `/v1/tables/resolve`). Branch
  managers add, rotate and retire tables. A QR token is `t1.<table>.<version>.<HMAC>` signed
  with `TABLE_TOKEN_SECRET` (required in production). Rotating or retiring bumps the version, so
  printed codes stop working at once. Forged, rotated, retired or other-branch codes are
  refused. The table is snapshotted on the order and shown to staff.
- **Sandbox gifts** (`/v1/gifts`, `/v1/gifts/claim`, `/v1/admin/gifts`). A customer issues a
  gift for one published product. Nothing is charged and nothing is posted to the journal. The
  claim token is shown once and only its SHA-256 hash is stored. Exactly one person can claim a
  gift (conditional update), and the buyer cannot claim their own. The recipient uses it once,
  for that product at that business, within 30 days (sandbox). Gifts are refused whenever
  `NODE_ENV=production`, whatever the feature flag says.
- **Feature flags.** `features.stampCards`, `promotions`, `dineIn` and `sandboxGifts` default to
  off. The sandbox seed turns them on and adds a stamp card for café A (5 stamps, up to AED
  25), the approved code `SANDBOX10` (10%, up to AED 10) and table T1 at the Corniche branch,
  which now offers dine-in.

### Files

- Contracts: `packages/contracts/src/api/engagement.ts` (new), plus `ordering.ts` (`giftId`,
  `benefit`, `fulfillment.table`), `fulfillment.ts`, `routes.ts` (20 routes) and `openapi.json`.
- API: `src/engagement/` (`benefits.service.ts`, `table-tokens.ts`, controllers, modules),
  plus hooks in `quote.service.ts`, `checkout.service.ts`, `payment-reconciler.service.ts`,
  `refund.service.ts`, `pricing.ts`, `order-views.ts` and `orders.controller.ts`, `env.ts`
  (`TABLE_TOKEN_SECRET`) and `prisma/seed.ts`.
- Migration `20261128081058_engagement`: seven tables (stamp cards, accounts and events,
  promotions and redemptions, branch tables, gifts), `benefit` JSON on quotes and orders,
  CHECK constraints, the append-only trigger, the redemption limit check and a partial unique
  index on active table labels.

### Commands and results (2026-11-28)

- `npx vitest run --project integration`: 23 files, 201 tests passed, including
  `test/engagement.int.test.ts` (5 tests: Q19, Q20 twice, Q21, promotion review and limits).
- `npx vitest run --project unit`: 14 files, 61 tests passed. `tsc --noEmit` and `eslint .` are
  clean.
- Changed existing tests, with no coverage removed. `checkout.int` now expects a table code on a
  pickup order to be a validation error, while dine-in with the feature off is still
  `FEATURE_DISABLED`. `fulfillment.int` sweeps with a larger batch, because the shared test
  database holds more than 50 older unaccepted orders.

### Screens (2026-11-28, second PR)

- **Business portal** `/loyalty` ("Loyalty and promotions"). Owners edit the stamp card and
  create, edit, submit, pause, resume and end promotions, and see the review note. Owners and
  managers manage tables per branch: a printable QR code for each table (`qrcode` 1.5.4, drawn
  in the browser), and replace or remove a code. The QR opens the customer app with
  `?table=<signed token>` (`NEXT_PUBLIC_CUSTOMER_APP_URL`, default `http://localhost:8081`).
- **Barista tablet and portal orders**: the ticket shows the table and the benefit with its
  discount.
- **Admin console** `/promotions` (marketing and operations; only marketing decides). It has a
  review queue with approve or reject plus a reason, status filters, and a gifts list.
- **Customer app**:
  - A "Rewards and gifts" screen shows stamp progress per café, lets the customer claim a
    gift code, and lists gifts sent and received.
  - "Send as a gift" on a product gives a one-time code to share.
  - "Order at a table" checks a scanned or typed code with the server. The web app opens it
    straight from the QR link.
  - Checkout adds a "Savings" choice (stamp reward, a gift for this café, or a promo code) and
    dine-in when a table is chosen. Only IDs and codes are sent. Amounts come from the quote.
- Camera scanning inside the native app is not built. The phone camera opens the QR link.

### Tests and evidence (screens)

- Mobile `engagement.test.tsx`: 8 tests. Promo code and reward are sent as codes or IDs only,
  checkout still works with the features off, dine-in sends the signed token, a rejected table
  code is shown, and gift claim and share are covered. Mobile total: 31 tests passed.
- Browser `engagement.spec.ts` covers an owner promotion, then marketing approval, then live,
  plus manager table add, QR, replace and remove. `customer.spec.ts` covers ordering from a
  table's QR link with `SANDBOX10`, and the café ticket shows table T1 and the promotion. All 23
  browser tests passed locally.
- Screenshots: `/mnt/project-files/evidence/phase-9/` (7 PNGs).

### Open questions for the founder

Minimum charge on a discounted order (AED 1 sandbox). Whether every item earns a stamp.
Reversal only on a full refund, with negative balances allowed. Gift validity of 30 days.
Promotions funded only by the merchant (D16). Reward and promo code cannot be combined.

### Rollback

Turn the four feature flags off (no deploy needed). To remove the feature, revert the PR and
drop the seven new tables, their enums and the two `benefit` columns. Orders that used a
benefit keep their snapshot only in those columns.

## Phase 10 — Operations and insights (2026-11-27)

### Scope completed

- **Support tickets** (`/v1/tickets`, `/v1/tickets/:id`, `/v1/tickets/:id/messages`): customers
  raise tickets, optionally about their own order; owners and managers raise tickets for their
  merchant, optionally about that merchant's orders. Each side sees only its own tickets (others
  404). Messages are append-only (database trigger); a reply from the requester reopens a ticket.
- **Support queue** (`/v1/admin/tickets…`, support and operations): all tickets, internal notes
  (never shown to customers or merchants; a database CHECK allows them only from support),
  status, priority and assignee changes (audited; assignee must be a support or operations
  admin).
- **Privacy requests (Q24)**: `POST /v1/me/privacy-requests` (access, correction, deletion)
  opens a high-priority privacy ticket and is audited. `GET /v1/admin/privacy-requests/:id/export`
  (support or security) returns only the requester's own data for an access request and is
  audited. Nothing is deleted automatically (D11).
- **Merchant dashboard and analytics** (`/v1/merchant/dashboard`, `/v1/merchant/analytics`):
  owners, managers and analysts, limited to the branches in their scope. Paid, completed,
  rejected and cancelled orders, gross, refunded and net sales, average prep time, live queue;
  completed orders per Dubai day and top products. Definitions are written on the contract
  schemas, and the tests rebuild the numbers from raw rows.
- **Admin overview** (`/v1/admin/dashboard`, optional city): GMV, refunds, orders, active shops,
  pending approvals, open tickets and cancellation requests, and alerts (failed outbox rows,
  webhooks waiting over 5 minutes, failed refunds or payouts, open reconciliation exceptions,
  orders past their acceptance time).
- **Reports** (`/v1/admin/reports`): orders or refunds per merchant, aggregates only, every view
  audited.
- **Settings** (`/v1/admin/settings`, read only): feature switches, timeouts, currency,
  timezone, provider and policy versions (sandbox flagged).
- Audit viewer already existed (phase 2, security role).
- Contracts and OpenAPI 0.8.0 (15 new routes).

### Gate evidence

- **Q15** (tenant B reaching A): denied for the order queue and live stream (phase 8 tests),
  tickets, dashboard and analytics (this phase), and files (phase 3 upload tests).
- **Q16**: a revoked barista gets 404 on orders and transitions; a suspended merchant
  disappears from discovery, refuses new carts, and its staff lose the queue.
- **Q24**: request and export scoped to the requester and audited.
- Aggregates reconcile with raw rows; reports contain no personal data and are audited.

### Excluded / follow-ups

- Admin and portal screens (A01–A10, B01, B09, support screens): blocked on sign-in (D12).
- Async, expiring file exports: reports are returned as JSON aggregates; a file export with
  download links needs the storage provider (open since phase 3).
- Editing settings and policies (`POST /admin/policies`, approve): needs approved decisions;
  read-only for now.
- Campaigns (A07): phase two.
- docs/07 lists one `/tickets` route for customers, merchants and admins; admin access is
  served under `/v1/admin/tickets` so the MFA admin guard always applies.

### Commands and actual results (local run, 2026-11-27)

| Command                                      | Result                                          |
| -------------------------------------------- | ----------------------------------------------- |
| `pnpm format`, `pnpm lint`, `pnpm typecheck` | Pass                                            |
| `pnpm test`                                  | 76 passed: contracts 6, ui 5, api 51, mobile 14 |
| `pnpm test:integration`                      | 168 passed in 18 files (operations 7)           |

### Migration and rollback

`20261127215200_operations`: new tables `tickets` and `ticket_messages` and their enums,
CHECKs and append-only triggers. Additive. Rollback: drop both tables and the seven enums.

## Phase 11 — Hardening (2026-11-27)

Full results, the Q01–Q24 matrix, threat model and dependency review are in
[14-hardening-report.md](14-hardening-report.md).

### Scope completed

- **Rate limits** on sensitive routes (checkout, quote, staff actions, check-in, cancellation,
  uploads, tickets, privacy requests, reports and exports, provider webhooks), per user or IP,
  in Redis. 429 with `Retry-After`. `RATE_LIMIT_ENABLED` cannot be false in production.
- **Security headers** on every response.
- **Concurrency**: 12 simultaneous buyers for 5 units sell exactly 5.
- **Provider outage at checkout (Q22)**: the order stays pending; a retry uses the same attempt
  and provider key, so there is one payment.
- **Backup and restore drill** (`apps/api/scripts/backup-restore-check.sh`): restored copy
  matches row counts and the journal balances.
- Q01–Q24 matrix: every applicable scenario has a passing test; Q18 is partial (device audit
  needed); Q19–Q21 are phase two.

### Commands and actual results (local run, 2026-11-27)

| Command                                            | Result                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                                            |
| `pnpm test`                                        | 77 passed: contracts 6, ui 5, api 52, mobile 14                 |
| `pnpm test:integration`                            | 172 passed in 19 files (hardening 4)                            |
| `backup-restore-check.sh` on the test database     | OK: dump 1 s, restore under 1 s, counts match, journal balances |
| `pnpm audit --prod --audit-level high`             | No high or critical advisories                                  |
| `pnpm audit`                                       | 4 moderate, build and test tooling only                         |

### Migration and rollback

No database change. Rollback: revert the commit (rate limits and headers are code only).

### Remaining blockers

Staging environment and hosting (load tests, production backups, RPO/RTO), device
accessibility audit (D15), external penetration test and SAST, step-up MFA for role and bank
changes, and sign-in for all screens (D12).

## Phase 12 — Release preparation (2026-11-27)

The plan, launch gates, environments, release and migration procedure, monitoring, runbook,
rollback, privacy and app store checklist, and pilot plan are in
[15-release-plan.md](15-release-plan.md). Nothing was deployed and no production credential,
live payment or real notification was enabled.

### Scope completed

- **Release plan** with twelve launch gates (G1–G12), each with evidence and owner.
- **Migration safety check**: `pnpm --filter @beans/api db:check-migrations`
  (`apps/api/src/release/migration-guard.ts`) refuses migrations that drop, rename, truncate,
  delete, update without `WHERE`, change column types or disable triggers unless the file names
  an approval (`-- release: destructive-approved <who, date, why>`). Runs in CI before migrations.
  All 8 existing migrations are additive.
- **Runbook** R1–R8 (database, Redis, provider outage, outbox backlog, branch not accepting,
  restore, compromise, bad release), **monitoring** signals mapped to what exists today, and a
  **rollback** table.
- **Privacy and app store checklist** and a two-stage **pilot plan** (sandbox, then a controlled
  live pilot only after the money decisions and written approval).

### Finding

The API cannot start in production mode today, by design: it refuses the fake payment provider,
local file storage, the basic file checker and live payments. Staging therefore needs the payment
provider's sandbox adapter (D03), object storage and a malware scanner before it can run.

### Commands and actual results (local run, 2026-11-27)

| Command                                            | Result                                          |
| -------------------------------------------------- | ----------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | Pass                                            |
| `pnpm test`                                        | 83 passed: contracts 6, ui 5, api 58, mobile 14 |
| `pnpm --filter @beans/api db:check-migrations`     | OK: 8 migrations checked, all additive          |
| `pnpm build`                                       | Pass                                            |

Integration tests were not re-run locally: no API runtime code changed since phase 11
(172 passed); CI runs them on the pull request.

### Migration and rollback

No database change. Rollback: revert the commit (documents, a script and a CI step).

### Completion gate

Not met, as expected: the phase 12 gate needs explicit owner signoff, approved decisions, pilot
and external review evidence. These are listed as gates G1–G12 in docs/15.

## Cycle 2 — Four interfaces against the backend (2026-11-28, in progress)

Founder instruction of 2026-11-28: complete and test the customer app, business portal, barista
tablet and admin console against the backend, sandbox only. Evidence per screen is in
docs/16-completion-matrix.md.

| Part                                                                                                         | PR      | Tests added                                                  |
| ------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------ |
| Development sign-in, business portal, merchant finance                                                       | #12     | dev-auth, finance B09, tenancy                               |
| Barista tablet                                                                                               | #13     | tablet.int (3)                                               |
| Admin back end: settings, pause, homepage, customers, orders, roles, moderation, disputes, broadcasts, inbox | #14     | platform.int (10)                                            |
| Admin console screens, browser test suite and CI job                                                         | #15     | e2e: 13 admin, 3 portal, 2 tablet; API: privacy queue filter |
| Customer app: sign-in, checkout, tracking, history, receipts, account, support, notifications                | this PR | mobile: 9 new (23 total); e2e: 2 customer (web build)        |

### Admin console

- Fourteen screens in `apps/admin`, each shown only to the admin roles the API accepts for it.
  Every session must complete two-step verification (aal2) before any screen loads, and the
  API checks the same on every admin route. super_admin has no implicit access.
- Every decision asks for a written reason that goes to the audit log. Money decisions are
  maker/checker. Refund and dispute amounts are entered in AED and converted to integer fils
  without floating point.
- Announcements reach in-app inboxes only. No SMS, email or push is sent.
- Arabic strings are drafts for layout testing and need native review.

### Browser tests (`e2e/`)

- Playwright against the real API, PostgreSQL and Redis with seeded fictional accounts and
  development sign-in. `pnpm test:e2e` starts the three servers when they are not running.
- Global setup keeps the seeded test branch open around the clock and reopens ordering if an
  earlier run left the platform paused.
- CI job "Browser tests" migrates and seeds an empty database, builds everything, generates
  per-run random signing secrets and keeps the HTML report when a test fails.

### Customer app (`apps/mobile`)

- Sign-in: phone or email one-time code through Supabase Auth when `EXPO_PUBLIC_SUPABASE_URL`
  and the public anon key are set; the refresh token is kept in the device keychain
  (expo-secure-store), never in AsyncStorage. Without Supabase, a build with
  `EXPO_PUBLIC_DEV_AUTH=true` lists the fictional seeded customers (the API refuses this in
  production). Apple and Google sign-in need Apple/Google developer credentials and are not
  offered yet. A 401 ends the session and asks the customer to sign in again.
- Checkout copies the device cart to the server cart, asks the server for a quote (price, VAT
  and pickup time come only from the server) and pays with the fake provider. Each payment
  attempt sends its own Idempotency-Key. A simulated decline keeps the customer on checkout;
  the declined attempt uses up the server cart, so the app copies the cart again before the
  next quote (found in the real-app walk and fixed).
- Order screen polls every 5 seconds while the order is open: status steps, ETA, pickup code,
  curbside "I've arrived" (with the order version), cancellation request, refunds, receipt and
  help. Also: order history, vehicles, help requests with replies, in-app notifications, name,
  privacy access and deletion requests, saved cafés, homepage hero and featured shops, and the
  platform pause notice.
- The app exports for the web (`pnpm --filter @beans/mobile export:web`, react-native-web).
  The browser tests run that build on a phone-sized screen against the real API: guest browse,
  sign-in, declined then successful sandbox payment, café steps to collection with the pickup
  code, receipt, and Arabic right to left.
- Known sandbox limit: the fake payment provider keeps payments in memory. After an API
  restart, refunds of payments taken before the restart fail at the provider and are retried
  (they stay "approved" and are visible to finance). The Tap sandbox adapter will not have this.

### Rollback

Revert the PR. No migration in this part. The two contract additions (`category` filter on
ticket lists, `version` on admin orders) are additive.

## Decision and change log

Record date, author, decision ID, old/new behavior, approval and affected files.

| Date       | Author | Decision    | Change                                                                                            | Approval                           |
| ---------- | ------ | ----------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-11-27 | Claude | D13         | Neutral working name "Coffee Marketplace" used in all UI; no BEANZ marks                          | Proposed default, not approved     |
| 2026-11-27 | Claude | D02         | Seeded `commission/sandbox-v1` (10%, sandbox flag, unapproved) for development only               | Proposed default, not approved     |
| 2026-11-27 | Claude | D12         | Sign-in verified via any Supabase provider; admin routes require aal2 (MFA)                       | Channels and SMS vendor not chosen |
| 2026-11-27 | Claude | D10         | 15-minute pickup slots, capacity per branch (sandbox values)                                      | Proposed default, not approved     |
| 2026-11-27 | Claude | —           | Staff invitations expire after 72 hours; no email sent until a provider is approved               | Proposed default, not approved     |
| 2026-11-27 | Claude | D01         | Customer app defaults to Abu Dhabi; any of the seven emirates can be chosen                       | Proposed default, not approved     |
| 2026-11-27 | Claude | —           | At most 20 of one item per cart line (sandbox limit)                                              | Proposed default, not approved     |
| 2026-11-27 | Claude | D06         | Pricing policy `sandbox-v1`: tax-inclusive, sample 5% VAT, no fee, no discount                    | Proposed default, not approved     |
| 2026-11-27 | Claude | —           | Quotes valid 5 minutes; checkout holds slot and stock 10 minutes for payment                      | Proposed default, not approved     |
| 2026-11-27 | Claude | D02         | Commission posted at completion on amount paid less refunds (sandbox 10%)                         | Proposed default, not approved     |
| 2026-11-27 | Claude | D03         | Payment captured after hold expiry is refunded in full automatically                              | Proposed default, not approved     |
| 2026-11-27 | Claude | D04         | Payouts drafted manually by maker, approved by a different checker (sandbox)                      | Proposed default, not approved     |
| 2026-11-27 | Claude | D10         | Branch has 120 s to accept; unaccepted paid orders cancelled and refunded automatically (sandbox) | Proposed default, not approved     |
| 2026-11-27 | Claude | D05         | Customer cancel: automatic with refund before acceptance; support review after; no no-show rules  | Proposed default, not approved     |
| 2026-11-27 | Owner  | Process     | Build and merge remaining phases without per-phase approval; one final report                     | Instructed by owner                |
| 2026-11-28 | Owner  | D07/D08/D14 | Phase 9 un-deferred for sandbox: stamp cards, moderated promotions, QR dine-in, sandbox gifts     | Instructed by owner (sandbox only) |
| 2026-11-28 | Claude | D07         | One stamp per item on completion; reward = one item up to card maximum; reversed on full refund   | Proposed default, not approved     |
| 2026-11-28 | Claude | D16         | Promotions funded by the merchant only; one benefit per order; AED 1 minimum charge               | Proposed default, not approved     |
| 2026-11-28 | Claude | D08         | Gifts: sandbox only, no charge, one claimant, valid 30 days, refused in production                | Proposed default, not approved     |

## Phase handoff template

- Scope completed / excluded
- Files and migration IDs
- Commands and actual results
- Acceptance criteria met / failing
- Risks, unapproved decisions, rollback and next step
