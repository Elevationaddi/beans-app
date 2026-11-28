# Required free accounts and setup instructions (cycle 3)

**None of these accounts has been created by us, and nothing has been deployed.** This is the
list the founder (or someone the founder authorizes) follows once the infrastructure plan is
approved. Every account below is free or already paid for; no card should be added anywhere
except the existing Vercel subscription.

Rules for every step:

- Secret values (keys, passwords, connection strings) are typed **only** into the provider's
  dashboard or Vercel's environment variable screen. Never paste them into chat, GitHub,
  documents, screenshots or tickets.
- Decline every trial, upgrade prompt or "add a payment method" prompt. If a step seems to
  require one, stop and ask the founder.
- Staging uses fictional data only (docs/28).

## 1. Accounts

| #   | Account           | Plan          | Who creates it | Card needed | Used for                                     |
| --- | ----------------- | ------------- | -------------- | ----------- | -------------------------------------------- |
| 1   | Vercel            | Existing plan | Already exists | Existing    | API, portal, tablet, admin, customer web app |
| 2   | Supabase          | Free          | Founder        | No          | Database, sign-in, files, live updates       |
| 3   | Resend            | Free          | Founder        | No          | Sign-in emails (codes, resets, invitations)  |
| 4   | GitHub            | Free          | Already exists | No          | Code and CI                                  |
| 5   | Expo              | Free          | Founder        | No          | Mobile app project; builds run locally       |
| 6   | Firebase (Google) | Spark (free)  | Founder        | No          | Push notifications later; not sending yet    |
| 7   | Tap Payments      | Test mode     | Founder        | No          | Sandbox card payments (docs/29)              |

Use a shared company mailbox as the owner of each account, turn on two-step verification on
every account, and give developers their own member logins rather than sharing one.

## 2. Vercel (existing account)

1. **Confirm the plan** (Settings → Billing). Pro is assumed. On Hobby, cron runs once a day and
   commercial use is not allowed, so order timeouts and expiries would not work (docs/27 L3).
2. **Spend Management** (Settings → Billing → Spend Management): set the monthly amount to the
   included credit and choose to **pause projects** when it is reached. This keeps the bill at
   the subscription price; the trade-off is that the sites go offline until the next cycle.
3. Create four projects from the GitHub repository, each with its app folder as the **Root
   Directory**: `apps/api`, `apps/merchant`, `apps/admin`, `apps/mobile` (customer web app).
   The `vercel.json` in each folder sets the build, region (`bom1`, Mumbai) and cron.
4. **Deployment Protection** (each project → Settings → Deployment Protection): turn on
   **Vercel Authentication** for all deployments of the staging projects. Do not buy the
   Password Protection add-on.
5. Add the environment variables from docs/26 to each project, environment "Preview" for
   staging. Mark every secret as **Sensitive**.
6. Do not connect a domain and do not promote anything to Production until the founder approves.

## 3. Supabase (Free)

1. Create an organization on the Free plan, then one project named for staging, region **South
   Asia (Mumbai)**, with a long generated database password (kept in the dashboard only).
2. **Database connection strings** (Connect button): the _transaction pooler_ string (port 6543)
   becomes `DATABASE_URL` with `?pgbouncer=true` added; the _session pooler_ or direct string
   becomes `DIRECT_URL` for migrations.
3. **Authentication → Sign In / Providers**
   - Email: enabled; "Confirm email" on.
   - Email OTP expiration: **600 seconds** (10 minutes).
   - Phone, Apple, Google: off (no SMS provider; Apple and Google need paid developer accounts).
4. **Authentication → Multi-Factor**: TOTP (authenticator app) **enabled**. Phone MFA off.
5. **Authentication → Rate Limits**: keep the defaults or lower them; the API adds its own
   per-user and per-IP limits.
6. **Authentication → URL Configuration**: Site URL = the staging portal address; add the
   staging portal, admin and customer web app addresses to the redirect list (for password
   reset and invitation links).
7. **Authentication → Emails → Templates**: the "Magic Link" template must show the code
   (`{{ .Token }}`) because the customer app signs in with the 6-digit code. Keep wording in
   English and Arabic once reviewed (docs/13 translation notes).
8. **Authentication → Emails → SMTP Settings** (custom SMTP, after Resend in section 4):
   host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key typed
   directly into this screen, sender = an address on the verified domain.
9. **Storage**: run `pnpm --filter @beans/api storage:setup` once with the staging variables;
   it creates the private `merchant-documents` bucket with a size and type limit. Never make the
   bucket public.
10. **Realtime**: nothing to switch on; the API uses Broadcast through the server key.
11. **Backups**: Free has none. Run the backup drill (docs/27, `apps/api/scripts/backup-restore-check.sh`)
    to an encrypted local disk before and during the pilot.
12. Note in the calendar: a Free project **pauses after 7 days without activity**. The per-minute
    cron should keep it active; check the dashboard during the first week.

## 4. Resend (Free)

1. Create the account and an API key with "Sending access" only.
2. **Verify a sending domain** (Domains → Add). Without a verified domain, Resend sends only to
   the account owner's own address, so customers and staff would not receive sign-in codes.
   This means staging sign-in for anyone else needs a domain (docs/24 section 3).
3. Enter the key in Supabase's SMTP screen only (section 3 step 8). The API itself does not send
   email today.
4. Limit: 100 emails a day, 3,000 a month. Watch the Resend dashboard during the pilot.

## 5. GitHub (Free)

Already in use. CI runs lint, types, unit, integration, browser tests and the secret scan on
every pull request. Do not add a payment method; when Actions minutes run out, CI pauses until
the next month and tests can run locally (`pnpm test`, `pnpm test:e2e`).

## 6. Expo (Free) and mobile builds

1. Choose the Android package name and iOS bundle identifier (they depend on the final name,
   D13, so they are **not set yet** in `app.json`). They cannot be changed after a store release.
2. Create the account and run `npx eas init` in `apps/mobile` once (stores the project ID in
   `app.json`), then `npx eas build:configure` to create `eas.json` (not in the repository yet).
3. Build locally: `npx eas build --local --platform android` (needs Android Studio) or
   `npx expo run:ios` on a Mac with Xcode. Cloud builds are limited to 15 per
   platform each month on Free.
4. Installing on iPhones outside the developer's own devices, and publishing to either store,
   needs the paid store memberships (docs/24). Not bought.

## 7. Firebase (Spark)

Create a project, add the Android app (package name from section 6 step 1) and keep
`google-services.json` out of git. Push sending is not built yet and real notifications need
the founder's approval.

## 8. Tap Payments (test mode)

Follow docs/29. Test keys only; the API refuses live keys.

## 9. After the accounts exist

Follow the staging guide (docs/18) in order. Its last step is a checklist that must pass before
anyone calls staging ready.
