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
