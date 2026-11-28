# Demo data and demo access (cycle 4)

Everything here is **fictional** and for **private staging** only. Emails use the reserved
`example.test` domain, so nothing can reach a real inbox. Payments use the sandbox provider:
no money moves.

## 1. What the demo contains

`pnpm db:demo` (file `apps/api/prisma/demo.ts`) loads five cafés. Each one differs in menu,
branches, hours, prices, customizations, loyalty, promotions, pickup methods and tables.

| Café                     | Branches                          | Hours (Dubai time)                           | Pickup                                          | Menu and options                                                              | Loyalty                                  | Promotions                                                  | Tables (QR)       |
| ------------------------ | --------------------------------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ----------------- |
| Dune Lantern Coffee      | Corniche, Al Maryah               | 07:00–22:00 with a Friday break; 06:30–20:00 | In store, curbside, dine-in at Corniche         | Espresso drinks with size, milk and extra shots; croissant with limited stock | 8 stamps, free espresso drink            | `LANTERN15` 15% (approved); `LANTERNNEW` waiting for review | T1–T3 at Corniche |
| Saltpan Roasters         | Mussafah roastery                 | 06:00–14:00, closed Friday                   | In store                                        | Pour over by origin, beans 250 g with grind choice                            | 6 stamps, minimum AED 15 to redeem       | `SALT5` AED 5 off over AED 30                               | —                 |
| Mangrove Brew Bar        | Eastern Road (curbside only), Yas | 15:00–23:59; 12:00–23:00                     | Curbside; in store at Yas                       | Cold drinks with size, sweetness and up to 3 extras                           | None (shows a café without a stamp card) | `MANGROVE10` 10% up to AED 6                                | —                 |
| Falcon Courtyard Café    | Al Bateen                         | 08:00–23:00 with a Friday break              | In store, dine-in                               | Coffee and breakfast with allergens, gluten-free bread option                 | 10 stamps, 2 per item                    | None                                                        | A1–A3, B1–B3      |
| Pearl Tea & Coffee House | Khalifa City, Al Reem             | 05:00–23:00; 06:00–22:00                     | In store and curbside; in store only at Al Reem | Karak and Arabic coffee with spices, low prices                               | 5 stamps, up to 2 rewards a day          | `PEARL3` AED 3 off                                          | —                 |

There is also **Oasis Bean Kiosk**, an application waiting for a manual licence check. Use it
to try the admin verification flow.

Arabic names are drafts marked `[للمراجعة]` (needs review). Table QR codes are created from
the business portal (Tables screen) or the admin console. They are signed by the server, so
they are not stored in the demo file.

## 2. Orders in every stage

`pnpm --filter @beans/api demo:orders` (file `apps/api/scripts/demo-orders.ts`) places orders
through the real API, as the demo customers, cafés and admins would. It creates:

- completed orders, including one curbside and one using a promo code
- a full refund and a partial refund, each with a maker and a different checker
- an order rejected by the café, and one cancelled by operations
- a declined card
- ready, preparing and accepted orders
- a payment still pending, and a newly received order

Some stages change on their own, as they would in real use:

- A **received** order is cancelled and refunded automatically if no one accepts it within
  120 seconds.
- A **declined** or **pending** payment becomes "payment failed" when the 10-minute hold
  ends.

Run the script just before a demo. If a café is closed at that hour, the script uses another
open café and says so.

Local result, 2026-11-28 (development sign-in, local database): all 13 stages were created.

## 3. Demo accounts

| Role                            | Email                                       | Where they sign in                                 |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Customer                        | `customer.demo@example.test`                | Customer app (web preview or device)               |
| Customer (Arabic)               | `customer-ar.demo@example.test`             | Customer app                                       |
| Café owner (Dune Lantern)       | `owner.demo@example.test`                   | Business portal                                    |
| Branch manager (Dune Lantern)   | `manager.demo@example.test`                 | Business portal                                    |
| Barista (Dune Lantern Corniche) | `barista.demo@example.test`                 | Barista tablet (business portal address `/tablet`) |
| Owners of the other 4 cafés     | `owner2.demo@` … `owner5.demo@example.test` | Business portal                                    |
| Applicant (Oasis Bean Kiosk)    | `applicant.demo@example.test`               | Business portal (application status)               |
| Operations admin                | `ops.demo@example.test`                     | Admin console                                      |
| Finance admin (maker)           | `finance.demo@example.test`                 | Admin console                                      |
| Finance checker                 | `finance-checker.demo@example.test`         | Admin console                                      |
| Support admin                   | `support.demo@example.test`                 | Admin console                                      |
| Marketing admin                 | `marketing.demo@example.test`               | Admin console                                      |
| Super admin                     | `super.demo@example.test`                   | Admin console                                      |

## 4. How demo accounts sign in on staging (restricted method)

There is no sending domain yet, so email codes cannot be delivered. Until one exists:

1. **Public sign-ups are switched off** in the staging Supabase project (Authentication →
   Sign In / Providers → "Allow new users to sign up" off). Nobody can create an account.
2. `pnpm --filter @beans/api demo:provision` (file `apps/api/scripts/provision-demo-accounts.ts`)
   creates a Supabase sign-in for each demo account, with a long random password. For each admin
   it also sets up an authenticator app code.
3. The passwords and authenticator secrets are written **only** to a file on the person's own
   computer, outside the repository, readable only by them. They are never printed, committed,
   or sent in chat.
4. The person gives each tester only the accounts they need, in person or through a password
   manager. Admin testers add the authenticator secret (an `otpauth://` link) to an authenticator
   app.
5. The business portal and admin console already use email and password. The customer app
   shows a "Demo account (private staging)" password form, but only in a staging build
   (`EXPO_PUBLIC_DEMO_PASSWORD_SIGNIN=true`). Production builds never show it, and real customers
   use email codes.

**Development sign-in is never deployed.** Staging runs with `NODE_ENV=production` and
`DEPLOY_ENV=staging`. The API refuses to start if `DEV_AUTH_ENABLED` is on, so the one-tap test
sign-in used on developer machines cannot be reached on staging.

To revoke access: in Supabase → Authentication → Users, delete the user or reset the password,
then run the provisioning script again.

## 5. Loading the demo into staging (order of steps)

1. `pnpm db:migrate` with the staging `DIRECT_URL`.
2. `pnpm db:demo` with the staging `DATABASE_URL`. The base development seed (`pnpm db:seed`)
   is not needed on staging.
3. `pnpm --filter @beans/api demo:provision` with the staging Supabase keys and
   `DEMO_CREDENTIALS` set to a path outside the repository.
4. `DEMO_AUTH=supabase pnpm --filter @beans/api demo:orders` against the staging API address.
