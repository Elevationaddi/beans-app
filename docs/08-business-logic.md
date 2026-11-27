# Business logic and financial rules
All examples are test-only until decision register approved. Use integer fils and deterministic rounding half-up for policy-approved allocations; allocate remainder by stable line ID so line totals equal order totals. Server snapshots price, modifiers, tax, fees, policy and fulfillment at checkout.

## Pricing
Line gross = quantity × (branch base + selected modifier deltas). Sum line gross; merchant-funded discount reduces merchandise base; platform-funded discount is disabled in MVP. Customer total = discounted gross + approved customer fee (zero sandbox). For tax-inclusive sandbox at 5%, tax component = round(discounted gross × 5/105); do not add again. Commission sandbox 10% of tax-inclusive discounted merchandise, only as fixture; confirm actual basis/tax and fee allocation. Example AED 22.00, no discount: customer 2200 fils, included tax 105, illustrative commission 220, merchant payable 1980 before processor fees or platform fee tax. Not a legal tax calculation. Finance adapter must represent processor fee, commission VAT and adjustments separately once approved.

## Order state machine
| From | To | Actor / guard |
|---|---|---|
| pending_payment | received | verified captured payment and reservation commit |
| pending_payment | payment_failed | confirmed failure/expiry, reconcile before release |
| received | accepted | assigned staff; valid ETA, before timeout |
| received | rejected | assigned staff, reason; initiate refund |
| received | cancelled | approved pre-accept request or timeout; initiate refund |
| accepted | preparing | assigned staff |
| preparing | ready | assigned staff |
| ready | completed | assigned staff, verified handoff code or authorized table delivery |
| accepted/preparing/ready | cancelled | operations approval, reason, policy; refund separately |

Terminal orders cannot transition. Refund status independent (requested, approved, submitted, succeeded, failed); partial refund doesn't rewrite completed status. Curbside arrival separate event, allowed after acceptance within proposed pickup window; repeat requests return same arrival. Staff acknowledges then hands over; never complete automatically from location. No-show flag and support review; no automatic forfeiture without terms. Timeout worker locks order and checks version before cancel; webhook races reconciled. Customer cancellation after acceptance creates support request, not direct mutation.

## Payments and stock
Provider adapter methods createPayment, fetchPayment, refund, fetchRefund, initiatePayout, fetchPayout, verifyWebhook. Stub sandbox only; no hard-coded success in production. Never send a paid order to staff until verified capture and committed reservation. Pending provider result remains pending; poll with exponential backoff and reconcile webhook. On late capture after expired reservation, atomically restore if possible and still valid, otherwise refund and notify. Never retry charge with new provider key without proving previous attempt failed. Quote changes require explicit customer consent. Hold tracked stock and slot capacity atomically; untracked stock still requires enabled status. On completion stock consumed; release on unprepared cancellation only; prepared waste recorded separately as operational adjustment in later inventory extension.

## Ledger and payout
Use append-only balanced journal with accounts provider_clearing, customer_order_liability, merchant_payable, platform_commission_revenue, refund_liability, processor_fee_expense, payout_clearing and approved tax accounts. Example capture Dr provider_clearing 2200 / Cr customer_order_liability 2200. Completion Dr liability 2200 / Cr merchant_payable 1980 / Cr commission_revenue 220. Full refund before completion Dr liability 2200 / Cr provider_clearing 2200 when provider confirms; post-completion reverse allocated commission/payable on confirmed refund. Example after settlement may create negative merchant balance subject to approved contract. Partial refund allocate discount, tax and commission proportionally by line with deterministic residual; never refund more than captured minus pending/succeeded refunds. Track provider fees separately; do not assume refunded fees. Payout reservation prevents double allocation; provider confirmation posts Dr merchant_payable / Cr provider_clearing, subject to provider flow. Failed payout releases reservation; reconcile before retry. No live payout without maker/checker and matching provider statement. Daily reconciliation compares amount/currency/provider ref/status, alerts mismatches and blocks affected payouts. Actual accounting entries require accountant/provider validation.

## Rewards and gifts (phase two)
Non-cash stamps per eligible completed drink, merchant-specific, configurable versioned terms. Append earn/reverse/redeem events; lock available balance during checkout; release on failure. Negative balance after refund of already redeemed benefit handled by approved policy, no automatic charge. Gift is a paid entitlement, not stored-value wallet; separate purchase/payment/claim/redemption state machine to be finalized before development. Claim token random and hashed, single-use; recipient authenticated; expiry disclosed before purchase and reminders sent only with consent. Refund and unclaimed gift policies and funding must be approved. Disable gift sales until provider/legal review. QR dine-in uses signed opaque table token, active table/branch verification, no trusted client table ID; rotate/revoke compromised codes.
