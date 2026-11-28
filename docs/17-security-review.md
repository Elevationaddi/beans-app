# Security review (cycles 2 and 3, 2026-11-28)

## Cycle 3 update: Vercel and free tiers

Re-checked after the move to Vercel, Supabase Free and email-only sign-in (PRs #21-#27 and the
documentation PR). Internal review only; the external test (O2) is still required.

| Area                             | Result  | Notes                                                                                                                                            |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cron endpoint                    | Pass    | Answers 404 unless `Authorization: Bearer $CRON_SECRET`; secret required in production; ticks idempotent                                         |
| Background jobs without Redis    | Pass    | Outbox rows leased with `FOR UPDATE SKIP LOCKED`; every state change conditional; frozen leases retried                                          |
| Rate limits without Redis        | Pass    | Atomic PostgreSQL counter; exact under 70 concurrent requests (test)                                                                             |
| Live updates (Supabase Realtime) | Pass    | Channel names are HMACs of IDs; payload is ID, version and time only; API checks access before giving a channel; screens refetch through the API |
| Server key handling              | Pass    | `SUPABASE_SERVICE_ROLE_KEY` used by the API only; never in `NEXT_PUBLIC_`/`EXPO_PUBLIC_` names                                                   |
| Private file storage             | Pass    | Private bucket; signed upload and 5-minute download links; only files that passed the check get links                                            |
| Malware scanning                 | Gap     | No approved scanner. Production uses `FILE_SCANNER=disabled`: uploads refused before any bytes arrive (O4)                                       |
| Email-only sign-in               | Pass    | Supabase email codes (10-minute expiry recommended); no SMS; admin TOTP MFA (`aal2`) unchanged                                                   |
| Account deletion                 | Pass    | Rate-limited; row lock; refused while orders are open or the user is staff or admin; audit + outbox                                              |
| Loyalty rules and refunds        | Pass    | Rules validated server-side; products must belong to the café; refunds reverse stamps once per refund                                            |
| In-app QR scanner                | Pass    | Only accepts the signed table token format; the server still verifies the signature                                                              |
| Function errors                  | Pass    | A bad configuration answers 503 without printing values; storage outage answers 5xx with no key in the body (test)                               |
| Staging exposure                 | Planned | Vercel Authentication on all staging deployments; `noindex` headers (docs/18)                                                                    |

New or changed open items: O4 narrowed (storage adapter built, scanner still missing); O5 closed
(in-app scanner built, PR #26); O6 unchanged; O9 added (no automatic backups on Supabase Free);
O10 added (Vercel plan unknown: on Hobby, timeouts would run once a day).

This is an internal engineering review of the code as merged on 2026-11-28 (PRs #12–#19). It is
not an external penetration test. Gate G7 in docs/15 still needs an independent tester and a
SAST report before any pilot. Threats and controls from docs/10 and the phase 11 hardening
report (docs/14) still apply; this document covers what changed in cycle 2 and re-checks the
standing controls.

## Summary

| Area                                | Result                    | Notes                                                                                 |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| Token verification (Supabase JWT)   | Pass                      | Signature, issuer, audience and expiry checked; membership resolved in the database   |
| Development sign-in isolation       | Pass                      | Refused with `NODE_ENV=production`; separate issuer and key; tests cover the refusal  |
| Admin MFA                           | Pass                      | Every admin route and screen requires an `aal2` session; no super_admin bypass        |
| Tenant isolation (portal, tablet)   | Pass                      | Merchant and branch come from membership, never from the request; non-members get 404 |
| Server-authoritative money          | Pass                      | Prices, VAT, discounts and totals computed server-side in integer fils                |
| Phase 9 (stamps, promos, QR, gifts) | Pass (sandbox)            | Server applies every benefit; signed table tokens; gifts refused in production        |
| Tap adapter                         | Pass (unverified vs. Tap) | Webhook HMAC checked in constant time; test keys only; needs a real Tap sandbox run   |
| Secrets                             | Pass                      | No secret in git or bundles; gitleaks in CI; test keys assembled at runtime           |
| Dependencies                        | 1 moderate (tooling only) | See below                                                                             |
| Open items                          | 8                         | See "Findings and open items"                                                         |

## Authentication and sessions (D12)

- **API** (`apps/api/src/auth/token-verifier.ts`, `auth.guard.ts`): accepts Supabase access tokens
  only after checking the signature against the project's keys, the issuer, the audience and
  expiry. Roles and merchant memberships are read from the database on every request; role
  claims inside the token are ignored.
- **Admins** (`admin.guard.ts`): `@RequireAdmin(...roles)` needs a listed role from the database
  and an `aal2` (two-step verified) session. The admin console also refuses to render any screen
  before `aal2`. super_admin has no implicit access to other roles.
- **Customers** (Expo app): phone or email one-time code via Supabase Auth. The refresh token is
  stored in the device keychain (expo-secure-store), not AsyncStorage. A 401 ends the session.
  Apple and Google sign-in are not built (they need developer accounts, a paid service).
- **Businesses and staff**: email and password through Supabase; every staff member has an
  individual account linked to one merchant and, where relevant, one branch.
- **Development sign-in** (`dev-auth.controller.ts`, `dev-issuer.ts`): lists only the fictional
  seeded accounts and signs tokens with a per-process key under a separate issuer. `env.ts`
  refuses `DEV_AUTH_ENABLED=true` with `NODE_ENV=production`; the web and mobile builds only show
  it when built with `NEXT_PUBLIC_DEV_AUTH=true` / `EXPO_PUBLIC_DEV_AUTH=true`. Release builds must
  never set those flags (launch checklist item S4).

## Authorization and tenancy

- Portal and tablet routes resolve the merchant and branch from the signed-in user's membership.
  A merchant ID in the URL or body is checked against that membership, and a mismatch answers 404
  so other tenants' IDs cannot be discovered. Integration tests cover cross-tenant reads and
  writes for orders, menu, staff, payouts, loyalty, promotions and tables.
- Managers see tables only; stamp cards and promotions are owner-only (API and screens).
- Promotions need a marketing admin's approval before they go live; operations can see the queue
  but cannot decide. Every decision requires a reason and is audit-logged.

## Money and benefits

- Quotes and checkout compute price, VAT, discount and total on the server from the menu version.
  The app sends only a promo code, a stamp card ID or a gift ID; amounts sent by clients are
  ignored. One benefit per order, merchant-funded, held at checkout and released on payment
  failure, rejection or cancellation (tests in `engagement.int.test.ts`).
- All amounts are integer fils (`bigint`). The Tap adapter converts to and from Tap's decimal
  amounts with string arithmetic and rejects amounts with more than two decimals.
- Live payments stay off in code: `LIVE_PAYMENTS_ENABLED=true` is refused, and the Tap adapter
  only accepts keys matching `sk_test_…`.

## Phase 9 specifics

- **Table QR codes** carry an HMAC-signed token (`TABLE_TOKEN_SECRET`) with a version number.
  Rotating a table's code invalidates printed copies; retired tables are refused. The app checks
  every scanned code with the server before showing the table.
- **Gifts** are a sandbox feature: no money moves, the API refuses them in production, claim codes
  are single-use, stored only as a hash, and claims need an Idempotency-Key.
- **Feature flags** default to off; the seed turns them on for development.

## Payments: Tap sandbox adapter

- Hosted payment page only (`src_all`): no card data ever reaches our servers or apps.
- Webhooks are verified with Tap's `hashstring` (HMAC-SHA256 with the secret key) compared in
  constant time; tampered, unsigned, malformed or other-key notifications are refused. The
  webhook is treated as a hint: the reconciler fetches the charge from Tap before changing state.
- Redirect URLs are only passed to the app when they use https.
- Tap error bodies and keys are never included in thrown errors or logs.
- **Not yet verified against Tap itself:** no Tap test key has been provided. The amount format
  inside the hash, the header name and the list endpoint's period format follow Tap's public
  documentation and must be confirmed in a real sandbox run (open item O1).

## Secrets

- No secrets in git: `.env` files are ignored, `.env.example` holds names only, gitleaks runs on
  every pull request. On 2026-11-28 gitleaks flagged two obviously fake test keys
  (`sk_test_abc123`); the tests now assemble fake keys at runtime so the scanner stays strict.
- Web and mobile bundles only contain public values (API URL, Supabase URL and anon key). Service
  role keys, signing secrets and the Tap secret key are API-only.
- Production refuses to start without its signing secrets, an explicit CORS allowlist and real
  adapters.

## Dependencies

`pnpm audit --prod` on 2026-11-28: no high or critical advisories (the CI gate), 1 moderate:
`minimatch` (GHSA-g3hv-75wg-m249, denial of service with crafted glob patterns) via
`expo > @expo/fingerprint`. Build-time only; patterns come from the repository, not users.
Revisit when Expo ships an update.

## Findings and open items

| #   | Item                                                                                                        | Severity | Owner / next step                                             |
| --- | ----------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| O1  | Tap adapter not yet run against Tap's sandbox                                                               | Medium   | Needs Tap test keys from the founder                          |
| O2  | No external penetration test or SAST report (G7)                                                            | High     | Founder to engage a tester before any pilot                   |
| O3  | Step-up MFA for role changes and bank detail changes not built; merchant owners have no MFA                 | Medium   | Decide with D12; build before pilot                           |
| O4  | Supabase Storage adapter built (PR #23); no approved malware scanner, so uploads are disabled in production | High     | Founder: approve a scanner or another way to verify documents |
| O5  | ~~Native camera QR scanning not built~~ Closed: in-app scanner (PR #26)                                     | —        | —                                                             |
| O6  | Apple and Google sign-in not built                                                                          | Low      | Needs developer accounts (paid)                               |
| O7  | Privacy retention periods not set (D11), so deletion jobs are not final                                     | Medium   | Founder and legal counsel                                     |
| O8  | Moderate tooling advisory (minimatch)                                                                       | Low      | Update Expo when fixed                                        |
| O9  | Supabase Free has no automatic backups                                                                      | High     | Manual drill now; managed backups before real data (docs/24)  |
| O10 | Vercel plan unknown; Hobby runs cron once a day and forbids commercial use                                  | High     | Founder: confirm the plan                                     |

No high-severity defect was found in the code reviewed. O2 and O4 are high because they block a
pilot, not because a vulnerability is known.
