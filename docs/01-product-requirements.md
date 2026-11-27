# Product requirements
## Goal and scope
A multi-merchant coffee marketplace allowing customers to discover a branch, customize a drink, pay and collect without queueing. Merchants maintain branch menus and fulfill orders, administrators operate the marketplace. Four interfaces, three primary user types. No delivery driver app, cash payments, subscriptions, POS integrations or stored-value wallet in MVP.

## Functional requirements
| ID | Capability | Acceptance |
|---|---|---|
| F01 | Discovery | Guests can search active open/closed branches, view menus and filter by mode/location; location denial falls back to city/manual area |
| F02 | Identity | Verified users can order; own data only; merchant onboarding requires approval |
| F03 | Catalog | Branch overrides, product availability and modifier rules visible and authoritative at checkout |
| F04 | Cart | Exactly one branch per cart; explicit confirmation before switching branch |
| F05 | Checkout | Server quote includes fees/tax/discount and expires; no silent repricing; payment verified before merchant fulfillment |
| F06 | Fulfillment | Branch staff accept/reject, prepare, ready and hand over; customer sees live status; exceptions audited |
| F07 | Finance | Reconcile provider payments/refunds; immutable ledger; statements and controlled payouts |
| F08 | Support | Order-linked tickets, scoped evidence and case history |
| F09 | Rewards | Phase two, award once on completed eligible order; reverse on refund; redemption lock |
| F10 | Gifts | Phase two, verified paid entitlement, claim/redeem once, legal approval |
| F11 | QR dine-in | Phase two, branch/table-bound QR and active table validation |
| F12 | Administration | Scoped roles, approvals, order oversight, audit, settings and reports |

## End-to-end story
Guest opens app → chooses location → discovers cafe → selects branch → customizes products → signs in → chooses pickup mode/time → receives quote → confirms payment → provider webhook confirms → order enters branch queue → staff accept and provide ETA → preparing → ready → customer arrives / presents code → staff confirms handover → receipt and ledger posting → optional rewards → order history and support. Rejection/timeouts trigger refund workflow. No payment success inferred from client redirect.

## Nonfunctional targets (proposed)
Availability 99.9% monthly after pilot; p95 read API <500ms excluding external calls; order update visible within 5s under normal connectivity; load test 100 concurrent customers and 20 active tablets initially. RPO 15 minutes and RTO 4 hours subject to hosting plan; validate via restore drill. Track checkout conversion, acceptance time, prep time, on-time handover, refunds, repeat purchase and merchant GMV. Never count failed/refunded orders as completed sales; distinguish gross and net.
