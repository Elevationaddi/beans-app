# Relational database contract
PostgreSQL/Prisma. UUID primary keys unless noted; created_at/updated_at timestamptz UTC on mutable entities; all monetary amounts bigint integer fils, currency char(3) AED. Serialize bigint amounts as decimal strings in JSON. Required unless marked ?. Use foreign keys, CHECK constraints and unique indexes in SQL migrations where Prisma cannot express them. Never cascade delete financial or order history. Customer and merchant ownership must be checked in transaction; use composite branch/merchant foreign keys where applicable.

## Tables
Notation: FK → table, UQ unique, IX index, ? nullable, jsonb structured validated snapshot. Every tenant-owned table carries merchant_id (or is linked via a mandatory branch/order FK); derive tenant on server.

| Table | Fields beyond id and timestamps | Constraints / indexes |
|---|---|---|
| users | auth_subject text, display_name text?, email text?, phone text?, locale enum(en,ar), status enum(active,suspended,deleted) | UQ auth_subject; IX normalized email/phone |
| merchants | legal_name text, brand_name text, license_number text, status enum(draft,submitted,review,approved,rejected,suspended), provider_account_ref text? | UQ license_number (verify jurisdiction scope) |
| merchant_documents | merchant_id FK, object_key text, type text, review_status text | private bucket, IX merchant_id |
| branches | merchant_id FK, name_en text, name_ar text?, address text, lat decimal?, lng decimal?, timezone text, status enum(draft,active,paused,closed), modes text[], capacity integer | UQ(id,merchant_id), IX merchant/status |
| branch_hours | branch_id FK, weekday int, opens time, closes time | split overnight intervals; nonoverlap |
| branch_exceptions | branch_id FK, local_date date, closed bool, intervals jsonb | UQ branch/date |
| memberships | user_id FK, merchant_id FK, role enum(owner,manager,barista,analyst), status text | UQ user/merchant |
| membership_branches | membership_id FK, branch_id FK | UQ pair; same tenant |
| admin_roles | user_id FK, role enum(super_admin,operations,finance_maker,finance_checker,support,marketing,analyst,security) | UQ pair; prohibit maker/checker on same operation |
| categories | merchant_id FK, name_en text, name_ar text?, sort int, active bool | IX merchant/sort |
| products | merchant_id FK, category_id FK, names/descriptions jsonb, photo_key text?, base_fils bigint, allergens text[], status text, version int | CHECK price>=0; IX merchant/category/status |
| modifier_groups | merchant_id FK, name jsonb, min_count int, max_count int, sort int | CHECK 0<=min<=max |
| modifier_options | group_id FK, name jsonb, delta_fils bigint, active bool | CHECK delta>=0 for MVP |
| product_groups | product_id FK, group_id FK, sort int | UQ pair, tenant consistency |
| branch_products | branch_id FK, product_id FK, enabled bool, price_override_fils bigint?, stock_on_hand int?, stock_reserved int | UQ pair; CHECK nonnegative and reserved<=on_hand when tracked |
| branch_options | branch_id FK, option_id FK, enabled bool, delta_override_fils bigint? | UQ pair |
| vehicles | user_id FK, plate text, plate_region text?, color text, model text? | IX user_id |
| cafe_tables | branch_id FK, label text, token_hash text, active bool | UQ branch/label, UQ token_hash |
| carts | user_id FK, branch_id FK, version int, status enum(active,converted,abandoned) | partial UQ user where active |
| cart_items | cart_id FK, product_id FK, quantity int, options jsonb, notes text? | CHECK quantity 1..20 |
| slots | branch_id FK, starts_at timestamptz, capacity int, reserved int, confirmed int | UQ branch/start; CHECK reserved+confirmed<=capacity |
| quotes | cart_id FK, cart_version int, user_id FK, branch_id FK, totals jsonb, line_snapshot jsonb, fulfillment jsonb, policy_version text, expires_at timestamptz | IX expires_at; immutable |
| reservations | quote_id FK, slot_id FK, state enum(held,committed,released), expires_at timestamptz | UQ quote_id |
| reservation_items | reservation_id FK, branch_product_id FK, quantity int | UQ pair; positive qty |
| orders | user_id FK, branch_id FK, quote_id FK, public_number text, status text, mode enum(in_store,curbside,dine_in), fulfillment_snapshot jsonb, totals jsonb, policy_version text, pickup_code_hash text, eta_at timestamptz?, version int | UQ quote/public_number; IX branch/status/time, user/time |
| order_items | order_id FK, product_id FK, quantity int, snapshot jsonb, total_fils bigint | immutable product/option names/prices/tax allocations |
| order_events | order_id FK, seq int, from_state text?, to_state text, actor_id FK?, reason text?, metadata jsonb | UQ order/seq; append only |
| arrivals | order_id FK, arrived_at timestamptz, acknowledged_at timestamptz?, acknowledged_by FK? | UQ order_id |
| payments | order_id FK, attempt int, provider_ref text?, amount_fils bigint, status text, currency char(3) | UQ order/attempt, UQ provider_ref; partial unique captured payment/order |
| refunds | payment_id FK, requested_by FK, approved_by FK?, amount_fils bigint, reason text, status text, provider_ref text? | UQ provider_ref; total pending+succeeded <= captured in locked tx |
| provider_events | provider text, event_id text, payload_redacted jsonb, state text, attempts int | UQ provider/event_id |
| policies | type text, version text, effective_at timestamptz, configuration jsonb, approved_by FK? | UQ type/version; immutable once effective |
| journal_transactions | source_type text, source_id uuid, event_type text, currency char(3) | UQ source_type/source_id/event_type |
| journal_lines | journal_id FK, account_code text, merchant_id FK?, debit_fils bigint, credit_fils bigint | exactly one positive side; balanced per journal enforced by posting transaction |
| payouts | merchant_id FK, amount_fils bigint, period_start/end timestamptz, status text, provider_ref text?, maker_id FK, checker_id FK? | UQ provider_ref; positive; maker != checker |
| payout_allocations | payout_id FK, journal_line_id FK, amount_fils bigint | UQ pair; no double allocation via locked available balance |
| promotions | merchant_id FK?, terms jsonb, starts_at timestamptz, ends_at timestamptz, budget_fils bigint?, status text | phase 2; version terms |
| reward_events | user_id FK, merchant_id FK, order_id FK?, units int, kind text, source_key text | UQ source_key, append-only; phase 2 |
| reward_holds | user_id FK, quote_id FK, merchant_id FK, units int, status text | UQ quote; phase 2 |
| gifts | purchaser_id FK, recipient_id FK?, payment_ref text, token_hash text, terms_snapshot jsonb, status text, expires_at timestamptz?, redeemed_order_id FK? | UQ token_hash/payment_ref/redeemed_order_id; phase 2 separate gift purchase payment flow |
| favorites | user_id FK, merchant_id FK | UQ pair |
| tickets | user_id FK, order_id FK?, merchant_id FK?, status text, category text, assignee_id FK? | IX status/assignee |
| ticket_messages | ticket_id FK, author_id FK, body text, visibility enum(public,internal), attachment_key text? | append only |
| notifications | user_id FK, type text, payload jsonb, read_at timestamptz?, dedupe_key text | UQ user/dedupe_key |
| device_tokens | user_id FK, token text, platform text, active bool | UQ token; protect token |
| idempotency_keys | actor_scope text, route text, key text, request_hash text, response jsonb?, status text, expires_at timestamptz | UQ actor/route/key |
| outbox | topic text, aggregate_id uuid, dedupe_key text, payload jsonb, state text, attempts int, next_run_at timestamptz | UQ dedupe_key; IX state/next_run_at |
| audit_events | actor_id FK?, action text, target_type text, target_id text, reason text?, before_redacted jsonb?, after_redacted jsonb?, request_id text | append only, IX target/time and actor/time |

## Transaction boundaries
Quote creation snapshots server totals; reservation locks slot and stock rows in deterministic order. Checkout atomically reserves, creates pending order/payment, writes outbox; external payment call outside transaction with stable provider key. Verified payment commits stock/slot and moves order to received. Expiry releases holds only after reconciling payment; late capture triggers refund if capacity cannot be restored safely. On rejection/cancel release confirmed capacity when appropriate; tracked stock restored only according to actual preparation, not blindly. Order transitions lock order, validate expected version, append event and outbox in one transaction. Completion posts ledger and eligible reward event once. Refund request locks payment and outstanding refunds. Journal posting checks debit=credit before commit. Payout locks payable allocations before initiation; on failure release reservation, not historical journal.

## Migration and seed rules
Forward-only migrations with reviewed rollback/restore approach; expand-contract for breaking changes. Seed only synthetic users, two merchants with two branches each, English/Arabic test menu, roles, schedules, stock, sample fee policy. Never seed real credentials. Add foreign-key tests and concurrency tests. Phase-two tables are conceptual and require final contract expansion (especially gift purchase payment and reward funding) before implementation.
