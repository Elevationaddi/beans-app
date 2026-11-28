# Monthly cost breakdown and unavoidable future expenses (cycle 3)

Prices were read from each provider's published pricing on 2026-11-28 (see docs/23 for the
allowances and sources). **Nothing was bought, no plan was changed, no trial was started.**
Exchange rate used: 1 USD = 3.6725 AED. This document replaces the paid-hosting estimate in
docs/20, which is kept only as a record of the options the founder ruled out.

## 1. Monthly running cost under the approved stack

| Item                          | Pilot (14 days, 2-3 cafés) | First months after pilot (up to ~10 cafés) | Class                  |
| ----------------------------- | -------------------------- | ------------------------------------------ | ---------------------- |
| Vercel                        | Existing subscription      | Existing subscription                      | Included               |
| Vercel usage above credit     | USD 0 expected             | USD 0 expected (watch the usage page)      | Usage-based (Pro only) |
| Supabase Free                 | USD 0                      | USD 0 while under the free limits          | Free                   |
| Resend Free                   | USD 0                      | USD 0 up to 100 emails a day               | Free                   |
| GitHub Free                   | USD 0                      | USD 0 up to 2,000 Actions minutes a month  | Free                   |
| Expo Free (local builds)      | USD 0                      | USD 0                                      | Free                   |
| Firebase Cloud Messaging      | USD 0                      | USD 0                                      | Free                   |
| ChatGPT, Claude               | Existing subscriptions     | Existing subscriptions                     | Included               |
| **New monthly subscriptions** | **None**                   | **None**                                   |                        |

The only way the monthly bill can rise without a decision is Vercel usage beyond the included
credit on a Pro plan. Setting Spend Management to pause projects at the limit (docs/25 step 2)
caps that at zero extra, at the price of the sites going offline if the limit is reached.

### When the free limits stop being enough

These are not costs today. They are the points where a paid plan would become the safe choice,
and each one needs the founder's written approval first.

| Trigger                                                              | Likely first limit                | What it would cost (list price)                                       |
| -------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Real customer data in production (backups become essential)          | Supabase Free has no backups      | Supabase Pro, USD 25 a month per organization, includes daily backups |
| More than 100 sign-in emails a day                                   | Resend Free                       | Resend Pro, USD 20 a month for 50,000 emails                          |
| Projects pausing after 7 idle days is unacceptable                   | Supabase Free                     | Supabase Pro                                                          |
| Vercel plan is Hobby (no per-minute cron, non-commercial only)       | Vercel                            | Vercel Pro, USD 20 a month per member                                 |
| Malware scanning for merchant documents (needed to accept real ones) | No free option for commercial use | Not priced; needs a decision (docs/27 L1)                             |

## 2. Costs that are not subscriptions (need approval, presented separately)

| Item                          | Class              | Amount (list price, 2026-11-28)                                                                                                                                                              | When it is needed                                                                  |
| ----------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Card payment fees (Tap, UAE)  | Usage-based        | Local cards 2.75% + AED 1, GCC cards 3.5% + AED 1, international 3.75% + AED 1, plus 5% VAT on fees. Marketplace (split payment) pricing is not published and **must be confirmed with Tap** | Only once live payments are approved                                               |
| Apple Developer Program       | Recurring (yearly) | USD 99 a year (about AED 364)                                                                                                                                                                | Before the iOS app goes to TestFlight testers outside the team or to the App Store |
| Google Play developer account | One-time           | USD 25 (about AED 92)                                                                                                                                                                        | Before the Android app is published                                                |
| Domain name                   | Recurring (yearly) | Depends on the name and registrar; not chosen                                                                                                                                                | Before public launch; also needed for app links and a sending domain for email     |

Example payment fee: a local-card order of AED 30.00 costs 2.75% × 30 + 1 = AED 1.825, plus 5%
VAT on that fee = **AED 1.92** (rounded to the fils in code). At the pilot assumption of 50 orders
a day for 14 days, that is roughly AED 1,340 in fees if every order were paid by local card.
During the sandbox pilot no real money moves, so fees are zero.

## 3. Unavoidable future expenses (before a public launch)

These cannot be avoided by choosing a free service. None has been incurred.

| Expense                                                                          | Why it cannot be avoided                                   | Class                 | Amount                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| Apple Developer Program                                                          | Only way to publish on the App Store                       | Recurring (yearly)    | USD 99 a year                                                 |
| Google Play developer account                                                    | Only way to publish on Google Play                         | One-time              | USD 25                                                        |
| Card payment fees                                                                | Charged by any card processor                              | Usage-based           | See section 2                                                 |
| Domain name                                                                      | App links, email sending domain, trustworthy web addresses | Recurring (yearly)    | Registrar price                                               |
| Trade licence activity for e-commerce / marketplace                              | Regulatory (docs/21 section 1)                             | Recurring (yearly)    | Set by the licensing authority                                |
| Legal review (privacy policy, terms, merchant agreement, data residency)         | Regulatory; we cannot write legal advice (docs/28)         | One-time              | Quoted by counsel                                             |
| Malware scanning for merchant documents, or a different way to verify businesses | Security: unscanned documents must not reach admins        | Recurring or one-time | Not priced (docs/27 L1)                                       |
| Database backups for production                                                  | Reliability: Supabase Free has none                        | Recurring (monthly)   | Supabase Pro USD 25 a month, or the manual drill as a stopgap |
| External penetration test (gate G7, docs/15)                                     | Security sign-off before handling real money               | One-time              | Quoted by the tester                                          |

Professional services were not arranged, as instructed.
