# Implementation progress

Status: phases 01–02 merged; phase 03 implemented, awaiting owner review. No production
integrations or real money.

| Phase | Status                 | Commit                      | Tests                                  | Blockers                                      |
| ----- | ---------------------- | --------------------------- | -------------------------------------- | --------------------------------------------- |
| 01    | Done (merged)          | 2db5b9c                     | 17 unit, 3 integration, all apps build | None                                          |
| 02    | Done (merged)          | 6a8a569                     | 28 unit, 52 integration                | D12 before production sign-in                 |
| 03    | Done (merged)          | 6d21d02                     | 32 unit, 71 integration                | Storage provider, malware scanner (D11)       |
| 04    | Done (merged)          | 63496dc                     | 37 unit, 108 integration               | D10 (slot length), invite delivery            |
| 05    | Implemented, in review | branch `phase-05-discovery` | 54 unit, 122 integration               | D12 (app sign-in), D13 before production copy |
| 06    | Not started            | —                           | —                                      | D02, D06 for real pricing                     |
| 07    | Not started            | —                           | —                                      | D02–D04, D06 before any live provider         |
| 08    | Not started            | —                           | —                                      | D05, D10                                      |
| 09    | Deferred (not in MVP)  | —                           | —                                      | D07, D08, D14, D16                            |
| 10    | Not started            | —                           | —                                      | See decision register                         |
| 11    | Not started            | —                           | —                                      | See decision register                         |
| 12    | Not started            | —                           | —                                      | D01, D11, D15 and all money decisions         |

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

## Decision and change log

Record date, author, decision ID, old/new behavior, approval and affected files.

| Date       | Author | Decision | Change                                                                              | Approval                           |
| ---------- | ------ | -------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| 2026-11-27 | Claude | D13      | Neutral working name "Coffee Marketplace" used in all UI; no BEANZ marks            | Proposed default, not approved     |
| 2026-11-27 | Claude | D02      | Seeded `commission/sandbox-v1` (10%, sandbox flag, unapproved) for development only | Proposed default, not approved     |
| 2026-11-27 | Claude | D12      | Sign-in verified via any Supabase provider; admin routes require aal2 (MFA)         | Channels and SMS vendor not chosen |
| 2026-11-27 | Claude | D10      | 15-minute pickup slots, capacity per branch (sandbox values)                        | Proposed default, not approved     |
| 2026-11-27 | Claude | —        | Staff invitations expire after 72 hours; no email sent until a provider is approved | Proposed default, not approved     |
| 2026-11-27 | Claude | D01      | Customer app defaults to Abu Dhabi; any of the seven emirates can be chosen         | Proposed default, not approved     |
| 2026-11-27 | Claude | —        | At most 20 of one item per cart line (sandbox limit)                                | Proposed default, not approved     |

## Phase handoff template

- Scope completed / excluded
- Files and migration IDs
- Commands and actual results
- Acceptance criteria met / failing
- Risks, unapproved decisions, rollback and next step
