# Screen-by-screen completion matrix

Audit of 2026-11-28 against docs/02–05, docs/09 and the founder instructions of 2026-11-28.
"API" is what the backend offers today; "Screen" is what a person can use today; "Plan" is the
work in this cycle. This file is updated as each part lands; the final column records evidence.

Legend: **Yes** working and tested (evidence column) · **Part** some of it · **No** missing.

## Audit summary (start of cycle)

- Backend: 102 routes covering identity, tenancy, onboarding, catalog, discovery, cart,
  checkout, sandbox payments, finance, fulfilment, tickets, privacy and dashboards. Tested by
  172 integration tests. Missing: sign-in support for local development, customer management,
  admin roles management, writable settings and feature flags, platform pause, notifications,
  merchant finance views, homepage content, menu moderation, disputes and chargebacks, and all of
  phase 9 (stamp cards, promotions, QR dine-in, gifts).
- Customer app: 8 guest screens (onboarding, home, explore, branch, product, cart, orders
  placeholder, profile). No sign-in, checkout, tracking, history or account screens.
- Business portal, barista tablet, admin console: placeholder pages only.

## Authentication (D12)

| Screen / capability                         | API  | Screen | Plan                                                    | Evidence |
| ------------------------------------------- | ---- | ------ | ------------------------------------------------------- | -------- |
| Token verification, DB roles, admin MFA     | Yes  | —      | Keep                                                    |          |
| Local development sign-in (fictional users) | No   | No     | Dev-only issuer, refused in production                  |          |
| Customer phone OTP, email, Apple, Google    | Part | No     | Supabase client screens; dev sign-in locally            |          |
| Business email and password                 | Part | No     | Portal sign-in, register, reset                         |          |
| Staff individual accounts                   | Yes  | No     | Tablet sign-in and branch choice                        |          |
| Admin email, password and MFA               | Yes  | No     | Admin sign-in with MFA step                             |          |
| Password reset, recovery, session expiry    | No   | No     | Screens on each surface; expiry handling in API clients |          |
| Account deletion                            | Part | No     | Deletion request flow (privacy request) plus screen     |          |

## Customer app (docs/02)

| ID  | Screen                         | API  | Screen | Plan                                             | Evidence |
| --- | ------------------------------ | ---- | ------ | ------------------------------------------------ | -------- |
| C01 | Splash, onboarding, sign-in    | Part | Part   | Add sign-in, verification, consent               |          |
| C02 | Home (featured, reorder, favs) | Part | Part   | Featured from admin content, reorder, favourites |          |
| C03 | Explore, nearby, map, filters  | Yes  | Part   | Map view, filters, sort                          |          |
| C04 | Shop and branch                | Yes  | Yes    | Favourite toggle, allergens                      |          |
| C05 | Product customisation          | Yes  | Yes    | Keep                                             |          |
| C06 | Cart (server cart, promo code) | Part | Part   | Server cart when signed in, promo codes          |          |
| C07 | Checkout, slots, curbside, pay | Yes  | No     | Build                                            |          |
| C08 | Live order tracking            | Yes  | No     | Build with live updates, arrival, pickup code    |          |
| C09 | History, receipt, reorder      | Yes  | No     | Build                                            |          |
| C10 | Rewards and stamp cards        | No   | No     | Phase 9                                          |          |
| C11 | Gifts                          | No   | No     | Phase 9, sandbox only                            |          |
| C12 | Profile, vehicles, settings    | Part | Part   | Vehicles, payment methods, privacy, deletion     |          |
| C13 | Support                        | Yes  | No     | Build                                            |          |
| —   | QR dine-in                     | No   | No     | Phase 9                                          |          |
| —   | Promotions, notifications      | No   | No     | Phase 9 and notification inbox                   |          |

## Business portal (docs/03)

| ID  | Screen                             | API  | Screen | Plan                             | Evidence                                                                   |
| --- | ---------------------------------- | ---- | ------ | -------------------------------- | -------------------------------------------------------------------------- |
| B01 | Registration, documents, status    | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B02 | Dashboard                          | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B03 | Branches, hours, holidays, pause   | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B04 | Menu, categories, options          | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B05 | Availability and inventory         | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B06 | Orders (incoming, scheduled, done) | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B07 | Staff and permissions              | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B08 | Loyalty, stamp cards, promotions   | No   | No     | Phase 9                          |                                                                            |
| B09 | Finance, transactions, payouts     | Yes  | Yes    | Merchant finance API and screens | PR #12; finance.int B09 test                                               |
| B10 | Analytics                          | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B11 | Support, refund requests           | Yes  | Yes    | Build                            | PR #12; portal walk 2026-11-28                                             |
| B12 | Settings, notifications            | Part | Part   | Build                            | PR #12: profile, password, deletion request; notification settings pending |

## Barista tablet (docs/05)

| ID  | Screen                                      | API | Screen | Plan                                 | Evidence                                                              |
| --- | ------------------------------------------- | --- | ------ | ------------------------------------ | --------------------------------------------------------------------- |
| T01 | Staff sign-in, branch choice                | Yes | Yes    | Build                                | cycle-2-tablet; tablet.int + browser walk                             |
| T02 | New orders, alerts, accept and reject       | Yes | Yes    | Build with live stream and sound cue | cycle-2-tablet; tablet.int + browser walk                             |
| T03 | Preparing, timers, scheduled queue          | Yes | Yes    | Build                                | cycle-2-tablet; tablet.int + browser walk                             |
| T04 | Ready, arrival, vehicle, table, pickup code | Yes | Part   | Build (table after phase 9)          | cycle-2-tablet; tablet.int + browser walk; table number after phase 9 |
| T05 | Completed                                   | Yes | Yes    | Build                                | cycle-2-tablet; tablet.int + browser walk                             |
| T06 | Issues, delays, offline, unavailable items  | Yes | Yes    | Build; issue report as ticket        | cycle-2-tablet; tablet.int + browser walk                             |

## Admin console (docs/04)

| ID  | Screen                                         | API  | Screen | Plan                                 | Evidence |
| --- | ---------------------------------------------- | ---- | ------ | ------------------------------------ | -------- |
| A01 | Platform overview                              | Yes  | No     | Build                                |          |
| A02 | Merchants, verification, branches              | Yes  | No     | Build; suspend                       |          |
| A03 | Customers                                      | No   | No     | API and screen                       |          |
| A04 | Order monitoring                               | Part | No     | Admin order list API and screen      |          |
| A05 | Finance, refunds, payouts, reconciliation      | Yes  | No     | Build; disputes and chargebacks      |          |
| A06 | Customer and merchant support                  | Yes  | No     | Build                                |          |
| A07 | Promotions, gifts, loyalty, homepage, featured | No   | No     | Phase 9 and content API              |          |
| A08 | Reports and exports                            | Yes  | No     | Build                                |          |
| A09 | Settings, commission, feature flags, pause     | Part | No     | Writable, audited settings and flags |          |
| A10 | Audit, security logs, admin permissions        | Part | No     | Build; admin roles API               |          |
| —   | Menu moderation, staff, notifications, privacy | Part | No     | Build                                |          |
