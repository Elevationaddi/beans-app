# Decision register
All items below are proposed, not approved by the founder. Sandbox values must be visibly test-only. Store effective-dated commercial policy versions and snapshot applied versions on orders.

| ID | Topic | Proposed development default | Production gate |
|---|---|---|---|
| D01 | Geography | Abu Dhabi pilot, UAE only | Confirm cities and participating cafes |
| D02 | Revenue | Commission on merchandise net of merchant-funded discount; sandbox 10% | Sign merchant contracts; confirm basis, rate, VAT and fee allocation |
| D03 | Payment | Provider adapter, fake provider locally; capture before dispatch | Verify UAE marketplace onboarding, split settlement/refunds, Apple Pay and payment methods |
| D04 | Payouts | Sandbox weekly statement | Confirm payout schedule, holds, negative balances and provider responsibilities |
| D05 | Cancellation | Customer request before acceptance; after acceptance support review | Publish policy, merchant obligations, no-show terms |
| D06 | Tax | Sandbox prices tax-inclusive, sample 5% VAT only for eligible mock merchant | Tax advisor validates merchant tax status, invoicing, discount and platform fee treatment |
| D07 | Rewards | Non-cash merchant-specific stamps; sandbox 8 eligible drinks = one reward | Funding, expiry, eligibility, liability and refund policy |
| D08 | Gifts | Disabled; simulate named-item gift entitlement | Provider/legal review, expiry and refund policy |
| D09 | Wallet | Not in scope | Separate legal/provider review before stored-value functionality |
| D10 | SLA | Sandbox accept 120s, prep 10min, 15min slots, branch-configurable capacity | Agree merchant SLA, operating support hours, escalation |
| D11 | Data | Minimize collection, configurable retention, no automated deletion of mandatory records | UAE privacy/legal review, hosting and retention choices |
| D12 | Identity | Email/password or verified phone OTP via configured Supabase provider; admin MFA | Confirm auth channels and SMS vendor |
| D13 | Brand | Neutral working name Coffee Marketplace; cream/espresso design | Approve name, logo, palette, translations |
| D14 | Dine-in | Phase two, signed table QR; no delivery | Confirm branch procedures and fraud controls |
| D15 | Accessibility | WCAG 2.2 AA target | Audit and device testing |
| D16 | Funding | No platform-funded promotions at MVP | Agree campaign budgets and accounting |

Do not enable production financial features until D02–D08 and applicable D11 are approved. Keep a decision log with date, approver, rationale, policy version and migration impact.

## Founder decision log

Entries are the founder's written decisions, in date order. They authorise development and
sandbox testing only unless an entry says otherwise. The table above keeps the original handoff
proposals; where an entry below differs, the entry wins.

| Date (Dubai) | Decision | Covers | Status |
|---|---|---|---|
| 2026-11-28 10:14 | D02-D08 sandbox values: 10% commission on net merchandise value excluding VAT and refunds; no registration, subscription or customer fee; weekly payouts; AED only; tax-inclusive prices; refund rules as written; all configurable and auditable | D02-D08 | Approved for sandbox. Live money still blocked (env check `LIVE_PAYMENTS_ENABLED`) |
| 2026-11-28 10:14 | D03: Tap Payments preferred; keep the sandbox provider | D03 | Approved for sandbox. Commercial terms not agreed |
| 2026-11-28 10:14 | D10: accept 120 s, quote 5 min, reservation 10 min, 15-min slots, invitations 72 h; launch city Abu Dhabi; 14-day pilot with 2-3 cafés | D01, D10 | Approved for sandbox |
| 2026-11-28 10:14 | Phase 9 in scope: stamp cards, promotions, QR dine-in, sandbox gifting. No reloadable wallet | D07, D08, D09, D14 | Approved for sandbox |
| 2026-11-28 10:14 | D13: temporary name "Coffee Marketplace"; centralised branding; English and Arabic with RTL; no BEANZ copying | D13 | Approved |
| 2026-11-28 13:28 | Cost policy: no paid software or services beyond the existing Vercel, ChatGPT and Claude subscriptions; free tiers, open source or own code otherwise; no paid plans, trials, auto-upgrades or recurring commitments without written approval; payment fees and unavoidable regulatory or store costs presented separately | All | Approved, in force |
| 2026-11-28 13:28 | Hosting: Vercel (existing subscription) with Supabase Free, GitHub Free, Resend Free, Expo Free with local builds, Firebase Cloud Messaging. No AWS, Azure or Oracle. Supersedes the earlier D11 hosting evaluation (docs/20) | D11 | Approved. Staging prepared, not deployed |
| 2026-11-28 13:28 | D12 changed: email sign-in for everyone (customers by emailed code; businesses, staff and admins by email and password); admins must use authenticator-app MFA; no SMS provider | D12 | Approved and built |
| 2026-11-28 13:28 | Data residency: do not assume UAE residency is required or unnecessary; fictional data only in staging until privacy review; present UAE-only hosting as a launch blocker if needed | D11 | Open: legal review needed (docs/28) |
| 2026-11-28 13:28 | Files in Supabase Storage (private buckets); evaluate ClamAV; keep the production upload block if scanning is not reliable | D11 | Built; production uploads still blocked (no reliable free scanner) |
| 2026-11-28 13:28 | Sandbox rules: minimum order AED 1; loyalty configurable per café; stamps only after completion; refunds reverse rewards; gifts expire after a configurable 30 days; one discount or reward per order; promotions café-funded and admin-approved | D07, D08, D16 | Approved for sandbox and built |
| 2026-11-28 13:28 | No professional services (security testing, accessibility, translation, legal, tax, hosting consultation) to be arranged or bought | D06, D11, D15 | In force. Internal checks are not a substitute for independent review |
