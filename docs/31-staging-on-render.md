# Private staging on Render Free and Supabase Free (cycle 4)

**Decision (founder, 2026-11-28):** private staging runs on **Render Free (USD 0)**. The
database, sign-in, files and live updates stay on **Supabase Free in Mumbai**, which is approved
for fictional staging data only. Vercel stays on Hobby and is not used for staging, because the
Hobby plan is for non-commercial use only and we do not work around that restriction.

Fictional data only. No live payments, no real document uploads, and no public launch.

## 1. Architecture

| Part                                         | Where                                        | Render service        | Notes                                                                      |
| -------------------------------------------- | -------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| API (NestJS)                                 | Render web service, Singapore, free          | `cm-staging-api`      | `NODE_ENV=production`, `DEPLOY_ENV=staging`, sandbox payments, uploads off |
| Business portal and barista tablet (Next.js) | Render web service, Singapore, free          | `cm-staging-portal`   | Tablet is at `/tablet`                                                     |
| Admin console (Next.js)                      | Render web service, Singapore, free          | `cm-staging-admin`    | Sign-in plus authenticator code; the API checks every admin route          |
| Customer app (web preview)                   | Render static site (global CDN), free        | `cm-staging-customer` | Expo web build. Phones use local builds (docs/18)                          |
| Database                                     | Supabase Free PostgreSQL, Mumbai             | —                     | Separate staging project, not shared with anything else                    |
| Sign-in                                      | Supabase Auth, Mumbai                        | —                     | Public sign-ups off; demo accounts only (docs/32)                          |
| Files                                        | Supabase Storage, Mumbai                     | —                     | Bucket exists; uploads are switched off (`FILE_SCANNER=disabled`)          |
| Live order updates                           | Supabase Realtime, Mumbai                    | —                     | Order ID, version and time only                                            |
| Backups                                      | Private GitHub repository, encrypted, 7 days | —                     | docs/30                                                                    |

Singapore is the closest Render region to Mumbai and the UAE (Render has no Middle East or
India region). Requests go from the user to Render in Singapore, and from Render to Supabase in
Mumbai.

Everything is described in `render.yaml` (a Render "Blueprint") at the repository root.

## 2. Safeguards built in

| Requirement                    | How                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate staging database      | Its own Supabase project, used for nothing else                                                                                                                                                                                                   |
| Fictional accounts             | `pnpm db:demo` plus `demo:provision` (docs/32)                                                                                                                                                                                                    |
| Sandbox payments               | `PAYMENT_PROVIDER=fake` is allowed only with `DEPLOY_ENV=staging`. `LIVE_PAYMENTS_ENABLED=true` is refused in staging. `sk_live_` keys are refused everywhere                                                                                     |
| Separate environment variables | Set per Render service. Secrets are typed into the Render dashboard, and generated ones are random per service. None are in git                                                                                                                   |
| Protected admin routes         | Every `/v1/admin/*` route needs a signed-in admin with the right role **and** a two-step (authenticator) session. The console shows nothing without them                                                                                          |
| No search indexing             | `X-Robots-Tag: noindex, nofollow` on every response (API, portal, admin, customer site), plus a `robots.txt` that disallows everything                                                                                                            |
| Production payments off        | As above; there is no Tap live key anywhere                                                                                                                                                                                                       |
| Document uploads off           | `FILE_SCANNER=disabled`. The API refuses attachments, and the screens explain the manual licence check instead                                                                                                                                    |
| No development sign-in         | The API refuses to start with `DEV_AUTH_ENABLED` under `NODE_ENV=production`. The web apps' `NEXT_PUBLIC_DEV_AUTH` and `EXPO_PUBLIC_DEV_AUTH` are not set in `render.yaml`                                                                        |
| Spending safeguards            | Render Free and Supabase Free both run with **no payment method on file**, so they cannot bill. When a limit is reached, the service is suspended or restricted instead of upgraded. Never add a card or click "Upgrade" without written approval |

**Limitation: the sites are reachable by anyone who knows the address.** Render Free has no
password protection for whole sites. To keep this acceptable: the addresses are random-looking
and not published, indexing is blocked, every screen with data needs sign-in, public sign-ups
are off, and only fictional data exists. If stronger access control is needed (for example
IP allow lists or a password on the whole site), that needs a paid plan and the founder's
approval.

## 3. Free limits and what happens when one is reached

Render limits, read from Render's documentation on 2026-11-28:

| Limit                                                         | Effect on staging                                                                                                                                                             | What protects the data                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web services sleep after 15 minutes without traffic           | The first request after a quiet period takes about a minute. Timers (acceptance window, payment hold, outbox) run **only while the API is awake**, and catch up when it wakes | Timers run inside database transactions and are idempotent, so running late never double-charges or loses records |
| 750 free instance hours a month, shared by the 3 web services | If the services are busy for most of the month, Render suspends them until the next month                                                                                     | Data stays in Supabase. Nothing is deleted                                                                        |
| No free cron jobs                                             | No timer runs while the API sleeps                                                                                                                                            | As above. The pilot needs a decision before real use (see section 6)                                              |
| Free build minutes                                            | Deploys are manual (`autoDeployTrigger: off`) to save them                                                                                                                    | —                                                                                                                 |
| Render's own guidance: free services are not for production   | Staging only                                                                                                                                                                  | —                                                                                                                 |

Supabase Free limits (docs/23): 500 MB database, 1 GB files, 5 GB egress, 2 projects.
**A Supabase Free project pauses after 7 days without activity.** We do not send artificial
traffic to prevent this, because the founder asked us not to. If staging is not used for a
week, someone resumes the project in the Supabase dashboard (one click, a few minutes). The
daily backup reads the database, but it exists to protect data, not to keep the project awake.

Usage checks (weekly, 5 minutes): Render dashboard → Billing/Usage for free instance hours and
build minutes. Supabase dashboard → Usage for database size, egress and Auth users. Record the
numbers in the staging test log.

## 4. Setting up staging (founder, about 45 minutes)

These steps need the founder's own accounts. Nobody else needs the keys, and they are never
sent in chat.

1. **Supabase:** create a new project named `coffee-marketplace-staging`, region
   **South Asia (Mumbai)**, plan **Free**. Then:
   - Turn off public sign-ups: Authentication → Sign In / Providers → "Allow new users to sign up".
   - Turn on authenticator app (TOTP) multi-factor authentication. It is on by default.
   - Note the project URL, the anon (public) key, the service role key, and the
     transaction-pooler and session-pooler connection strings.
2. **Database:** on your computer, from the repository folder, run
   `DATABASE_URL=<session pooler> pnpm db:migrate`, then
   `DATABASE_URL=<session pooler> pnpm db:demo`. Then run
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm --filter @beans/api storage:setup` to create
   the private bucket.
3. **Render:** in the Render dashboard, choose New → Blueprint, pick the `beans-app`
   repository, and accept `render.yaml`. Render asks for each `sync: false` value:
   - `DATABASE_URL`: the transaction pooler string, port 6543, with `?pgbouncer=true`.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: from step 1.
   - `SUPABASE_JWKS_URL`: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`.
     `SUPABASE_JWT_ISSUER`: `<SUPABASE_URL>/auth/v1`.
   - `API_PUBLIC_URL`: the API address Render shows, for example
     `https://cm-staging-api-xxxx.onrender.com`.
   - `CORS_ORIGINS`: the portal, admin and customer addresses, separated by commas.
   - `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*`: the API address, the Supabase URL and the **anon** key
     (never the service role key).
   - `NEXT_PUBLIC_MERCHANT_URL`: the portal address.
     Do not add a payment method.
4. **Deploy:** in each service, click Manual Deploy → Deploy latest commit. Wait for
   `/health` on the API to answer `ok`.
5. **Demo accounts:** run `demo:provision`, then `demo:orders` (docs/32, section 5).
6. Give testers their addresses and accounts as described in docs/32. The staging addresses
   are filled in below once they exist.

## 5. Staging addresses

| Who                                                     | Address                                    | Sign-in                                         |
| ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Customers                                               | _set after step 4_ (`cm-staging-customer`) | Demo account form (staging only)                |
| Café owners and branch managers                         | _set after step 4_ (`cm-staging-portal`)   | Email and password                              |
| Baristas                                                | portal address + `/tablet`                 | Email and password, then choose the branch      |
| Admins (operations, finance, support, marketing, super) | _set after step 4_ (`cm-staging-admin`)    | Email and password, then the authenticator code |

## 6. Before a real pilot

Render Free is fine for testing. It is **not** suitable for a pilot with real cafés, for these
reasons:

- The API sleeps, so the 120-second acceptance window cannot be enforced while it sleeps.
- There are no cron jobs.
- Free services can be suspended.
- There is no site-wide access control.

A pilot needs the founder to approve a paid option, for example an always-on Render instance or
Vercel Pro (docs/24). This is a launch blocker (docs/19).
