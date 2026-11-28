# Staging environment instructions (2026-11-28)

**Nothing described here has been set up or deployed.** Creating a staging environment means
buying hosting, a domain and possibly an SMS sender, which needs the founder's written approval
("Do not deploy publicly, incur paid service charges…"). This document is the step-by-step plan
for whoever does it once approved. The release procedure, migrations, monitoring and rollback
are in docs/15; the cost estimate is in docs/20.

## 0. Before you start (approvals)

| Needed                                         | Decision | Status                         |
| ---------------------------------------------- | -------- | ------------------------------ |
| Hosting provider and region (UAE preferred)    | D11      | Options and costs in docs/20   |
| Budget approval for staging                    | Founder  | Not given                      |
| Supabase project for staging (region, plan)    | D12      | Not created                    |
| Tap sandbox account and test keys              | D03      | Not provided                   |
| Object storage and malware scanner             | D11      | Not chosen; adapters not built |
| Staging domain names                           | D13      | Not chosen (name is temporary) |
| SMS sender for phone sign-in (Twilio proposed) | D12      | Not created; use test numbers  |

Staging must use **synthetic data only**, Tap **test** keys only, and no real notifications.

## 1. What runs in staging

| Component                          | Build command                                                                   | Runs as                              |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| API (NestJS)                       | `pnpm --filter @beans/api build` → `node apps/api/dist/main.js`                 | Container, 2 instances behind TLS    |
| Worker (BullMQ)                    | Same image with `OUTBOX_WORKER_ENABLED=true`; API instances can set it to false | Container, 1 instance                |
| Business portal and barista tablet | `pnpm --filter @beans/merchant build` → `next start`                            | Container                            |
| Admin console                      | `pnpm --filter @beans/admin build` → `next start`                               | Container, IP-restricted if possible |
| Customer app                       | EAS internal build (iOS TestFlight / Android internal track)                    | Test devices only                    |
| PostgreSQL 16                      | Managed service with daily backups and point-in-time recovery                   | Private network only                 |
| Redis 7                            | Managed service, persistence on                                                 | Private network only                 |

## 2. Environment settings

Copy the names from `.env.example`. The API validates them at start and refuses unsafe
combinations. Staging runs with the **production** configuration so those checks apply:

- `NODE_ENV=production`
- `DATABASE_URL`, `REDIS_URL`: managed services, TLS required.
- `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`,
  `SUPABASE_ANON_KEY`: the staging Supabase project.
- `PAYMENT_PROVIDER=tap`, `TAP_SECRET_KEY=sk_test_…` (test key only; the API refuses others),
  `TAP_RETURN_URL` (customer return page), `API_PUBLIC_URL` (used for Tap's webhook URL
  `…/v1/webhooks/payments/tap`).
- `LIVE_PAYMENTS_ENABLED` unset (the API refuses `true`).
- `DEV_AUTH_ENABLED` unset (the API refuses it in production).
- `CORS_ORIGINS`: the portal and admin staging URLs only.
- Generate fresh 32+ character random values for `FILE_SIGNING_SECRET`, `PAYMENT_WEBHOOK_SECRET`,
  `PICKUP_CODE_SECRET` and `TABLE_TOKEN_SECRET` (for example `openssl rand -base64 48`). Store them
  only in the hosting provider's secret store. Never reuse them in production.
- `STORAGE_DRIVER` and `FILE_SCANNER`: the production adapters do not exist yet (security review O4). Until
  they do, the API will refuse to start in production mode, which is the intended guard.

Web builds: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_CUSTOMER_APP_URL`. **Never** set `NEXT_PUBLIC_DEV_AUTH` in a staging build.
Mobile builds: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
**Never** set `EXPO_PUBLIC_DEV_AUTH`.

## 3. Step by step

1. Create the staging Supabase project in the chosen region. Turn on email and phone one-time
   codes, email and password for businesses, and TOTP MFA. Add test phone numbers instead of
   connecting a paid SMS sender until approved.
2. Create the managed PostgreSQL and Redis in the private network.
3. Apply migrations: `pnpm --filter @beans/api exec prisma migrate deploy` with the staging
   `DATABASE_URL`. Never run `migrate dev` or `migrate reset` against staging.
4. Seed synthetic data: `pnpm db:seed` (fictional cafés and accounts only). Create the staging
   admin accounts in Supabase, enrol MFA, then grant roles in the database.
5. In the Tap dashboard (test mode), set the webhook URL to
   `https://<api-staging-host>/v1/webhooks/payments/tap`.
6. Deploy the API and worker images, then the portal and admin. Check `GET /health/live` (process up)
   and `GET /health` (database and Redis reachable).
7. Build the customer app with EAS for internal testers pointing at the staging API.
8. Run the browser tests against staging (the Playwright config reads `E2E_API_URL`; the web
   hosts still need the same treatment, a small change to `e2e/playwright.config.ts`) and a short load test (docs/14 "Concurrency and load").
9. Rehearse a backup restore and a rollback (docs/15 sections 5 and 8) and record the times.

## 4. Checks before calling staging ready

- [ ] API refuses to start when any required secret is removed (try one, then restore it).
- [ ] A Tap test card payment completes and the webhook marks the order paid.
- [ ] A Tap test refund completes.
- [ ] Sign-in works for a customer (test phone number), a business owner, a barista and an admin
      with MFA; the admin console refuses to load without MFA.
- [ ] Tenancy: a second test business cannot see the first one's orders.
- [ ] Browser tests pass against staging; results saved.
- [ ] Backup restore drill done; time recorded.
- [ ] No secret appears in logs, bundles or screenshots (search the built bundles for `sk_`).
