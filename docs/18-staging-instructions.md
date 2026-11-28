# Staging guide: Vercel and Supabase Free (cycle 3)

**Prepared, not deployed.** The founder's instruction of 2026-11-28 is: "Prepare the deployment
configuration and instructions. Do not deploy or activate billable resources until I approve the
final infrastructure plan." Nothing in this guide has been run against a real account. It
replaces the earlier container-and-Redis plan.

Related documents: architecture (docs/22), free-tier limits (docs/23), costs (docs/24), accounts
and dashboard settings (docs/25), environment variables (docs/26), test results and limitations
(docs/27), data locations (docs/28), Tap test mode (docs/29), release and rollback (docs/15).

## 0. Before you start

| Needed                                                         | Status                        |
| -------------------------------------------------------------- | ----------------------------- |
| Founder approval of the infrastructure plan                    | **Not given**                 |
| Vercel plan confirmed as Pro (per-minute cron, commercial use) | **Unknown** (docs/27 L3)      |
| Supabase Free organization and staging project (Mumbai)        | Not created                   |
| Resend account and a verified sending domain                   | Not created; no domain chosen |
| Tap test account and test keys (entered in Vercel only)        | Not provided                  |

The API refuses to start in production mode with the fake payment provider, so **staging needs
Tap test keys** (free). Until they exist, staging cannot start; local development keeps the fake
provider.

## 1. Ground rules for staging

- **Fictional data only.** No real customer, merchant, staff or card details, and no real
  merchant documents, until privacy and data residency are reviewed (docs/28). Seed data is
  fictional by design.
- **Private.** Every staging project has Vercel Authentication turned on, so only signed-in
  members of the Vercel team can open it. Search engines are told not to index it
  (`X-Robots-Tag: noindex`).
- **Separate.** Staging has its own Supabase project, its own database, its own secrets and its
  own Vercel environment variables. Never copy a staging secret to production or the reverse.
- **No live money, no real notifications.** Tap test keys only (live keys are refused by the
  API); push and SMS sending are not built.
- **No paid add-ons.** Decline any upgrade, trial or card prompt.

## 2. What runs where

| Part                               | Vercel project root | Build (from `vercel.json`)                                |
| ---------------------------------- | ------------------- | --------------------------------------------------------- |
| API (NestJS, one function)         | `apps/api`          | contracts + API build; `api/index.mjs`; cron every minute |
| Business portal and barista tablet | `apps/merchant`     | Next.js                                                   |
| Admin console                      | `apps/admin`        | Next.js                                                   |
| Customer web app (QR links)        | `apps/mobile`       | Expo web export                                           |
| Customer phone app                 | —                   | Local builds (docs/25 section 6)                          |
| Database, sign-in, files, live     | Supabase Free       | Mumbai region                                             |

## 3. Step by step

1. **Accounts and dashboard settings.** Follow docs/25 sections 2 to 4: Spend Management with a
   hard pause, Vercel Authentication, Supabase sign-in settings (email code 10 minutes, TOTP on,
   phone off), Resend SMTP.
2. **Environment variables.** Enter every API, portal, admin and customer web variable from
   docs/26 in each Vercel project's "Preview" environment. Mark secrets Sensitive. Key choices:
   `NODE_ENV=production`, `REALTIME_DRIVER=supabase`, `STORAGE_DRIVER=supabase`,
   `FILE_SCANNER=disabled`, `OUTBOX_RELAY_ENABLED=false`, `CHECKOUT_SWEEP_ENABLED=false`,
   `PAYMENT_PROVIDER=tap` with the test key, `DATABASE_POOL_MAX=2`.
3. **Database.** From a developer machine with the staging connection strings in a local,
   git-ignored `.env`:
   `pnpm --filter @beans/api exec prisma migrate deploy`. Never run `migrate dev` or
   `migrate reset` against staging.
4. **Fictional data.** `pnpm db:seed` (fictional cafés, menus and accounts). Then create the
   staging admin accounts in Supabase (Authentication → Users → Invite), let each person sign in
   to the admin console once and enrol their authenticator app (this creates their row in
   `users`), and grant roles in the Supabase SQL editor, for example:
   `INSERT INTO admin_roles (id, user_id, role) SELECT gen_random_uuid(), id, 'operations' FROM users WHERE auth_subject = '<Supabase user ID>';`
   Roles: super_admin, operations, finance_maker, finance_checker, support, marketing, analyst,
   security. Give each person only what they need, and never both finance roles to one person.
5. **Storage bucket.** `pnpm --filter @beans/api storage:setup` creates the private bucket.
6. **Tap.** Nothing to type into Tap's dashboard: the API sends its webhook address
   (`https://<staging-api>/v1/webhooks/payments/tap`) with every charge and refund. Make sure
   `API_PUBLIC_URL` is the https staging address (docs/29).
7. **First deployment** (only after the founder's approval). Push the branch; Vercel builds a
   Preview deployment for each project. Do not promote to Production and do not attach a domain.
8. **Health.** `GET https://<staging-api>/health/live` answers 200; `GET /health` reports the
   database as up. A wrong or missing variable answers 503 without showing any value; the
   function log names the variable.
9. **Cron.** In the API project's Cron Jobs tab, check that `/v1/internal/cron/tick` runs every
   minute and answers 200. Calling it without the secret must answer 404.
10. **Customer phone app.** Build locally against the staging API (docs/25 section 6) for the
    team's own devices.

## 4. Checks before calling staging ready

- [ ] API refuses to start when a required secret is removed (try one, then restore it).
- [ ] Cron tick runs every minute; an order not accepted within 120 seconds is cancelled and
      refunded within about three minutes.
- [ ] Sign-in works for a customer (email code), a business owner (password), a barista and an
      admin with MFA; the admin console refuses to load without MFA.
- [ ] Sign-in emails arrive through Resend from the verified domain.
- [ ] Live updates: an order accepted on the tablet appears on the customer screen within a few
      seconds; turning off the network falls back to polling and recovers.
- [ ] A Tap test card payment completes and the webhook marks the order paid; a full and a
      partial refund complete (docs/29).
- [ ] Document upload answers "not available yet" (no scanner approved).
- [ ] Tenancy: a second fictional business cannot see the first one's orders.
- [ ] Browser tests pass against staging (`E2E_API_URL` and the web addresses set in
      `e2e/playwright.config.ts`); results saved.
- [ ] Backup drill run to an encrypted local disk; time recorded (docs/27).
- [ ] No secret appears in logs, bundles or screenshots (search the built bundles for `sk_` and
      `service_role`).
- [ ] Vercel usage page and Supabase usage page show the expected low numbers.

## 5. Rolling back

Vercel keeps every deployment: use "Instant Rollback" (or promote the previous Preview) for the
code. Database migrations are additive; rollback notes for each are in docs/13. Restore data
from the latest local backup only if a migration damaged it (docs/15 section 8).
