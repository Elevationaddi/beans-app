# Legal review checklists (2026-11-28)

> **This is not legal advice.** These are lists of questions and documents to take to a
> UAE-qualified lawyer and, where relevant, a tax adviser. They were prepared by engineering to
> make that review faster. Nothing here has been reviewed by a lawyer, and no draft policy in this
> repository is approved. Laws and regulator rules change; the counsel must confirm what applies
> at the time of review. Law names are given so counsel can confirm or correct them.

Each list ends with what the product does today, so counsel can check it against the answer.

## 1. Company set-up and licensing

- [ ] Which licence activity covers an online marketplace that takes orders and payments for
      independent cafés (mainland Abu Dhabi DED / ADRA, or a free zone)? Does the licence allow
      e-commerce and commission income?
- [ ] Is the platform the seller of record, or an agent of each café? (This drives VAT, consumer
      liability, refunds and receipts.) The product currently treats the **café as seller** and the
      platform as a marketplace taking a 10% commission (D02).
- [ ] Any Abu Dhabi rules for food-ordering intermediaries (municipality, ADAFSA) that apply to
      pickup-only ordering with no delivery?

## 2. Data protection (UAE PDPL, Federal Decree-Law No. 45 of 2021, and any free-zone regime)

- [ ] Which regime applies (federal PDPL, ADGM or DIFC data protection rules if the company sits
      in one of them)? Are the PDPL executive regulations in force at the time of launch?
- [ ] Lawful basis for each data use: account, ordering, location (optional), marketing,
      analytics.
- [ ] Is data residency in the UAE required, or only preferred? Are transfers allowed to the
      sign-in provider (Supabase) and SMS sender (Twilio) regions? (D11 prefers UAE residency.)
- [ ] Retention periods for orders, receipts, support messages, audit logs and identity data
      (needed to finish deletion jobs; docs/17 O7).
- [ ] Breach notification duties and timelines.
- [ ] Data processing agreements with every processor (hosting, Supabase, Twilio, Tap, email).
- [ ] Rules for marketing messages and consent.
- **Today:** data minimised; no card data stored; location optional; access and deletion
  requests handled through support with a redacted export; retention periods not set.

## 3. Consumer protection and e-commerce

- [ ] Duties under the Consumer Protection Law (Federal Law No. 15 of 2020) and its executive
      regulations, and the e-commerce law (Federal Decree-Law No. 14 of 2023): pre-contract
      information, prices shown including VAT, Arabic-language requirements, receipts, complaints.
- [ ] Refund and cancellation rules for prepared food (the founder's refund rules in the decision
      message of 2026-11-28; counsel to confirm they are lawful and clearly shown).
- [ ] Who handles complaints: café or platform? Required response times?
- [ ] Rules for promotions and discounts (do promotional campaigns need a permit from the Abu Dhabi
      Department of Economic Development?).
- **Today:** prices are tax-inclusive in AED; refunds follow the configured rules; promotions
  need admin approval; receipts are shown in the app.

## 4. Payments (Central Bank of the UAE)

- [ ] Does collecting card payments on behalf of cafés and paying them out weekly (minus
      commission) require a CBUAE licence (for example under the Retail Payment Services and Card
      Schemes Regulation), or is it covered because Tap is the licensed payment provider? Should
      Tap settle directly to each café (split payments) instead?
- [ ] Is a stamp card or a free-drink gift a "stored value" product? (The product has **no wallet
      and no paid gifts**, per D-register; gifts are sandbox-only.)
- [ ] Anti-money-laundering obligations for the platform and KYC for cafés.
- **Today:** hosted Tap payment page, no card data on our servers, payouts are manual and
  disabled in code, live payments refused in code.

## 5. Tax (VAT, Federal Tax Authority)

- [ ] VAT registration threshold and timing for the platform's commission income.
- [ ] Who issues the tax invoice to the customer (café as seller) and to the café (platform
      commission invoice)? Required invoice fields in English and Arabic.
- [ ] VAT treatment of discounts funded by the café and of free stamp rewards.
- [ ] Corporate tax registration.
- **Today:** 5% VAT included in prices and shown on receipts; commission calculated on net
  merchandise value excluding VAT and refunds (D02).

## 6. Brand and intellectual property

- [ ] Clearance search for the final name and logo in the UAE (Ministry of Economy trademark
      register) and app stores. The temporary name "Coffee Marketplace" is descriptive and likely
      hard to protect; the working name "Beans" is close to the existing BEANZ brand.
- [ ] Trademark filings in the relevant classes once the name is chosen.
- [ ] Rights to café logos and menu photos uploaded by merchants (merchant agreement licence).
- [ ] Open-source licences of dependencies (an SBOM can be generated from the lockfile).

## 7. Merchant agreement

- [ ] Commission (10% of net merchandise value), payout schedule (weekly), refunds and
      chargebacks: who bears them?
- [ ] Merchant-funded promotions and stamp rewards (D16: no platform-funded promotions at MVP).
- [ ] Food safety, allergen information and licences: café responsibility.
- [ ] Service levels (acceptance within 120 seconds), suspension and termination.
- [ ] Data sharing between platform and café (customer names on orders only).
- [ ] Liability caps, indemnities, governing law and disputes forum.

## 8. Customer terms, privacy policy and loyalty rules

- [ ] Terms of use (English and Arabic), privacy policy, cookie or tracking notice for the web.
- [ ] Stamp card rules: earning, expiry, reversal on refund, no cash value.
- [ ] Gift rules (only if gifts are approved for production): validity (30 days proposed),
      non-transferable, no cash value.
- [ ] Minimum age, account deletion, governing law.

## 9. App stores

- [ ] Apple App Store Review Guidelines and Google Play policies: physical goods paid outside
      in-app purchase (allowed for food), account deletion in the app, sign in with Apple when
      other social sign-in is offered, privacy labels and data safety form.
- [ ] Developer accounts in the company's name (D-U-N-S number for Apple).

## 10. Food safety and allergens

- [ ] Do Abu Dhabi rules require allergen or calorie information on online menus?
- [ ] Is the platform responsible for anything about food handling for pickup orders?
- **Today:** each product has a list of allergens and a description, entered by the café.
  Calorie information is not captured.

## Documents to give counsel

docs/00-decisions.md, docs/01-product-requirements.md, docs/08-business-logic.md,
docs/10-security.md, docs/17-security-review.md, the founder decisions message of 2026-11-28,
and a data inventory (to be produced from docs/06-database-schema.md).
