# Test results and remaining technical limitations (cycle 3)

## 1. Automated test results

Run on 2026-11-28 in the development container (PostgreSQL 16 local, fictional data), on the
branch that became the cycle 3 documentation PR, after PRs #21-#27 were merged. Every pull
request also ran the same suites in GitHub Actions (CI jobs: format, lint, types, unit tests,
build; integration tests and migrations; browser tests; secret and dependency scan), and each
PR was merged only with all four green.

| Suite                               | Command                                               | Result                                         |
| ----------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| API unit                            | `pnpm --filter @beans/api test`                       | 18 files, **80 passed**                        |
| API integration (real PostgreSQL)   | `cd apps/api && npx vitest run --project integration` | 30 files, **229 passed**                       |
| Customer app (Jest, React Native)   | `pnpm --filter @beans/mobile test`                    | 7 suites, **42 passed**                        |
| Shared web library (live updates)   | `pnpm --filter @beans/web test`                       | 1 file, **1 passed**                           |
| Contracts                           | `pnpm --filter @beans/contracts test`                 | 2 files, **6 passed**                          |
| Design system                       | `pnpm --filter @beans/ui test`                        | 1 file, **5 passed**                           |
| Browser tests (all four interfaces) | `pnpm test:e2e` (Playwright; CI job)                  | 5 files, **23 tests**, green in CI on every PR |
| **Total outside the browser**       |                                                       | **363 passed, 0 failed**                       |

No test was removed or skipped in cycle 3.

## 2. The founder's test list (section 14 of the 2026-11-28 message)

| Requested test                | Where                                                                                                                                                                                                                                                                                 | Result |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Vercel compatibility          | `test/vercel-entry.int.test.ts` (function entry builds once, answers requests, bad config → 503); `src/config/free-tier.test.ts` (vercel.json duration, crons, region)                                                                                                                | Pass   |
| Database connection pooling   | `test/resilience.int.test.ts`: 30 parallel requests through a pool of 1 connection                                                                                                                                                                                                    | Pass   |
| Serverless execution          | `test/serverless.int.test.ts`: cron tick secret, idempotent overlapping ticks; after-write dispatch unit test                                                                                                                                                                         | Pass   |
| Concurrent checkout attempts  | `test/checkout.int.test.ts` (Q04), `test/inventory.int.test.ts`: last unit and last slot place sold exactly once under concurrent checkouts                                                                                                                                           | Pass   |
| Duplicate payment webhooks    | `test/finance.int.test.ts`, `test/tap.int.test.ts`: second delivery recorded as a duplicate and changes nothing; forged, altered and stale webhooks refused                                                                                                                           | Pass   |
| Expired reservations          | `test/checkout.int.test.ts`: expired holds released only after asking the provider; late capture refunded; no retry after expiry                                                                                                                                                      | Pass   |
| Scheduled job reliability     | `test/serverless.int.test.ts`, `test/outbox.int.test.ts` (frozen lease retried, no double handling); `src/outbox/outbox-topics.test.ts` (every event topic has a handler)                                                                                                             | Pass   |
| Email authentication          | `apps/mobile/src/screens/account.test.tsx` (email code sign-in, no phone field); `test/auth.int.test.ts` (token signature, issuer, audience, expiry)                                                                                                                                  | Pass   |
| Admin MFA                     | `test/admin-audit.int.test.ts`, `test/auth.int.test.ts`; browser test "requires two-step verification on every session"                                                                                                                                                               | Pass   |
| Real-time order updates       | `packages/web/src/live.test.ts` (fake Supabase Realtime server: join, signal, rejoin refetch); `apps/mobile/src/screens/live.test.tsx`; broadcast content in `test/serverless.int.test.ts`                                                                                            | Pass   |
| QR scanning                   | `apps/mobile/src/screens/scanner.test.tsx` (valid code, link code, foreign code, permission refused); table token tests in `test/engagement.int.test.ts`                                                                                                                              | Pass   |
| Loyalty reward reversals      | `test/loyalty-rules.int.test.ts`: full and partial refunds reverse stamps once per refund                                                                                                                                                                                             | Pass   |
| Merchant isolation            | `test/tenancy.int.test.ts`, `test/tablet.int.test.ts`; browser tests                                                                                                                                                                                                                  | Pass   |
| Free-tier usage limitations   | `src/config/free-tier.test.ts`: function duration ≤ 300 s, ≤ 100 crons, document size ≤ 50 MB (Supabase Free per-file limit)                                                                                                                                                          | Pass   |
| External service outages      | `test/resilience.int.test.ts` (storage down → 5xx with no key in the reply, health stays up); `test/serverless.int.test.ts` (Realtime 503 → event kept and retried); `test/account-deletion.int.test.ts` (sign-in deletion runs through the outbox, so a Supabase failure is retried) | Pass   |
| Backup and restore procedures | `apps/api/scripts/backup-restore-check.sh` against the test database (below)                                                                                                                                                                                                          | Pass   |

### Backup and restore drill

```
SOURCE_URL=…/beans_test RESTORE_URL=…/beans_restore_check bash apps/api/scripts/backup-restore-check.sh
dump: 1 s, restore: 2 s, size: 8.4M
audit_events 4953, journal_debit_minus_credit 0, journal_lines 4730, orders 1625,
payments 1662, refunds 1077
OK: restored copy matches and the journal balances
```

This proves the procedure on a local copy. It has not been run against a Supabase project,
because none exists yet.

### What these tests do not prove

- Nothing has run on real Vercel or Supabase infrastructure; Supabase Realtime, Storage and Auth
  were exercised against faithful local fakes of their HTTP and WebSocket interfaces.
- The QR scanner was tested with a mocked camera; it needs a check on real phones.
- Tap was tested against a fake Tap server built from Tap's documentation; it needs the test
  mode checks in docs/29.
- Internal checks are not a penetration test, an accessibility audit or a translation review.

## 3. Remaining technical limitations

| #   | Limitation                                                                                                                                                                               | Effect                                                                                                                        | Way forward (each needs the founder's decision)                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **No malware scanning.** ClamAV needs about 1 GB of memory for its signatures and a long-running daemon, which a Vercel function cannot hold; free hosted scanners forbid commercial use | Production runs with document uploads off, so cafés cannot submit an online application (it requires a checked trade licence) | Approve a paid scanner; or verify licences outside the platform and add an admin-created café flow (not built: a product decision) |
| L2  | **No automatic backups** on Supabase Free                                                                                                                                                | Data loss risk if the project fails                                                                                           | Manual drill now; Supabase Pro before real data (docs/24)                                                                          |
| L3  | **Vercel plan unknown.** Hobby runs cron once a day and forbids commercial use                                                                                                           | Acceptance timeouts, expired holds and refund retries would wait up to a day                                                  | Confirm Pro                                                                                                                        |
| L4  | Cron runs at most every minute                                                                                                                                                           | The 120-second acceptance timeout fires between 120 and about 180 seconds; a late accept is still refused at 120 s            | Acceptable for the pilot; documented                                                                                               |
| L5  | Supabase Free **pauses after 7 idle days**                                                                                                                                               | Staging goes offline until resumed                                                                                            | The per-minute cron should keep it active; check in week one                                                                       |
| L6  | **Monitoring** is the built-in Vercel and Supabase logs only, with short retention; no alerting                                                                                          | Problems are found by looking, not by being told                                                                              | Free alerting options can be added later; paid monitoring needs approval                                                           |
| L7  | **Resend 100 emails a day** and a verified domain is required to email anyone but the account owner                                                                                      | No customer sign-in emails until a domain exists                                                                              | Choose and buy a domain (yearly cost)                                                                                              |
| L8  | **No UAE region** on any approved provider; data sits in Mumbai and some passes through the US                                                                                           | Possible legal blocker (docs/28)                                                                                              | Counsel review                                                                                                                     |
| L9  | Admin order monitoring polls every 60 seconds instead of live signals                                                                                                                    | Up to a minute behind                                                                                                         | Fine for the pilot                                                                                                                 |
| L10 | Expired upload tickets are not cleaned up automatically                                                                                                                                  | Small leftover rows (uploads are off in production anyway)                                                                    | Add with the retention rules                                                                                                       |
| L11 | Public storage for product photos and marketing images is not built (menus have no photos yet)                                                                                           | Text-only menus                                                                                                               | Build with the UX/UI design                                                                                                        |
| L12 | Push notifications not sending (FCM project not created; real notifications need approval)                                                                                               | Customers rely on the open app and live updates                                                                               | After approval                                                                                                                     |
| L13 | Apple and Google sign-in not built                                                                                                                                                       | Email only (as decided for the first release)                                                                                 | Needs store memberships                                                                                                            |
| L14 | Android package name, iOS bundle identifier and `eas.json` not set                                                                                                                       | No store builds yet                                                                                                           | After the final name                                                                                                               |
| L15 | Split payments to cafés through Tap are not built (availability unconfirmed)                                                                                                             | Payouts are statements, not transfers                                                                                         | Ask Tap (docs/29)                                                                                                                  |
| L16 | Arabic text is a draft                                                                                                                                                                   | Needs native review before launch                                                                                             | Founder to arrange                                                                                                                 |
