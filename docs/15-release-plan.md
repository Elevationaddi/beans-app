# Release plan, runbook and pilot (phase 12, 2026-11-27)

This is the plan for taking the marketplace from local development to a staging environment,
a sandbox pilot and, only after explicit approval, a controlled live pilot. Nothing here has
been deployed. No live payment, production credential or real notification has been enabled.
Values marked **owner decision** are not invented here; they are launch blockers until the
founder (or the named owner) records them in docs/00-decisions.md.

## 1. Where things stand

| Area                                     | State                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| API (all MVP modules, phases 1–8, 10–11) | Built and tested locally; 8 additive migrations                                     |
| Customer app (Expo)                      | Browse, branch, menu, cart as guest; order screens blocked on sign-in (D12)         |
| Merchant portal, tablet, admin console   | Shells only; screens blocked on sign-in (D12), recorded as phase 9 deferred         |
| Payments                                 | Sandbox fake provider only; the API refuses it in production; live payments blocked |
| File storage and malware scan            | Local disk and a basic checker; both refused in production (provider not chosen)    |
| Hosting, staging, monitoring vendor      | Not chosen (D11)                                                                    |

**Consequence:** the API cannot start with `NODE_ENV=production` today, by design. It refuses the
fake payment provider, local storage, the basic file checker, missing secrets, a missing CORS
allowlist and `LIVE_PAYMENTS_ENABLED=true`. Staging must run the production configuration with
real sandbox adapters, so staging needs three adapters that do not exist yet: the payment
provider's sandbox (D03), object storage, and a malware scanner. These are the first items of
release work once the providers are chosen.

## 2. Launch gates

Every gate needs evidence and a named approver. A gate that is not signed blocks the step after it.

| #   | Gate                                                       | Blocks                         | Evidence                               | Owner            |
| --- | ---------------------------------------------------------- | ------------------------------ | -------------------------------------- | ---------------- |
| G1  | Hosting provider and region chosen (D11)                   | Staging                        | Decision log entry                     | Founder          |
| G2  | Sign-in channels and Supabase project (D12)                | Staging E2E                    | Decision log entry, test project       | Founder          |
| G3  | Payment provider chosen, sandbox adapter built (D03)       | Staging E2E                    | Adapter tests against provider sandbox | Founder, eng     |
| G4  | Storage provider and malware scanner chosen and integrated | Merchant onboarding in staging | Adapter tests                          | Founder, eng     |
| G5  | Brand, name, translations reviewed (D13)                   | Store submission               | Native Arabic review signed            | Founder          |
| G6  | Accessibility audit on devices (D15, Q18)                  | Pilot                          | Audit report                           | External auditor |
| G7  | Security review: external penetration test, SAST           | Pilot                          | Report with no open high findings      | External tester  |
| G8  | UAE privacy and legal review (D11), privacy policy, terms  | Pilot                          | Signed review, published policy        | Legal counsel    |
| G9  | Money decisions D02–D08 approved, merchant contracts       | Live pilot                     | Decision log, signed contracts         | Founder, finance |
| G10 | Sandbox pilot exit criteria met (section 7)                | Live pilot                     | Pilot report                           | Founder, ops     |
| G11 | On-call owner, support hours, escalation (D10)             | Pilot                          | Named rota                             | Founder          |
| G12 | Release and rollback signoff for each production release   | Every release                  | Signed checklist (section 4)           | Release owner    |

Live money stays off in code (`LIVE_PAYMENTS_ENABLED` is refused) until G9. Turning it on needs a
code change reviewed against the approved decisions, not a configuration switch.

## 3. Environments

| Environment | Purpose                          | Data                       | Payments         | Notifications                |
| ----------- | -------------------------------- | -------------------------- | ---------------- | ---------------------------- |
| Local       | Development and tests            | Synthetic seed             | Fake provider    | None                         |
| CI          | Every pull request               | Disposable databases       | Fake provider    | None                         |
| Staging     | E2E, load tests, pilot rehearsal | Synthetic only, never real | Provider sandbox | Sandbox or test devices only |
| Production  | Pilot, then launch               | Real                       | Sandbox until G9 | Real only after approval     |

Staging and production each have their own database, Redis, Supabase project, storage bucket,
provider account and secrets. No secret is shared between them or stored in git, app bundles,
logs or tickets. The settings and their meaning are in `.env.example`; the API validates them
at start and refuses to run with an unsafe combination.

Secrets that must be generated per environment (32+ random characters, stored in the hosting
provider's secret store): `FILE_SIGNING_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `PICKUP_CODE_SECRET`.
Rotating `PICKUP_CODE_SECRET` changes the codes of open orders: rotate only when no order is
between paid and completed, or accept that staff will need the order number fallback.

## 4. Release procedure (every release, staging first)

Before:

1. CI is green on the commit: format, lint, types, unit, integration, migrations on an empty
   database, schema drift, migration safety check, secret scan, dependency audit, build.
2. Release notes list every migration and whether it is additive (from
   `pnpm --filter @beans/api db:check-migrations`).
3. A fresh backup of the target database exists and its restore was checked in the last 7 days
   (`apps/api/scripts/backup-restore-check.sh` against a scratch copy).
4. The release owner signs: version, migrations, feature flags, rollback version, on-call person.

Deploy (staging, then production after staging has run for an agreed soak period, **owner
decision**):

1. Run migrations first (section 5). The previous API version must keep working on the new
   schema, which is why destructive migrations are blocked.
2. Roll out the API gradually behind the load balancer, using `GET /health` (readiness: database
   and Redis) and `GET /health/live` (process). Hold if `/health` answers 503.
3. Watch the signals in section 6 for at least 30 minutes before widening.
4. Web apps deploy after the API. Mobile releases go through store review and staged rollout;
   older app versions must keep working against the new API.

After: record the version, time, migrations and signoff in the release log.

## 5. Migration procedure

- Migrations are forward only and written to be compatible with the previous API version
  (expand, then contract in a later release).
- `pnpm --filter @beans/api db:check-migrations` refuses any migration that drops or renames
  tables, columns, types, constraints, triggers or functions, changes a column type, truncates,
  deletes, updates without a `WHERE`, or disables a trigger, unless the migration carries
  `-- release: destructive-approved <who, date and why>`. It runs in CI. A finance-table change
  also needs the finance owner's approval in the pull request.
- Steps: backup → `prisma migrate status` against the target (lists pending migrations) → apply
  to a restored copy of the target and run the backup check → `pnpm db:migrate` on the target →
  `prisma migrate status` shows none pending → readiness check.
- Never edit an applied migration. Fix forward with a new migration.
- Rollback of a migration is a new forward migration, reviewed like any other. Money tables
  (payments, refunds, journal, payouts) are never reversed by migration: the journal is
  append-only and protected by database triggers, and corrections are new journal entries.

## 6. Monitoring and alerts

Thresholds below are starting points for the pilot, not policy; tune with real traffic.

| Signal                           | Source today                                                    | Alert when                           | First response                         |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| API readiness                    | `GET /health` (503 names the failed dependency)                 | 503 for 2 minutes                    | Runbook R1/R2                          |
| Error rate                       | Logs with `X-Request-Id`; error tracker **(vendor not chosen)** | 5xx above 1% for 5 minutes           | Check latest release; roll back        |
| Checkout failures                | Checkout responses; payments with status failed                 | Failure share doubles vs. last week  | Runbook R3                             |
| Webhook backlog                  | Admin dashboard alert `webhooks_waiting` (unprocessed > 5 min)  | Any                                  | Runbook R3                             |
| Outbox and queue backlog         | Admin dashboard alert `outbox_failed`; Redis                    | Any failed; pending older than 5 min | Runbook R4                             |
| Orders waiting for the branch    | Admin dashboard alert `orders_waiting_acceptance`               | Any past the accept window           | Call the branch; timeout sweep refunds |
| Refunds or payouts failed        | Admin dashboard alerts `refunds_failed`, `payouts_failed`       | Any                                  | Finance on-call                        |
| Reconciliation exceptions        | Admin dashboard alert `reconciliation_open`                     | Any                                  | Finance on-call; payouts stay blocked  |
| Order latency (paid to accepted) | Order events                                                    | Median above the agreed SLA (D10)    | Contact branch; review staffing        |
| Rate limiting                    | 429 `RATE_LIMITED` in logs                                      | Spike from one IP or user            | Review for abuse                       |
| Redis down                       | `/health` reports degraded; rate limits fail open               | Any                                  | Runbook R2                             |
| Backups                          | Hosting provider; weekly restore check                          | Missed backup or failed check        | Runbook R6                             |

Still to build once hosting is chosen: an error tracker (`SENTRY_DSN` or equivalent, with PII
scrubbing), log shipping with retention per D11, uptime checks from outside the region, and a
metrics endpoint or exporter for the counts above so alerts page someone instead of waiting for
the admin dashboard to be opened.

## 7. Operational runbook

Every incident: name an incident lead, note times in UTC and Asia/Dubai, communicate to affected
merchants through support, and write a short review afterwards. Never edit financial rows by
hand; use refunds, journal corrections and reconciliation in the admin console.

- **R1 Database unavailable.** `/health` 503 with `database: down`. Orders cannot be placed
  (correct: no order without a durable record). Check the provider status and connection limits.
  Restore from backup only under R6.
- **R2 Redis unavailable.** `/health` 503 with `redis: down`. Rate limits fail open (orders keep
  working), live tablet updates stop (tablets refetch on reconnect), queued jobs wait. Restart or
  fail over Redis; the outbox republishes pending messages.
- **R3 Payment provider outage or webhooks delayed.** Checkout answers `pending_payment`; the
  customer retry reuses the same attempt and key, so nothing is charged twice (tested, Q22).
  Late captures after an order expired are refunded automatically (sandbox rule, D03). When the
  provider is back, check `webhooks_waiting` drains and open reconciliation exceptions.
- **R4 Outbox or queue backlog.** Look at failed messages and their last error. Fix the cause and
  let the relay retry; handlers are idempotent, so replay is safe.
- **R5 Branch not accepting orders.** Orders time out after the accept window and are refunded
  automatically. Contact the branch; its manager can pause the branch so no new orders arrive, and an admin
  can suspend the merchant if the branch cannot be reached.
- **R6 Restore from backup.** Only with the incident lead and finance owner. Restore into a new
  database, run the backup check, switch the API over, then replay provider events since the
  backup time and run reconciliation before payouts resume. Record actual RPO/RTO.
- **R7 Suspected data leak or compromised account.** Revoke the staff membership or suspend the
  merchant (immediate, tested Q16), rotate the affected secret, preserve audit events, and
  involve legal counsel for notification duties (D11).
- **R8 Bad release.** Roll the API back to the previous version (migrations are compatible), or
  pause the affected branches. Do not reverse money migrations. (Runtime feature flags do not
  exist yet; today features are switched by environment settings and a redeploy.)

## 8. Rollback

| What       | How                                                         | Limits                                        |
| ---------- | ----------------------------------------------------------- | --------------------------------------------- |
| API        | Redeploy the previous version                               | Safe because migrations are additive          |
| Web apps   | Redeploy the previous build                                 | —                                             |
| Mobile app | Halt the staged rollout                                     | Installed versions stay; API stays compatible |
| Schema     | New forward migration only                                  | Never reverse money tables                    |
| Data       | Restore under R6, then replay provider events and reconcile | Loses writes since the backup                 |

## 9. Privacy and app store checklist

| Item                                                                   | State                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Data inventory: what is collected, why, where stored, retention        | Data minimised in code; retention periods **owner decision (D11)**                            |
| Privacy policy and terms (English and Arabic, native-reviewed)         | Not written; needs legal counsel (G8)                                                         |
| Consent for location (optional; manual city works, Q01)                | Built                                                                                         |
| Access, correction and deletion requests                               | Built as support tickets with redacted export (Q24); deletion steps depend on retention rules |
| In-app account deletion (store requirement)                            | Blocked on sign-in (D12); request path exists via privacy requests                            |
| Apple privacy labels and Google Play data safety form                  | To fill from the data inventory once D11/D12 are decided                                      |
| Store listings: name, icon, screenshots, description in both languages | Blocked on brand (D13); screenshots must show synthetic data only                             |
| Support contact and URL                                                | **Owner decision**                                                                            |
| Payment method disclosures and refund policy                           | Blocked on D03, D05                                                                           |
| Age rating, export compliance, content rights                          | To answer at submission                                                                       |
| Hosting location and current store rules                               | Verify at release time (docs/11)                                                              |

## 10. Pilot plan

**Stage A: sandbox pilot** (after G1–G8, G11). One or two cafés in the pilot city (D01, Abu Dhabi
in the sandbox fixtures; confirm), real staff on real tablets, synthetic customers from the team,
provider sandbox only, no real money. Duration and café selection are **owner decisions**.

Exit criteria (all needed for G10):

- Every acceptance scenario Q01–Q18, Q22–Q24 repeated in staging with the café's own staff.
- No duplicate charge, refund or journal posting; reconciliation clean every day.
- Accept-window and preparation times measured against the agreed SLA (D10).
- No open high-severity security, privacy or accessibility finding.
- Café staff and support confirm the runbook steps they own.

**Stage B: controlled live pilot** (after G9, G10 and explicit written approval). Same cafés,
invited customers and a low order cap (a cap and a platform-wide ordering pause are not
built yet and are needed before this stage). Daily reconciliation and
payout review by two people before any payout. Expansion to more cafés is a separate decision.

Stop the pilot immediately on: any duplicate charge, any cross-tenant data exposure, a journal
imbalance, or a payout mismatch.
