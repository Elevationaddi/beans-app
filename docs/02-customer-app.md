# Customer mobile application

Bottom tabs: Home, Explore, Orders, Rewards, Profile. Cart contextual; Gifts nested under Rewards. Guests can browse; authenticated customer needed for checkout. All lists paginated; stale data labeled.

## Global screen behavior
Every screen implements loading, empty, error with retry, unauthorized, stale/offline, and success states as applicable. Disable duplicate submissions; preserve non-sensitive drafts; validate on server. Use accessible labels and localized copy.

## C01 Onboarding / login
- **Content and actions:** Language, city, email/phone, verification, consent, login, logout.
- **Rules and transitions:** Validate identity; guest skip; resend rate limited; account recovery; no account enumeration.
- **Acceptance:** Guest browses; unverified user cannot pay.

## C02 Home
- **Content and actions:** Current area, featured shops, reorder, favorite cafes, offers, search.
- **Rules and transitions:** Location permission optional; hide inactive campaigns; reorder revalidates availability and price.
- **Acceptance:** Manual location works; unavailable items flagged.

## C03 Explore
- **Content and actions:** Map/list, distance, search, open now, pickup modes, sort.
- **Rules and transitions:** Search active branches; filter by selected mode; compute distance only with consent; no results reset filters.
- **Acceptance:** Closed branch visible but cannot order ASAP.

## C04 Shop / branch
- **Content and actions:** Hero, hours, branch switch, address, modes, menu categories, allergens, favorites.
- **Rules and transitions:** Select branch before cart; render branch pricing and sold-out; show hours in Dubai time.
- **Acceptance:** Switch with nonempty cart requires confirmation.

## C05 Product detail
- **Content and actions:** Photo, description, base price, modifiers, required groups, quantity, notes, allergens.
- **Rules and transitions:** Enforce min/max choices, quantity limits and compatibility; server recalculates; notes not allergy guarantee.
- **Acceptance:** Required option missing blocks add.

## C06 Cart
- **Content and actions:** Items, quantity, edit/remove, subtotal, promotion, branch, total estimate.
- **Rules and transitions:** One branch only; revalidate on resume; clear expired promo; price changes explicit.
- **Acceptance:** Cannot combine cafes in one order.

## C07 Checkout
- **Content and actions:** Pickup type, ASAP/slot, vehicle selector, instructions, quote, payment, terms.
- **Rules and transitions:** Hold slot and stock on payment attempt; display tax/fees; payment failure offers retry with same key.
- **Acceptance:** No order confirmation before verified payment.

## C08 Active order
- **Content and actions:** Order number, ETA, status timeline, arrival button, pickup code, directions, help.
- **Rules and transitions:** Reconnect fetches latest state; curbside check-in once; show delayed ETA and rejection/refund status.
- **Acceptance:** Customer sees only own order; handoff requires staff.

## C09 History / receipt
- **Content and actions:** Past orders, details, receipt, reorder, refund status, support.
- **Rules and transitions:** Reorder creates new cart; receipt uses immutable snapshots; no old pricing guarantees.
- **Acceptance:** Refunded order labeled and receipt accessible.

## C10 Rewards (phase 2)
- **Content and actions:** Points/stamps, eligible branches, progress, redemption terms, activity.
- **Rules and transitions:** Hide behind flag until funded policy approved; reserve redemption at checkout.
- **Acceptance:** Repeated webhook cannot award twice.

## C11 Gifts (phase 2)
- **Content and actions:** Gift item, recipient, message, price, claim, sent/received, status.
- **Rules and transitions:** Show terms before pay; share secure claim link; no raw token logs.
- **Acceptance:** Single claim and redemption; expired terms explicit.

## C12 Profile
- **Content and actions:** Name, contact, language, saved shops, vehicles, payment methods, privacy, logout.
- **Rules and transitions:** Vehicle plate/color/model optional except curbside; provider token references only; deletion request workflow.
- **Acceptance:** Deleting vehicle does not alter order snapshot.

## C13 Support
- **Content and actions:** FAQ, order selection, category, message, attachments, status.
- **Rules and transitions:** Limit attachments; ticket timeline; no guaranteed refund; notify updates.
- **Acceptance:** Ticket linked to own order only.
