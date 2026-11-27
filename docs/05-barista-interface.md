# Barista tablet

Branch-scoped tablet interface, large touch targets. Tabs: New, Preparing, Ready, Completed, Issues. No access to platform financial settings.

## Global screen behavior
Every screen implements loading, empty, error with retry, unauthorized, stale/offline, and success states as applicable. Disable duplicate submissions; preserve non-sensitive drafts; validate on server. Use accessible labels and localized copy.

## T01 Sign-in / branch
- **Content and actions:** Staff login, branch selection, connectivity indicator.
- **Rules and transitions:** Only assigned active branches; no shared admin account.
- **Acceptance:** Wrong branch denied.

## T02 New orders
- **Content and actions:** Order number, items, modifiers, allergy notes, mode, ETA, accept/reject.
- **Rules and transitions:** Sound/visual alert; acceptance timer; reject reason; server authoritative.
- **Acceptance:** Same order accepted once across tablets.

## T03 Preparing
- **Content and actions:** Item checklist, timer, notes, mark ready.
- **Rules and transitions:** Accepted → preparing → ready; no skip; alert delay.
- **Acceptance:** Optimistic UI reconciles failed action.

## T04 Ready
- **Content and actions:** Pickup code validation, arrival indicator, vehicle snapshot, acknowledge arrival.
- **Rules and transitions:** Curbside arrival acknowledged; verify handoff code; dine-in table if enabled.
- **Acceptance:** No duplicate completion or rewards.

## T05 Completed
- **Content and actions:** Recent orders, timestamps, status, search.
- **Rules and transitions:** Read only; report issue linked to order.
- **Acceptance:** No reopening terminal order.

## T06 Issues / offline
- **Content and actions:** Delayed, rejected, no-show, connection loss, retry, contact manager.
- **Rules and transitions:** Offline cached read only; reconnect refresh; no offline financial/status mutations.
- **Acceptance:** Reconnect does not duplicate order.
