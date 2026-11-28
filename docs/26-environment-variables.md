# Environment variables (no secret values)

This list names every setting; it never holds a value that is secret. Secrets are typed only
into Vercel's environment variable screen (marked **Sensitive**) or a local `.env` file that
git ignores. `.env.example` at the repository root has the same names with local development
placeholders. The API checks all of them when it starts (`apps/api/src/config/env.ts`) and
refuses unsafe combinations in production.

Generate each "random 32+" value separately, for example with `openssl rand -base64 48`, and
never reuse one between staging and production.

## API (`apps/api`, Vercel project root `apps/api`)

| Name                        | Secret  | Staging value                                               | Notes                                                             |
| --------------------------- | ------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`                  | No      | `production`                                                | Staging runs the production checks on purpose                     |
| `API_VERSION`               | No      | Git commit or release name                                  | Shown by `/health`                                                |
| `DATABASE_URL`              | Yes     | Supabase transaction pooler (port 6543) + `?pgbouncer=true` | Runtime connection                                                |
| `DIRECT_URL`                | Yes     | Supabase session pooler or direct connection                | Migrations only                                                   |
| `DATABASE_POOL_MAX`         | No      | `2`                                                         | Connections per function instance (1-3 on Vercel)                 |
| `CORS_ORIGINS`              | No      | Staging portal and admin addresses, comma-separated         | No wildcards                                                      |
| `API_PUBLIC_URL`            | No      | Staging API address                                         | Used for Tap's webhook address                                    |
| `SUPABASE_URL`              | No      | `https://<project>.supabase.co`                             |                                                                   |
| `SUPABASE_JWKS_URL`         | No      | `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`              | Token signature keys                                              |
| `SUPABASE_JWT_ISSUER`       | No      | `<SUPABASE_URL>/auth/v1`                                    |                                                                   |
| `SUPABASE_JWT_AUDIENCE`     | No      | `authenticated`                                             |                                                                   |
| `SUPABASE_ANON_KEY`         | No      | Supabase "anon" / publishable key                           | Public by design                                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase service role / secret key                          | Server only. Never in a client build                              |
| `REALTIME_DRIVER`           | No      | `supabase`                                                  | `memory` is for local development                                 |
| `REALTIME_CHANNEL_SECRET`   | **Yes** | Random 32+                                                  | Makes live channel names unguessable                              |
| `CRON_SECRET`               | **Yes** | Random 32+                                                  | Vercel Cron sends it; without it the tick route answers 404       |
| `OUTBOX_KICK_ENABLED`       | No      | `true`                                                      | Dispatch right after each write                                   |
| `OUTBOX_RELAY_ENABLED`      | No      | `false`                                                     | No background loop on Vercel                                      |
| `CHECKOUT_SWEEP_ENABLED`    | No      | `false`                                                     | The cron tick runs the sweep instead                              |
| `STORAGE_DRIVER`            | No      | `supabase`                                                  |                                                                   |
| `SUPABASE_STORAGE_BUCKET`   | No      | `merchant-documents`                                        | Private bucket                                                    |
| `FILE_SCANNER`              | No      | `disabled`                                                  | Document uploads refused until a scanner is approved (docs/27 L1) |
| `FILE_SIGNING_SECRET`       | **Yes** | Random 32+                                                  |                                                                   |
| `PAYMENT_PROVIDER`          | No      | `tap` (or `fake` before Tap test keys exist)                |                                                                   |
| `TAP_SECRET_KEY`            | **Yes** | Tap **test** secret key                                     | Live keys are refused by the API (docs/29)                        |
| `TAP_RETURN_URL`            | No      | Customer web app return page                                |                                                                   |
| `PAYMENT_WEBHOOK_SECRET`    | **Yes** | Random 32+                                                  |                                                                   |
| `LIVE_PAYMENTS_ENABLED`     | No      | leave unset                                                 | The API refuses `true`                                            |
| `PICKUP_CODE_SECRET`        | **Yes** | Random 32+                                                  |                                                                   |
| `TABLE_TOKEN_SECRET`        | **Yes** | Random 32+                                                  | Rotating it voids printed table codes                             |
| `QUOTE_TTL_SECONDS`         | No      | `300`                                                       | Sandbox value (D10)                                               |
| `RESERVATION_TTL_SECONDS`   | No      | `600`                                                       | Sandbox value (D10)                                               |
| `ACCEPT_TIMEOUT_SECONDS`    | No      | `120`                                                       | Sandbox value (D10)                                               |
| `RATE_LIMIT_ENABLED`        | No      | `true`                                                      | Cannot be `false` in production                                   |
| `DEV_AUTH_ENABLED`          | No      | leave unset                                                 | The API refuses it in production                                  |

Local development only: `PORT`, `STORAGE_LOCAL_DIR`.

## Business portal and barista tablet (`apps/merchant`) and admin console (`apps/admin`)

| Name                            | Secret | Staging value                          | Notes                                   |
| ------------------------------- | ------ | -------------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | No     | Staging API address                    | Built into the page                     |
| `NEXT_PUBLIC_SUPABASE_URL`      | No     | Same as `SUPABASE_URL`                 |                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No     | Same as `SUPABASE_ANON_KEY`            | Public by design                        |
| `NEXT_PUBLIC_CUSTOMER_APP_URL`  | No     | Customer web app address (portal only) | Used in printed table QR codes          |
| `ALLOW_INDEXING`                | No     | leave unset                            | Unset sends `noindex` to search engines |
| `NEXT_PUBLIC_DEV_AUTH`          | No     | **never set**                          | Local development sign-in only          |

## Customer app (`apps/mobile`, store builds and Vercel web project)

| Name                            | Secret | Staging value               | Notes                          |
| ------------------------------- | ------ | --------------------------- | ------------------------------ |
| `EXPO_PUBLIC_API_URL`           | No     | Staging API address         | Built into the app             |
| `EXPO_PUBLIC_SUPABASE_URL`      | No     | Same as `SUPABASE_URL`      |                                |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | No     | Same as `SUPABASE_ANON_KEY` | Public by design               |
| `EXPO_PUBLIC_DEV_AUTH`          | No     | **never set**               | Local development sign-in only |

Anything named `NEXT_PUBLIC_` or `EXPO_PUBLIC_` is copied into the code that runs on phones and
browsers, so only public values may use those names.

## Kept outside the code (dashboard settings only)

| Where              | Setting                                 |
| ------------------ | --------------------------------------- |
| Supabase Auth SMTP | Resend API key (docs/25 section 3)      |
| Supabase database  | Database password                       |
| Vercel             | Spend Management, Deployment Protection |
