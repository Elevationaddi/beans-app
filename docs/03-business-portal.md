# Business portal

Sidebar: Dashboard, Branches, Menu, Orders, Staff, Marketing, Finance, Analytics, Support, Settings. Merchant owner sees own merchant; managers limited to assigned branches.

## Global screen behavior
Every screen implements loading, empty, error with retry, unauthorized, stale/offline, and success states as applicable. Disable duplicate submissions; preserve non-sensitive drafts; validate on server. Use accessible labels and localized copy.

## B01 Apply / onboarding
- **Content and actions:** Legal name, trade license, contact, brand, branch, payout onboarding, documents.
- **Rules and transitions:** Draft → submitted → review → approved/rejected; request corrections; secure uploads.
- **Acceptance:** Unapproved merchant cannot publish.

## B02 Dashboard
- **Content and actions:** Orders today, net sales, queue, alerts, branch/date filters.
- **Rules and transitions:** Server-computed scoped aggregates; distinguish pending and settled funds.
- **Acceptance:** Other tenant data never visible.

## B03 Branches
- **Content and actions:** Address, coordinates, hours, holidays, modes, capacity, pause, contact.
- **Rules and transitions:** Timezone, no overlap hours/slots; temporary pause blocks new checkout not active orders.
- **Acceptance:** Paused branch orders remain fulfillable.

## B04 Menu
- **Content and actions:** Categories, products, translations, photos, allergens, modifier groups, base price.
- **Rules and transitions:** Draft/publish; archive not delete referenced rows; validate option min/max.
- **Acceptance:** Past order snapshots unchanged.

## B05 Availability
- **Content and actions:** Branch overrides, sold-out toggles, optional tracked stock.
- **Rules and transitions:** Toggle immediately; stock hold atomic; audit changes.
- **Acceptance:** Concurrent last unit cannot oversell.

## B06 Orders
- **Content and actions:** Queue/history, filters, details, ETA, rejection reason, handoff.
- **Rules and transitions:** Use state machine, not arbitrary status edit; branch scoped.
- **Acceptance:** Duplicate acceptance safe; terminal state immutable.

## B07 Staff
- **Content and actions:** Invite, assign roles/branches, disable, revoke.
- **Rules and transitions:** Owner manages memberships; invitation expires; prohibit privilege escalation.
- **Acceptance:** Revoked staff cannot access next request.

## B08 Marketing (phase 2)
- **Content and actions:** Campaign drafts, dates, eligible items/branches, budget, loyalty rules.
- **Rules and transitions:** Approval, funding and effective dates required; no retroactive rules.
- **Acceptance:** Expired promotion cannot apply.

## B09 Finance
- **Content and actions:** Gross sales, fees, refunds, payable, payouts, statements, CSV.
- **Rules and transitions:** Read immutable journal; bank detail changes via provider verified flow.
- **Acceptance:** Statement reconciles to ledger.

## B10 Analytics
- **Content and actions:** Sales trends, order counts, products, prep times, repeat rates.
- **Rules and transitions:** Aggregate customer data; define denominators; no unnecessary personal data.
- **Acceptance:** Date and branch filters consistent.

## B11 Support
- **Content and actions:** Tickets, order evidence, replies, status.
- **Rules and transitions:** Merchant can reply to scoped case; refunds requested not automatically issued.
- **Acceptance:** No unrelated customer contact access.

## B12 Settings
- **Content and actions:** Brand profile, notification preferences, legal info, integration status.
- **Rules and transitions:** Sensitive changes require review; secret fields masked.
- **Acceptance:** Owner only for legal/payout changes.
