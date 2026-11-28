# Tap Payments: test-mode setup and checks

**Test mode only.** Live payments stay blocked in code (`LIVE_PAYMENTS_ENABLED` is refused and
`sk_live_` keys are refused) until the founder approves decisions D02-D08 in writing and Tap
confirms the commercial terms. No commercial arrangement with Tap has been agreed, and none
should be agreed without the founder's approval.

## Keys: where they go, and where they never go

- Tap gives each account a **publishable** key (`pk_test_…`) and a **secret** key
  (`sk_test_…`). The adapter needs only the secret test key.
- Type the secret key **only** into Vercel (API project → Settings → Environment Variables →
  `TAP_SECRET_KEY`, environment "Preview", marked Sensitive), or into a developer's own
  git-ignored `apps/api/.env` for local runs.
- **Never** paste a key into chat, a GitHub issue or pull request, a document, a screenshot, a
  ticket or an email. Nobody on the project will ask for it. If a key is ever exposed, roll it
  in the Tap dashboard straight away.

## 1. Get a test account and test keys

1. Sign up at Tap's website for a business account. Test mode is available without going live
   and without adding a card.
2. In the Tap dashboard, find the API keys (in Tap's current dashboard: **Accounts → Operators**,
   or "goSell / API credentials" on older accounts). Make sure the dashboard is in **test** mode.
3. Copy the `sk_test_…` key straight into Vercel as above.

## 2. Configure the API

| Variable                | Value                                      |
| ----------------------- | ------------------------------------------ |
| `PAYMENT_PROVIDER`      | `tap`                                      |
| `TAP_SECRET_KEY`        | the test secret key (Vercel only)          |
| `API_PUBLIC_URL`        | the staging API address (https)            |
| `TAP_RETURN_URL`        | the customer web app's return page (https) |
| `LIVE_PAYMENTS_ENABLED` | leave unset                                |

**Webhooks.** The API sends its webhook address with every charge and refund
(`post.url` = `<API_PUBLIC_URL>/v1/webhooks/payments/tap`), so nothing has to be typed into the
Tap dashboard. Tap cannot reach `localhost`: webhook tests need the staging API (or a public
tunnel on a developer machine). Every webhook is checked with Tap's `hashstring` signature in
constant time; anything unsigned or altered is refused, and the API re-reads the charge from Tap
before changing an order.

## 3. Checks to run in test mode

Use the test card numbers from Tap's developer documentation ("Test cards"). Record each result
(order ID, Tap charge ID, outcome) in the staging test log, without card numbers.

| #   | Check                                   | Expected                                                                                      |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| T1  | Successful card payment                 | Customer returns to the app; the order turns paid; journal shows the charge                   |
| T2  | Declined card                           | Order stays unpaid with a clear message; stock and pickup slot are released after the hold    |
| T3  | 3-D Secure challenge                    | Challenge page appears; success and failure behave as T1 and T2                               |
| T4  | Customer closes the payment page        | Order stays pending until the hold expires, then is released by the cron tick                 |
| T5  | Webhook arrives twice                   | Second one changes nothing (idempotent)                                                       |
| T6  | Webhook with a wrong signature          | Refused (401); order unchanged                                                                |
| T7  | Café does not accept within 120 seconds | Order cancelled and fully refunded automatically                                              |
| T8  | Full refund (maker-checker in admin)    | Refund succeeds at Tap; journal reverses the charge; stamps earned are reversed               |
| T9  | Partial refund                          | Refund for the chosen amount; journal and stamps reversed in proportion                       |
| T10 | Commission                              | Platform commission is 10% of net merchandise value excluding VAT and refunds (sandbox value) |
| T11 | Settlement report                       | Finance can export the payout statement; it matches Tap's test settlement view                |
| T12 | Reconciliation                          | Finance runs reconciliation; every Tap charge and refund matches one journal entry            |

## 4. What the code does not do with Tap

- **Split payments to cafés.** The adapter takes payment into one Tap account. Whether Tap's
  marketplace product ("destinations" / split payments) is available to us, at what price and
  with what KYC for each café is **not confirmed** and must be asked of Tap. Until then payouts
  to cafés are recorded statements, not money transfers.
- **Payouts.** Tap settles to the account holder's bank on its own schedule; the platform does
  not send money to cafés.
- **Saved cards, Apple Pay and Google Pay.** Not built.

## 5. Questions to settle with Tap before going live (founder)

1. Marketplace / split payment availability for UAE cafés, fees and onboarding steps per café.
2. Final card fees (published list: local 2.75% + AED 1, GCC 3.5% + AED 1, international
   3.75% + AED 1, plus 5% VAT on fees), refund fees, chargeback fees, and settlement schedule.
3. Reserve or rolling hold requirements, and minimum volumes.
4. Contract term, notice period and any monthly or setup fee (must be zero or approved).
5. Apple Pay and Google Pay availability through Tap for a marketplace, and any extra fees.
6. Where Tap stores and processes payment data (for docs/28).
