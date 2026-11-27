# Administrator console

Sidebar: Overview, Merchants, Customers, Orders, Finance, Support, Campaigns, Reports, Settings, Audit. MFA required; separate operations, finance, support, marketing and security roles.

## Global screen behavior
Every screen implements loading, empty, error with retry, unauthorized, stale/offline, and success states as applicable. Disable duplicate submissions; preserve non-sensitive drafts; validate on server. Use accessible labels and localized copy.

## A01 Overview
- **Content and actions:** GMV/net sales, active shops, pending approvals, incidents, payout exceptions.
- **Rules and transitions:** Aggregate only; date/city filters; drilldown scoped by privilege.
- **Acceptance:** Metrics reconcile with definitions.

## A02 Merchants
- **Content and actions:** Applications, documents, status, branches, approve/reject/suspend.
- **Rules and transitions:** Review reason mandatory; suspension prevents new checkout; active orders resolved.
- **Acceptance:** Approval auditable; no silent deletion.

## A03 Customers
- **Content and actions:** Search by permitted identifiers, account status, order references, privacy requests.
- **Rules and transitions:** Mask PII by default; support access logged; suspension reason.
- **Acceptance:** No password or raw payment access.

## A04 Orders
- **Content and actions:** Search ID, branch, state, timeline, incident flag.
- **Rules and transitions:** Read events; controlled cancellation/refund commands; never force completed.
- **Acceptance:** Every override records actor and reason.

## A05 Finance
- **Content and actions:** Payments, refunds, journal, settlement batches, reconciliation exceptions.
- **Rules and transitions:** Separate maker/checker for manual refunds and payouts; no self approval.
- **Acceptance:** Mismatched totals block payout.

## A06 Support
- **Content and actions:** Ticket queues, assignment, priority, SLA, conversation, evidence.
- **Rules and transitions:** Escalate finance requests; redact unnecessary information; append-only history.
- **Acceptance:** Customer sees public replies not internal notes.

## A07 Campaigns (phase 2)
- **Content and actions:** Banners, offers, audiences, dates, budget and funding.
- **Rules and transitions:** Preview, approve, publish/unpublish; prevent overlap per policy.
- **Acceptance:** Expired campaigns removed automatically.

## A08 Reports
- **Content and actions:** Orders, merchants, finance and operational metrics, exports.
- **Rules and transitions:** Export async and expiring; log downloads; enforce role.
- **Acceptance:** No unscoped PII export.

## A09 Settings
- **Content and actions:** Feature flags, timeouts, currency, fee rule versions, templates.
- **Rules and transitions:** Effective dates; approval and audit; no retroactive order repricing.
- **Acceptance:** Disabled feature rejected server-side.

## A10 Audit / security
- **Content and actions:** Actor, action, target, reason, timestamp, incident, sessions.
- **Rules and transitions:** Immutable access-controlled audit; MFA; revoke sessions.
- **Acceptance:** Audit cannot be edited by admin.
