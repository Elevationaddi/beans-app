# REST API contract v1
Base /v1; JSON UTF-8; bearer access token except public discovery/auth callback and signed provider webhook. Auth handled by Supabase SDK; backend validates token and DB membership. Use generated OpenAPI from NestJS DTOs; commit openapi.json and generated clients after phase 2, expand each phase. This document is endpoint design, not a generated OpenAPI file.

## Conventions
Success {data: object|array, meta?: {nextCursor: string|null}}; errors {error:{code:string,message:string,fieldErrors?:object,requestId:string}}. Cursor opaque, default limit 20 max 100. UUID resource IDs, RFC3339 UTC, amounts as decimal strings in fils. Mutations affecting orders/payments/refunds/payouts/claim require Idempotency-Key; same actor+route+key+body returns same outcome; differing body 409. State updates use expectedVersion; stale returns 409 with current version. No client-provided price or merchant scope trusted. 400 malformed, 401 unauthenticated, 403 role denied, 404 absent or out-of-scope, 409 conflict, 422 semantic validation, 429 rate limited, 503 temporary unavailable. Error codes include PRICE_CHANGED, OUT_OF_STOCK, BRANCH_CLOSED, SLOT_FULL, QUOTE_EXPIRED, INVALID_TRANSITION, PAYMENT_PENDING, PAYMENT_FAILED, FEATURE_DISABLED, REFUND_LIMIT, IDEMPOTENCY_CONFLICT.

## Endpoint inventory
Access: P public, C customer, M merchant owner/manager (scoped), T barista scoped, A admin with explicit privilege. Each row specifies request/query → response data; all list routes support cursor/limit. IDs in path are validated UUIDs.

| Method & path | Access | Inputs → output |
|---|---|---|
| GET /me | signed in | none → profile, memberships, roles |
| PATCH /me | signed in | displayName,locale → profile |
| POST /me/privacy-requests | C | kind → ticket id |
| GET /branches | P | q, city, lat?,lng?,mode?,openNow? → branch cards |
| GET /branches/:id | P | none → branch details, hours, modes |
| GET /branches/:id/menu | P | none → categories, products, groups, options, version |
| GET /branches/:id/slots | P | mode,date → eligible times/capacity indication |
| GET /favorites | C | none → merchants |
| PUT /favorites/:merchantId | C | none → saved |
| DELETE /favorites/:merchantId | C | none → removed |
| GET /vehicles | C | none → vehicles |
| POST /vehicles | C | plate,region?,color,model? → vehicle |
| PATCH /vehicles/:id | C | same optional fields → vehicle |
| DELETE /vehicles/:id | C | none → removed |
| GET /cart | C | none → cart and version |
| PUT /cart | C | branchId,expectedVersion?,replaceConfirmed → cart |
| POST /cart/items | C | productId,quantity,optionIds,notes?,expectedVersion → cart |
| PATCH /cart/items/:id | C | quantity,optionIds,notes?,expectedVersion → cart |
| DELETE /cart/items/:id | C | expectedVersion → cart |
| POST /quotes | C | cartId,cartVersion,mode,slotId,vehicleId?,tableToken?,promoCode?,rewardId? → quote |
| POST /checkout | C | quoteId → orderId,payment status,provider client action |
| GET /orders | C | status? → own orders |
| GET /orders/:id | C | none → own order, timeline, refund summary |
| POST /orders/:id/arrival | C | expectedVersion → arrival status |
| POST /orders/:id/cancel-requests | C | reason → cancellation/refund status |
| GET /orders/:id/receipt | C | none → immutable receipt data |
| POST /orders/:id/reorder | C | replaceConfirmed → cart and unavailable items |
| GET /rewards | C | merchantId? → balances/activity (phase 2) |
| POST /gifts/purchases | C | product/terms selection,recipient?,message? → payment action (phase 2; disabled) |
| POST /gifts/claim | C | claimToken → gift (phase 2) |
| GET /gifts | C | direction → gifts (phase 2) |
| GET /notifications | signed in | none → notifications |
| POST /notifications/:id/read | signed in | none → read status |
| POST /devices | signed in | token,platform → registered |
| DELETE /devices/:id | signed in | none → revoked |
| POST /tickets | C/M | orderId?,category,message,attachmentIds? → ticket |
| GET /tickets | C/M/A | status? → scoped tickets |
| GET /tickets/:id | C/M/A | none → ticket, authorized messages |
| POST /tickets/:id/messages | C/M/A | body,visibility (admin only internal) → message |
| POST /merchant/applications | signed in | legalName,brandName,licenseNumber,contact → draft |
| POST /merchant/applications/:id/submit | applicant | documentIds → submitted |
| GET /merchant/dashboard | M | branchId?,from,to → metrics |
| GET/POST /merchant/branches | M | filters / branch data → branches / created branch |
| PATCH /merchant/branches/:id | M | name,address,coordinates,hours,modes,capacity,status → branch |
| PUT /merchant/branches/:id/exceptions/:date | M | closed,intervals → exception |
| GET/POST /merchant/categories | M | filters / name,sort → categories / category |
| PATCH /merchant/categories/:id | M | names,sort,active → category |
| GET/POST /merchant/products | M | filters / categoryId,names,description,priceFils,allergens,groupIds → products/product |
| PATCH /merchant/products/:id | M | editable fields,version → product |
| GET/POST /merchant/modifier-groups | M | filters / names,min,max,options → groups/group |
| PATCH /merchant/modifier-groups/:id | M | group fields/options/version → group |
| PUT /merchant/branches/:id/products/:productId | M | enabled,priceOverrideFils?,stockOnHand? → availability |
| PUT /merchant/branches/:id/options/:optionId | M | enabled,deltaOverrideFils? → availability |
| GET /merchant/orders | M/T | branchId,status → queue |
| GET /merchant/orders/:id | M/T | none → order with operational data only |
| POST /merchant/orders/:id/transition | M/T | action,expectedVersion,etaMinutes?,reason?,pickupCode? → order |
| POST /merchant/orders/:id/ack-arrival | M/T | expectedVersion → arrival |
| GET/POST /merchant/staff | owner | filters / email,role,branchIds → memberships/invite |
| PATCH /merchant/staff/:id | owner | role,branchIds,status → membership |
| GET /merchant/finance | owner | from,to → journal summary |
| GET /merchant/payouts | owner | status → payouts |
| GET /merchant/analytics | M | branchId?,from,to → aggregates |
| POST /uploads | authorized | purpose,mime,size → upload ticket, scoped object key |
| POST /uploads/:id/complete | authorized | none → scanned attachment status |
| GET /admin/dashboard | A | from,to,city → metrics |
| GET /admin/merchants | A ops | status → merchants |
| GET /admin/merchants/:id | A ops | none → application/documents |
| POST /admin/merchants/:id/review | A ops | decision,reason → merchant |
| GET /admin/users | A support/ops | q,status → masked users |
| POST /admin/users/:id/status | A ops | status,reason → user |
| GET /admin/orders | A ops/support | filters → orders |
| GET /admin/orders/:id | A ops/support | none → scoped order timeline |
| POST /admin/orders/:id/cancel | A ops | reason,expectedVersion → order |
| GET /admin/payments | A finance | status,from,to → transactions |
| POST /admin/refunds | A finance_maker | paymentId,amountFils,reason → pending refund |
| POST /admin/refunds/:id/approve | A finance_checker | reason → queued refund |
| GET /admin/reconciliation | A finance | status → exceptions |
| POST /admin/payouts | A finance_maker | merchantId,periodEnd → draft batch |
| POST /admin/payouts/:id/approve | A finance_checker | reason → queued payout |
| PATCH /admin/tickets/:id | A support | status,assigneeId,priority → ticket |
| GET /admin/reports | A scoped | report,from,to → aggregate |
| GET /admin/audit | A security | actorId,targetId,from,to → redacted events |
| GET/POST /admin/policies | A authorized | type / type,config,effectiveAt → versions/draft |
| POST /admin/policies/:id/approve | A authorized checker | reason → effective version |
| POST /webhooks/payments/:provider | signed provider | raw signed body → 2xx after durable receipt |

## Critical DTO examples
POST /quotes request:
```json
{"cartId":"uuid","cartVersion":3,"mode":"curbside","slotId":"uuid","vehicleId":"uuid"}
```
Response data:
```json
{"id":"uuid","expiresAt":"2027-01-01T08:05:00Z","currency":"AED","subtotalFils":"2200","discountFils":"0","taxIncludedFils":"105","feeFils":"0","totalFils":"2200","policyVersion":"sandbox-v1","cartVersion":3}
```
Quote expiry proposed 5 minutes; confirm before launch. Checkout accepts only quoteId, not totals; return pending status and provider action, never raw payment secrets other than provider-authorized client token. After provider confirmation, GET order returns received status and timeline. Transition action enum accept/reject/start/ready/complete; no arbitrary status strings. Reject requires reason, accept ETA 1..120 min, complete requires pickupCode for pickup modes. Use DTO validation and strip/reject unknown fields. Real-time socket event {type:"order.updated",orderId,version,occurredAt}; authorization per subscription, no PII in broadcast, client refetches canonical resource on gap/reconnect. Phase-two campaign, gift redemption, QR and loyalty configuration endpoints require detailed extensions before phase 9/10; never expose stubs in production.
