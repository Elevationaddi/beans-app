# Hardening report (phase 11, 2026-11-27)

Everything here was run locally against PostgreSQL 16 and Redis 7 with the sandbox payment
provider. Nothing was deployed. "Blocker" means the item cannot pass until the named decision
or outside work happens; it is not a test failure.

## Acceptance matrix (docs/11 Q01–Q24)

| ID  | Scenario                                       | Status           | Evidence                                                                                                                                        |
| --- | ---------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01 | Guest declines location                        | Pass (API)       | `discovery.int.test.ts` "Q01"; mobile `screens.test.tsx` welcome flow                                                                           |
| Q02 | Required modifier omitted / tampered price     | Pass             | `discovery.int.test.ts` "Q02", `checkout.int.test.ts` "Q02"                                                                                     |
| Q03 | Switch branch with cart                        | Pass             | `checkout.int.test.ts` "Q03"                                                                                                                    |
| Q04 | Last stock / slot concurrent checkout          | Pass             | `checkout.int.test.ts` "Q04"; `hardening.int.test.ts`: 12 concurrent buyers, 5 units, exactly 5 orders                                          |
| Q05 | Price or stock changes after quote             | Pass             | `checkout.int.test.ts` "Q05"                                                                                                                    |
| Q06 | Payment failure, pending, retry                | Pass             | `checkout.int.test.ts` "Q06" (success, failure and retry, pending)                                                                              |
| Q07 | Duplicate / out-of-order / forged webhooks     | Pass             | `finance.int.test.ts` "Q07"                                                                                                                     |
| Q08 | Late capture after timeout                     | Pass             | `finance.int.test.ts` "Q08", `checkout.int.test.ts` late capture                                                                                |
| Q09 | Branch rejects / times out                     | Pass             | `fulfillment.int.test.ts` "Q09"                                                                                                                 |
| Q10 | Two tablets transition same order              | Pass             | `fulfillment.int.test.ts` "Q10"                                                                                                                 |
| Q11 | Curbside double check-in and handoff           | Pass             | `fulfillment.int.test.ts` "Q11"                                                                                                                 |
| Q12 | Customer cancellation after acceptance         | Pass             | `fulfillment.int.test.ts` "Q12"                                                                                                                 |
| Q13 | Concurrent partial refunds                     | Pass             | `finance.int.test.ts` "Q13"                                                                                                                     |
| Q14 | Payout reconciliation mismatch                 | Pass             | `finance.int.test.ts` "Q14"                                                                                                                     |
| Q15 | Tenant B reaches A (API, socket, export, file) | Pass             | `tenancy.int.test.ts`, `onboarding.int.test.ts` "in every channel", `fulfillment.int.test.ts` live-stream scope, `operations.int.test.ts` "Q15" |
| Q16 | Revoked staff and suspended merchant           | Pass             | `operations.int.test.ts` "Q16", `staff.int.test.ts`                                                                                             |
| Q17 | Offline tablet reconnect                       | Pass (API)       | `fulfillment.int.test.ts` "Q17"; the tablet screen itself is blocked on sign-in (D12)                                                           |
| Q18 | RTL, large text, screen reader                 | Partial, blocker | Mobile tests: RTL direction for Arabic, accessible names on every control. Large text and screen-reader checks need devices (D15 audit)         |
| Q19 | Reward earn / refund replay                    | Not applicable   | Phase two, not built (D07)                                                                                                                      |
| Q20 | Gift concurrent claims                         | Not applicable   | Phase two, not built (D08); gift sales forbidden until approved                                                                                 |
| Q21 | QR invalid / rotated                           | Not applicable   | Phase two, not built (D14)                                                                                                                      |
| Q22 | Backup restore and provider outage             | Pass (local)     | `scripts/backup-restore-check.sh` (below); `hardening.int.test.ts` "Q22" provider outage. Production RPO/RTO need the hosting decision          |
| Q23 | Journal invariants                             | Pass             | `finance.int.test.ts` "Q23"; database trigger `journal_balanced`                                                                                |
| Q24 | Privacy request and redacted export            | Pass             | `operations.int.test.ts` "Q24"                                                                                                                  |

## Concurrency and load

- Burst test: 12 customers check out the last 5 units at the same time. Exactly 5 orders are
  placed; the other 7 get `OUT_OF_STOCK`; reserved stock never exceeds stock on hand.
- Two tablets, two curbside check-ins, two completions, two cancellation taps at once: one
  winner each, enforced by row locks, versions and partial unique indexes.
- A load test against real infrastructure (latency targets, connection pool sizing) needs a
  staging environment, which does not exist yet (hosting decision). Recorded as a blocker.

## Backup and restore drill (Q22)

`SOURCE_URL=… RESTORE_URL=…/beans_restore_check apps/api/scripts/backup-restore-check.sh`

Actual run on the local test database (323 orders, 339 payments, 115 refunds, 700 journal
lines, 987 audit events): dump 1 s, restore under 1 s, 1.9 MB; all counts match and the
restored journal balances (debits minus credits = 0). Production backup schedule, retention
and RPO/RTO depend on the hosting provider (not chosen).

## Controls added in this phase

- **Rate limits** (docs/10) per signed-in user, else per IP, in Redis fixed windows:
  checkout 20/min, quote 60/min, staff actions 120/min, curbside check-in 20/min, cancellation
  requests 10/h, uploads 30/h, tickets 20/h, privacy requests 5/h, reports and exports 30/min,
  provider webhooks 600/min per IP. 429 with `Retry-After`. Security defaults, not policy.
  `RATE_LIMIT_ENABLED` cannot be false in production. If Redis is down the check is skipped
  (orders keep working) and the health check reports degraded.
- **Pickup codes**: salted hash, five wrong codes lock handoff for five minutes (phase 8).
- **Security headers** on every response: `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a CSP that allows nothing, no `X-Powered-By`, HSTS in
  production.

## Threat model (docs/10) and where each is handled

| Threat                              | Control                                                                                  | Test                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Cross-tenant ID manipulation        | Scoped lookups from active memberships; 404 outside scope                                | `tenancy`, `operations` Q15, `fulfillment` access |
| Duplicate capture or refund         | Idempotency keys, provider keys, row locks, refund trigger                               | `checkout` Q06, `finance` Q07/Q13                 |
| Forged or replayed webhook          | HMAC over raw body, 300 s window, unique event ID                                        | `finance` Q07                                     |
| Stale state                         | `expectedVersion` and 409; order state machine trigger                                   | `fulfillment` Q10/Q17                             |
| Leaked gift or QR token             | Not built (phase two)                                                                    | —                                                 |
| Malicious file                      | Quarantine and scan before use; signed, short-lived links                                | `onboarding` uploads                              |
| Compromised barista                 | Branch-only queue, no money or menu access; revocation is immediate                      | `operations` Q16                                  |
| Stolen admin session                | Admin routes need a DB role and MFA (`aal2`); every privileged action audited            | `admin-audit`, `finance` access                   |
| Brute force (pickup code, checkout) | Rate limits; pickup code lockout                                                         | `hardening`, `fulfillment` lockout                |
| PII in logs or events               | Audit redaction; live events carry IDs and versions only; staff view has no contact data | `redact.test.ts`, `fulfillment` live updates      |
| Queue replay                        | Outbox dedupe keys and BullMQ job IDs; idempotent handlers                               | `outbox.int.test.ts`                              |

Still required before launch (docs/10): step-up MFA for role and bank changes, session
revocation UI, SAST, an external penetration test, and UAE legal review of privacy, consent
and retention. This document does not claim regulatory compliance.

## Dependency review

`pnpm audit --prod --audit-level high` (CI gate): no high or critical advisories.
`pnpm audit` (all dependencies), 2026-11-27: 4 moderate, all in tooling:

- `minimatch` 7–11.0.0 (denial of service with crafted patterns) via `expo > @expo/fingerprint`
  and `jest > glob`. Build-time only; patterns come from the repository, not users.
- `glob` 9–14.0.1 via `jest` reporters. Test-time only.

No action now; revisit when Expo and Jest ship updates. Secret scanning (gitleaks) runs in CI.

## Open release blockers found or confirmed in this phase

1. Sign-in (D12) and a Supabase test project: no web or mobile screen can sign in, so the
   tablet, portal, admin and customer order screens are not built and cannot be E2E tested.
2. Staging environment and hosting choice (D11): needed for load tests, backups, RPO/RTO.
3. Device accessibility audit (D15): large text and screen readers (Q18).
4. Storage provider and malware scanner (since phase 3).
5. All money decisions (D02–D08) before any live provider.
