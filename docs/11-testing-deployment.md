# Testing, environments and deployment
## Tooling and commands
Proposed pnpm workspace with scripts lint, typecheck, test, test:integration, test:e2e, build, db:migrate, db:seed. Implement and document actual commands in phase 1; use Vitest/Jest, Supertest, Playwright for web, Maestro or Detox for mobile. Integration tests use disposable PostgreSQL/Redis, fake payment provider and synthetic identities. CI runs formatting/lint, types, unit, integration, web E2E, build, migration dry run and secret/dependency scans. Mobile E2E on simulator/device separately.

## Required acceptance tests
| ID | Scenario | Expected |
|---|---|---|
| Q01 | Guest declines location | manual city and browse work |
| Q02 | Required modifier omitted / tampered price | rejected; canonical total used |
| Q03 | Switch branch with cart | confirmation, no mixed order |
| Q04 | Last stock / slot concurrent checkout | one succeeds, other conflict |
| Q05 | Price or stock changes after quote | reject/requote, no silent charge |
| Q06 | Payment failure, pending, retry | no fulfillment until verified; no duplicate charge |
| Q07 | Duplicate/out-of-order/forged webhooks | dedupe, reconcile or reject; no duplicate ledger |
| Q08 | Late capture after timeout | restore valid hold or refund, notify |
| Q09 | Branch rejects / times out | terminal state, correct refund workflow |
| Q10 | Two tablets transition same order | one success, stale conflict |
| Q11 | Curbside double check-in and handoff | one arrival/completion, wrong code denied |
| Q12 | Customer cancellation after acceptance | support request, no unauthorized refund |
| Q13 | Concurrent partial refunds | total <= captured; distinct checker |
| Q14 | Payout reconciliation mismatch | blocked, exception visible |
| Q15 | Tenant B accesses A via API/socket/export/file | denied in all channels |
| Q16 | Revoked staff and suspended merchant | no new unauthorized action/order |
| Q17 | Offline tablet reconnect | refetch canonical queue, no duplicate mutation |
| Q18 | RTL, large text, screen reader | usable and no truncation of critical content |
| Q19 | Reward earn/refund replay (phase 2) | exact once, correct reversal |
| Q20 | Gift concurrent claims (phase 2) | one claimant, no duplicate redemption |
| Q21 | QR invalid/rotated (phase 2) | rejected; no wrong table |
| Q22 | Backup restore and provider outage | restore targets measured, graceful pending |
| Q23 | Journal invariants | every posting balanced; totals reconcile |
| Q24 | Privacy request and redacted export | scoped and auditable |

## Environments
Local Docker Compose Postgres/Redis; local/test Supabase project or documented auth emulator; staging isolated managed database, queue, auth, storage and provider sandbox; production separate credentials, backups and monitoring. Example env names: DATABASE_URL, REDIS_URL, SUPABASE_URL, SUPABASE_JWKS_URL, SUPABASE_ANON_KEY (public), SUPABASE_SERVICE_ROLE_KEY (server only if needed), PAYMENT_PROVIDER, PAYMENT_API_KEY, PAYMENT_WEBHOOK_SECRET, MAPS_API_KEY_RESTRICTED, PUSH_CREDENTIALS, APP_BASE_URL, API_BASE_URL, SENTRY_DSN. .env.example placeholders only. Validate config at startup; refuse fake provider when NODE_ENV=production. Do not deploy with missing approved decision flags.

## Release procedure
CI green; migrations backup and dry-run; staging E2E; merchant pilot with synthetic/sandbox payment then explicitly authorized controlled live pilot; security and accessibility review; signed payment/legal approval; native app privacy disclosures, store screenshots, support contact, account deletion process and app review. Use staged rollout, health checks, error rate, checkout failure, webhook age, queue backlog, reconciliation alerts and order latency. Roll back app/API versions via compatible migrations, disable features via server flags; never blindly reverse money migrations. Restore database only via incident runbook and reconcile provider events after restore. Verify backups regularly and document actual RPO/RTO. On-call owner, support escalation, incident communication and rollback signoff required. Hosting location and store rules need current verification before release.
