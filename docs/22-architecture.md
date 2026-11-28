# Architecture on Vercel and free tiers (cycle 3)

Status: built and tested locally; **staging prepared, not deployed** (founder decision
2026-11-28: no deployment or billable resources before the infrastructure plan is approved).

## The four interfaces and where they run

| Part                                 | Code            | Hosting (prepared)                              | Notes                                          |
| ------------------------------------ | --------------- | ----------------------------------------------- | ---------------------------------------------- |
| Customer app (iOS, Android)          | `apps/mobile`   | Store builds made locally (Expo Free)           | Store memberships not bought (docs/24)         |
| Customer web app (QR links, testing) | `apps/mobile`   | Vercel static project (`vercel.json`, Expo web) | Opens from printed table QR codes              |
| Business portal and barista tablet   | `apps/merchant` | Vercel Next.js project                          | Tablet is a page of the portal (`/tablet`)     |
| Admin console                        | `apps/admin`    | Vercel Next.js project                          | Admins must pass authenticator-app MFA         |
| API (one modular NestJS backend)     | `apps/api`      | One Vercel Function (`api/index.mjs`)           | Express app built once per instance and cached |
| Database                             | Prisma schema   | Supabase Free PostgreSQL (Mumbai)               | Through the transaction pooler, port 6543      |
| Sign-in                              | Supabase Auth   | Supabase Free                                   | Emails sent through Resend Free (custom SMTP)  |
| Files (merchant documents)           | `files/`        | Supabase Storage, private bucket                | Uploads blocked in production (no scanner)     |
| Live order signals                   | `realtime/`     | Supabase Realtime Broadcast                     | Database stays the source of truth             |
| Push notifications (not yet sending) | —               | Firebase Cloud Messaging (free)                 | No real notifications without approval         |
| Code, CI                             | GitHub          | GitHub Free (Actions minutes)                   |                                                |

All Vercel projects and the Supabase project are pinned to Mumbai (`bom1`, `ap-south-1`), the
nearest region to the UAE that both offer. Neither has a UAE region (see docs/28).

## Request path

```
phone / browser ──HTTPS──▶ Vercel edge ──▶ API function (bom1) ──pooler:6543──▶ Supabase Postgres
        │                                        │
        │                                        ├─ verifies Supabase access tokens (JWKS, issuer,
        │                                        │  audience, expiry); roles and tenant scope from DB
        │                                        └─ writes state + outbox row in one transaction
        └──WebSocket──▶ Supabase Realtime (Broadcast) ◀── outbox dispatch (order.updated)
```

- **Connection pooling.** Each function instance opens at most `DATABASE_POOL_MAX` connections
  (set 1-3 on Vercel) to Supabase's transaction pooler with `?pgbouncer=true`, which turns
  prepared statements off. Migrations use `DIRECT_URL` (session pooler or direct connection).
  Test: `test/resilience.int.test.ts` serves 30 parallel requests through one connection.
- **Function limits.** `maxDuration` is 60 s; the cron tick stops draining after 20 s. Request
  bodies are capped by Vercel at 4.5 MB, so files never pass through the API (direct signed
  uploads to Supabase Storage).

## Background work without Redis or always-on workers

Everything that used to run in a loop now runs from the database:

| Job                                                           | How it runs on Vercel                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Outbox dispatch (live signals, file checks, sign-in deletion) | Right after each successful write (`waitUntil`, "kick"), and every minute by the cron tick  |
| Acceptance timeouts (120 s)                                   | Cron tick money sweep, every minute: orders not accepted in time are cancelled and refunded |
| Expired checkouts and reservations                            | Cron tick: holds past their time are released, stock and slot places returned               |
| Payment status polling and webhook retries                    | Cron tick: provider status re-read; webhook rows retried                                    |
| Refund processing                                             | Cron tick, after maker-checker approval                                                     |
| Payout statements (sandbox, weekly)                           | Created on demand by finance users; no money moves                                          |
| Reconciliation                                                | Finance users run it; exceptions recorded for review                                        |
| Rate-limit counters                                           | PostgreSQL table, expired rows purged by the cron tick                                      |

- `GET /v1/internal/cron/tick` answers 404 unless Vercel Cron sends `Bearer $CRON_SECRET`.
- Every job is idempotent: rows are claimed with `FOR UPDATE SKIP LOCKED` and a lease, and
  every state change is conditional, so an overlapping, repeated or late tick does nothing
  twice (tested in `test/serverless.int.test.ts` and `test/outbox.int.test.ts`).
- **Timing.** With per-minute cron (Vercel Pro), an acceptance timeout fires between 120 and
  about 180 seconds. On Vercel Hobby, cron runs once a day, which is not acceptable for timeouts
  and expiries, and Hobby is for non-commercial use only. **The Vercel plan must be confirmed
  (question in the final report).**

## Live updates

- Each committed order change writes an `order.updated` outbox row. Dispatch sends one Broadcast
  message to the order's channel and one to its branch's channel. Channel names are an HMAC of
  the ID (`REALTIME_CHANNEL_SECRET`), so they cannot be guessed; the payload is only the order
  ID, version and time.
- The apps ask the API for their channel (`GET /v1/orders/{id}/live`,
  `GET /v1/merchant/branches/{id}/live`); the API checks ownership or branch access first.
- On each signal, and after every reconnect, the screen refetches from the API. Polling stays on
  as a safety net (tablet 30 s live / 10 s otherwise; portal 60 s / 15 s; customer 30 s / 5 s).
  The admin console polls every 60 s.
- Free-plan fit: 200 concurrent Realtime connections and 2 million messages a month.

## Sign-in

- Customers: email one-time code (Supabase Auth), which also recovers access; profile editing;
  self-service account deletion (`POST /v1/me/deletion`).
- Businesses and staff: email and password, password reset by email; staff have individual
  accounts per business and branch through invitations.
- Admins: email and password plus mandatory authenticator-app (TOTP) MFA; every admin route
  requires `aal2`.
- Code expiry, resend limits and session lifetimes are Supabase project settings (docs/25).
- Development sign-in with fictional accounts exists for local work only and is refused when
  `NODE_ENV=production`.

## Files

- Private bucket `merchant-documents`; signed upload URL per file; the API reads with the server
  key only to run the file check; admins get 5-minute signed links for files that passed.
- The basic checker (type signature, EICAR, PDF scripts) is **not** malware scanning. ClamAV
  does not fit a Vercel function. Production refuses `FILE_SCANNER=basic`; staging and
  production run with `FILE_SCANNER=disabled`, which refuses document uploads before any bytes
  are accepted, so real merchant documents cannot be collected yet (docs/27 L1).

## Vercel configuration (prepared files)

| File                                                  | What it sets                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/vercel.json`                                | Root install and build, `bom1`, function `api/index.mjs` (60 s, `dist/**`), all paths to the API, cron every minute, `X-Robots-Tag: noindex` |
| `apps/api/api/index.mjs`                              | Re-exports the compiled handler `dist/serverless.js`                                                                                         |
| `apps/api/src/serverless.ts`                          | Builds the NestJS app once per instance; a bad environment answers 503 without printing values                                               |
| `apps/merchant/vercel.json`, `apps/admin/vercel.json` | Next.js framework, root install and build, `bom1`; `next.config.ts` sends noindex unless `ALLOW_INDEXING=true`                               |
| `apps/mobile/vercel.json`                             | Expo web export (`dist-web`), single-page rewrite, noindex                                                                                   |

Each Vercel project uses its app folder as the root directory. Environment variables are listed
in docs/26; step-by-step setup is in docs/18.

## Data locations (summary; details and open questions in docs/28)

| Data                                 | Stored                                             | Processed                     |
| ------------------------------------ | -------------------------------------------------- | ----------------------------- |
| Database (accounts, orders, journal) | Supabase, Mumbai                                   | Vercel functions, Mumbai      |
| Sign-in accounts and sessions        | Supabase Auth, Mumbai                              | Supabase                      |
| Merchant documents                   | Supabase Storage, Mumbai                           | Vercel functions (file check) |
| Sign-in emails                       | Resend (account data in the US)                    | Resend                        |
| Card payments (later)                | Tap Payments (card data never touches our systems) | Tap                           |
| Build logs, function logs            | Vercel, GitHub                                     | US and Mumbai                 |
