# Data residency, privacy and legal and commercial requirements (cycle 3)

**This is not legal advice.** It records where data would be stored and processed with the
approved stack, and lists what a qualified UAE lawyer must confirm. As the founder instructed,
we do not assume that UAE data residency is either legally required or unnecessary, and no
professional service has been engaged.

**Until counsel has reviewed this document and the founder has approved it, staging holds
fictional data only**: no real customers, merchants, staff, card details or merchant documents.

## 1. Where data is stored and processed

Region facts below come from each provider's published documentation on 2026-11-28; confirm
them in each dashboard when the accounts are created. None of these providers offers a UAE
region on the plans we use.

| Data                                                                                             | Stored                                      | Processed                            | Provider and where it is based                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Customer accounts (email, name), orders, favorites, vehicles, notifications                      | Supabase PostgreSQL, Mumbai (India)         | Vercel functions, Mumbai             | Supabase (US company, on AWS); Vercel (US company) |
| Business and staff accounts, memberships, menus, branches                                        | Supabase PostgreSQL, Mumbai                 | Vercel functions, Mumbai             | Same                                               |
| Financial journal, payments, refunds, payout statements                                          | Supabase PostgreSQL, Mumbai                 | Vercel functions, Mumbai             | Same                                               |
| Sign-in identities, password hashes, MFA secrets, sessions                                       | Supabase Auth, Mumbai                       | Supabase, Mumbai                     | Supabase                                           |
| Sign-in emails (address and one-time code in the email)                                          | Resend's systems (US by default)            | Resend                               | Resend (US company)                                |
| Merchant documents (not collected yet; uploads disabled)                                         | Supabase Storage, Mumbai                    | Vercel function (file check), Mumbai | Supabase                                           |
| Live order signals (order ID, version and time only)                                             | Not stored                                  | Supabase Realtime, Mumbai            | Supabase                                           |
| Card data (later, live payments only)                                                            | Tap only; never touches our systems         | Tap                                  | Tap Payments (to confirm with Tap)                 |
| Push tokens (later)                                                                              | Supabase PostgreSQL, Mumbai                 | Firebase Cloud Messaging (global)    | Google                                             |
| Function and request logs (may contain IP addresses and request IDs, never secrets or card data) | Vercel (short retention), Supabase logs     | Vercel, Supabase                     | Vercel, Supabase                                   |
| Source code, CI logs (fictional data only)                                                       | GitHub (US)                                 | GitHub Actions (US)                  | GitHub (Microsoft)                                 |
| Mobile build metadata                                                                            | Expo (US) if cloud builds are used          | Local builds by default              | Expo                                               |
| Account administration (who our team members are)                                                | Vercel, Supabase, Resend, GitHub dashboards | US and other regions                 | Each provider                                      |

## 2. Backups

- **Supabase Free has no automatic backups.** The documented stopgap is the manual drill
  (`apps/api/scripts/backup-restore-check.sh`): a `pg_dump` taken by an authorized person to an
  encrypted disk, restored into a scratch database and checked (row counts and journal balance).
- Where that copy lives is decided by whoever runs it. It must be an encrypted company device
  in an approved location, never GitHub, chat, email or a personal cloud drive.
- For real customer data, daily managed backups (Supabase Pro, USD 25 a month) are strongly
  recommended; this needs the founder's approval (docs/24).

## 3. Third parties that receive personal data

| Third party  | What they receive                                                 | Why                      | Agreement to review                      |
| ------------ | ----------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| Supabase     | All application data and sign-in data                             | Database, sign-in, files | Supabase Data Processing Addendum (DPA)  |
| Vercel       | Requests passing through, logs                                    | Hosting                  | Vercel DPA                               |
| Resend       | Email addresses, one-time codes, invitation links                 | Sign-in emails           | Resend DPA                               |
| Tap          | Payment details entered on Tap's page, order amount and reference | Card payments            | Tap merchant agreement and privacy terms |
| Google (FCM) | Device push tokens and notification text (later)                  | Push notifications       | Firebase terms and data processing terms |
| GitHub, Expo | No personal data of users (fictional test data only)              | Code, CI, builds         | —                                        |

## 4. Cross-border transfers

With this stack, personal data of UAE users would be stored in **India** (Mumbai) and some of
it processed in the **United States** (email delivery, provider administration and logs).
Counsel must confirm:

1. Which data protection regime applies: the federal PDPL (Federal Decree-Law No. 45 of 2021)
   or a free-zone regime (ADGM or DIFC) depending on where the company is licensed, and any
   sector rules for payments.
2. Whether transfers to India and the United States are allowed and on what basis (adequacy,
   contract clauses, consent), and what the providers' DPAs must contain.
3. Whether any category of data (for example payment, identity or government-issued licence
   documents) must stay in the UAE.

If UAE residency turns out to be required for some data, the approved free stack cannot meet it
(no UAE region), and the founder will need to choose between an approved paid provider and not
collecting that data.

## 5. Retention and deletion

**Retention periods are not set** (decision for the founder with counsel). Today:

| Data                        | What happens now                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer account            | Self-service deletion in the app: name, email and phone cleared; favorites, vehicles and notifications deleted; the sign-in account is deleted from Supabase; refused while an order is open |
| Orders, payments, journal   | Kept, linked to the anonymized account (financial and tax records)                                                                                                                           |
| Audit events                | Kept (security and accountability)                                                                                                                                                           |
| Merchant documents          | Not collected yet                                                                                                                                                                            |
| Expired rate-limit counters | Deleted every minute by the cron tick                                                                                                                                                        |
| Processed outbox events     | Kept; a clean-up rule needs a retention decision                                                                                                                                             |
| Logs at Vercel and Supabase | Provider's own short retention on these plans                                                                                                                                                |

Questions for counsel: how long to keep orders and the financial journal (UAE VAT rules
commonly require tax records for at least five years; confirm), audit events, staff and
merchant records after a café leaves, and logs; and what a deletion request must remove.

## 6. Legal and commercial requirements before real data or money

| #   | Requirement                                                                                                             | Owner            | State             |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------- |
| 1   | Counsel review of this document: applicable regime, transfers, residency, retention                                     | Founder, counsel | Not started       |
| 2   | Privacy policy and customer terms (English and Arabic), including loyalty and gift rules                                | Counsel          | Not started       |
| 3   | Merchant agreement: commission (10% sandbox value), payouts, refunds, data roles                                        | Counsel          | Not started       |
| 4   | Data processing agreements accepted with Supabase, Vercel, Resend (free plans included)                                 | Founder          | Not started       |
| 5   | Trade licence covering an online marketplace / e-commerce activity                                                      | Founder          | Not confirmed     |
| 6   | Tap merchant agreement and marketplace terms (no commitment without founder approval)                                   | Founder          | Not started       |
| 7   | Whether accepting payments on behalf of cafés needs a Central Bank licence or must go through Tap's marketplace product | Counsel          | Not started       |
| 8   | VAT registration and invoicing rules for commission and customer receipts                                               | Tax adviser      | Not started       |
| 9   | Trademark search and filing for the final name (temporary name in use)                                                  | Counsel          | Not started       |
| 10  | App store privacy labels and data safety forms based on this document                                                   | Founder          | After 1-2         |
| 11  | Malware scanning or another approved way to verify merchant documents                                                   | Founder          | Open (docs/27 L1) |
| 12  | Food safety and allergen information responsibilities between platform and cafés                                        | Counsel          | Not started       |

More detailed checklists for counsel are in docs/21.
