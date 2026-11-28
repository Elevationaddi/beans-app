# Launch readiness checklist (2026-11-28)

One list to tick before each step: staging, sandbox pilot, live pilot. Each line names who signs
it. "Done" means there is evidence (a link, a report, a test run), not that code exists. The gates
G1–G12 are defined in docs/15; this list breaks them into checkable items and records today's
state. Nothing has been deployed and no real money has moved.

Legend: ✅ done with evidence · 🟡 built, needs a real-world check · ⛔ not done / blocked on a decision

## A. Product (all four interfaces)

| #   | Item                                                                       | State | Evidence / blocker                                | Signs   |
| --- | -------------------------------------------------------------------------- | ----- | ------------------------------------------------- | ------- |
| A1  | Customer app: browse, cart, sign-in, checkout, tracking, receipts, account | ✅    | docs/16; mobile tests; browser tests; screenshots | Eng     |
| A2  | Business portal: menu, branches, staff, orders, finance, loyalty, tables   | ✅    | docs/16; browser tests; screenshots               | Eng     |
| A3  | Barista tablet: queue, accept/reject, ready, handoff code                  | ✅    | Browser tests                                     | Eng     |
| A4  | Admin console: 14 screens + promotions review, MFA                         | ✅    | Browser tests                                     | Eng     |
| A5  | Stamp cards, promotions, QR dine-in, sandbox gifts                         | ✅    | engagement tests (API, mobile, browser)           | Eng     |
| A6  | Apple and Google sign-in                                                   | ⛔    | Needs developer accounts (paid)                   | Founder |
| A7  | Native camera QR scanning inside the app                                   | ⛔    | Product decision; phone camera links work today   | Founder |
| A8  | Final name, logo, typography (D13)                                         | ⛔    | Palette approved; rest undecided                  | Founder |
| A9  | UX/UI design pass applied to the frontends                                 | ⛔    | Design spec handed off; awaiting approval         | Founder |
| A10 | Arabic copy reviewed by a native speaker                                   | ⛔    | All Arabic marked draft                           | Founder |

## B. Money and payments

| #   | Item                                                                 | State | Evidence / blocker                           | Signs            |
| --- | -------------------------------------------------------------------- | ----- | -------------------------------------------- | ---------------- |
| B1  | Commission, payouts, VAT, refunds configurable and audited (D02–D08) | ✅    | Sandbox values from founder decisions        | Eng              |
| B2  | Tap sandbox adapter built                                            | 🟡    | Unit and integration tests with a fake Tap   | Eng              |
| B3  | Tap adapter verified with real Tap test keys                         | ⛔    | Needs Tap test keys                          | Founder, eng     |
| B4  | Tap merchant account, KYC and contract                               | ⛔    | Founder                                      | Founder, finance |
| B5  | Payout process (manual bank transfers, weekly) written and rehearsed | ⛔    | Process and bank chosen by finance           | Finance          |
| B6  | Merchant agreements signed for the pilot cafés                       | ⛔    | Legal review (docs/21)                       | Founder, legal   |
| B7  | Live payments code switch reviewed against approved decisions (G9)   | ⛔    | Stays refused in code until written approval | Founder          |

## C. Security and privacy

| #   | Item                                                           | State | Evidence / blocker              | Signs          |
| --- | -------------------------------------------------------------- | ----- | ------------------------------- | -------------- |
| C1  | Internal security review                                       | ✅    | docs/17                         | Eng            |
| C2  | External penetration test and SAST, no open high findings (G7) | ⛔    | Paid service; needs approval    | Founder        |
| C3  | Step-up MFA for role and bank changes; MFA for merchant owners | ⛔    | docs/17 O3                      | Founder, eng   |
| C4  | Object storage and malware scanner adapters                    | ⛔    | Provider choice (D11)           | Eng            |
| C5  | Retention periods and deletion jobs                            | ⛔    | D11, legal                      | Founder, legal |
| C6  | Privacy policy and terms published (EN/AR)                     | ⛔    | Legal counsel (docs/21)         | Legal          |
| C7  | Secret scanning and dependency audit in CI                     | ✅    | CI "Secret and dependency scan" | Eng            |

## D. Infrastructure and operations

| #   | Item                                             | State | Evidence / blocker                        | Signs   |
| --- | ------------------------------------------------ | ----- | ----------------------------------------- | ------- |
| D1  | Hosting provider and region chosen (D11)         | ⛔    | Options and costs in docs/20              | Founder |
| D2  | Staging built per docs/18 and checks passed      | ⛔    | Needs D1 and budget approval              | Eng     |
| D3  | Supabase staging and production projects         | ⛔    | D12 region and plan                       | Founder |
| D4  | SMS sender for phone sign-in (Twilio proposed)   | ⛔    | Paid; needs approval and UAE sender rules | Founder |
| D5  | Monitoring and alerts (docs/15 section 6)        | ⛔    | Vendor not chosen                         | Eng     |
| D6  | Backup restore and rollback rehearsed in staging | ⛔    | Needs D2                                  | Eng     |
| D7  | Load test in staging                             | ⛔    | Needs D2                                  | Eng     |
| D8  | On-call owner, support hours, escalation (G11)   | ⛔    | Founder                                   | Founder |

## E. Stores and legal

| #   | Item                                                   | State | Evidence / blocker           | Signs   |
| --- | ------------------------------------------------------ | ----- | ---------------------------- | ------- |
| E1  | Apple Developer and Google Play accounts               | ⛔    | Paid; company details needed | Founder |
| E2  | Store listings, privacy labels, data safety form       | ⛔    | Needs A8, C5, C6             | Founder |
| E3  | Trade licence covers marketplace / e-commerce activity | ⛔    | docs/21                      | Legal   |
| E4  | Trademark search and filing for the final name         | ⛔    | docs/21; name not chosen     | Legal   |
| E5  | Device accessibility audit (G6)                        | ⛔    | External auditor             | Founder |

## F. Pilot (14 days, 2–3 cafés in Abu Dhabi, D10)

| #   | Item                                                   | State | Signs        |
| --- | ------------------------------------------------------ | ----- | ------------ |
| F1  | Cafés selected and onboarded in staging                | ⛔    | Founder, ops |
| F2  | Baristas trained on the tablet; printed table QR codes | ⛔    | Ops          |
| F3  | Sandbox pilot exit criteria met (docs/15 section 10)   | ⛔    | Founder, ops |
| F4  | Written approval for real transactions                 | ⛔    | Founder      |
