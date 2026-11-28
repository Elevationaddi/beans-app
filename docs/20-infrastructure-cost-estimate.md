> **Superseded on 2026-11-28.** The founder ruled out paid hosting (AWS, Azure, Oracle and
> others). The approved stack and its costs are in docs/23 (free-tier register) and docs/24
> (monthly costs and unavoidable future expenses). This file is kept only as a record.

# Infrastructure cost estimate (list prices checked 2026-11-28)

**Estimates only. Nothing has been bought, and no account has been created.** Prices are public
on-demand list prices read on 2026-11-28 from each vendor's own price list (AWS Price List API,
Azure Retail Prices API, Oracle's public price-list API, and vendor pricing pages). They exclude
VAT, discounts, credits, reservations and data transfer. Exchange rate: 1 USD = 3.6725 AED.
Lines marked **assumption** were estimated, not read. Re-check every number in the vendor's
calculator before approving a budget; prices and regional availability change.

## Workload assumed

| Part              | Pilot (14 days, 2–3 cafés)               | Year 1                        |
| ----------------- | ---------------------------------------- | ----------------------------- |
| API containers    | 2 × (1 vCPU, 2 GB)                       | Same                          |
| Portal and admin  | 2 × (0.5 vCPU, 1 GB)                     | Same                          |
| PostgreSQL 16     | 2 vCPU, 8 GB, 50 GB storage, single zone | High availability (two zones) |
| Redis             | About 1 GB, one node                     | Two nodes                     |
| Object storage    | 50 GB                                    | 100 GB                        |
| Logs              | About 10 GB a month                      | About 30 GB a month           |
| Phone sign-in SMS | 5,000 one-time codes a month             | Same (grows with customers)   |

A monthly figure is 730 hours. A 14-day pilot costs about 0.46 of a month if everything is
deleted afterwards.

## Hosting options with UAE data residency

| Option                                | UAE region                                 | Pilot / month                   | Year 1 / month   | Year 1 total               |
| ------------------------------------- | ------------------------------------------ | ------------------------------- | ---------------- | -------------------------- |
| AWS Middle East (UAE), `me-central-1` | Yes                                        | $395 (AED 1,450)                | $590 (AED 2,167) | $7,082 (AED 26,009)        |
| Microsoft Azure UAE North (Dubai)     | Yes                                        | $451 (AED 1,658), logs excluded | $699 (AED 2,566) | $8,384 (AED 30,789) + logs |
| Oracle Cloud Dubai / Abu Dhabi        | Yes, service availability **not verified** | $201 (AED 738)                  | $306 (AED 1,122) | $3,667 (AED 13,467)        |
| Google Cloud                          | **No UAE region** (Doha, Dammam, Tel Aviv) | Not priced                      | Not priced       | Not priced                 |

### AWS `me-central-1` (pilot month)

| Item                                               | Unit price                                  | USD/month |
| -------------------------------------------------- | ------------------------------------------- | --------- |
| Fargate, API 2 × (1 vCPU, 2 GB)                    | $0.0526 per vCPU-hour + $0.0058 per GB-hour | 93.73     |
| Fargate, portal and admin                          | Same                                        | 46.87     |
| Application Load Balancer                          | $0.028224/h + $0.00896 per LCU-hour         | 27.14     |
| RDS PostgreSQL db.m7g.large, single zone           | $0.205/h (two zones $0.41/h)                | 149.65    |
| RDS gp3 storage, 50 GB                             | $0.14 per GB-month                          | 7.00      |
| ElastiCache cache.t3.small (Valkey)                | $0.03168/h                                  | 23.13     |
| S3, 50 GB plus requests                            | $0.025 per GB-month                         | ~2.25     |
| CloudWatch Logs, 10 GB                             | $0.63 per GB ingested                       | 6.63      |
| NAT gateway (if containers sit in private subnets) | $0.0528/h plus data                         | 38.54     |
| **Total**                                          |                                             | **~395**  |

### Azure UAE North (pilot month)

| Item                                                   | Unit price                                          | USD/month |
| ------------------------------------------------------ | --------------------------------------------------- | --------- |
| Container Apps, API (always active, after free grants) | $0.000024 per vCPU-second, $0.000003 per GiB-second | 152.28    |
| Container Apps, portal and admin                       | Same                                                | 78.84     |
| HTTPS ingress                                          | Included in Container Apps                          | 0         |
| PostgreSQL Flexible Server D2ds v5                     | $0.217/h                                            | 158.41    |
| Storage, 50 GB (**assumption**: Premium SSD v2 rate)   | $0.138 per GB-month                                 | 6.90      |
| Azure Managed Redis B0                                 | $0.0726/h                                           | 53.00     |
| Blob storage, 50 GB                                    | $0.020275 per GB-month                              | ~2.01     |
| Log Analytics                                          | Not found in the price list read                    | Excluded  |
| **Total**                                              |                                                     | **~451**  |

Azure Cache for Redis (the older product) retires on 2028-09-30; Azure Managed Redis is the
replacement. At low traffic, idle container replicas bill at a lower rate and the API line can
fall to about $46.

### Oracle Cloud (pilot month)

Oracle charges the same price in every region. Before choosing it, confirm that Database with
PostgreSQL, OCI Cache and Container Instances are offered in the Dubai or Abu Dhabi regions; the
research could not confirm this.

| Item                                            | Unit price                                                          | USD/month |
| ----------------------------------------------- | ------------------------------------------------------------------- | --------- |
| Container Instances, API and web                | $0.03 per OCPU-hour + $0.002 per GB-hour (**assumption**: E5 rates) | 96.36     |
| Flexible load balancer, 10 Mbps                 | Within the free allowance                                           | 0         |
| Database with PostgreSQL, 1 OCPU                | $0.098 per OCPU-hour                                                | 71.54     |
| Database storage, 50 GB                         | $0.072 per GB-month                                                 | 3.60      |
| OCI Cache, 2 GB node (**assumption**: smallest) | $0.0194 per GB-hour                                                 | 28.32     |
| Object storage, 50 GB                           | First 10 GB free, then $0.0255 per GB-month                         | 1.02      |
| Logging and egress                              | Within free allowances                                              | 0         |
| **Total**                                       |                                                                     | **~201**  |

## Other services

| Service                                   | Price                                                                           | Year 1               |
| ----------------------------------------- | ------------------------------------------------------------------------------- | -------------------- |
| Supabase Pro + Large compute + 50 GB disk | $25 + $110 compute − $10 credit + disk; about $130/month (AED 478)              | ~$1,563 (AED 5,740)  |
| Twilio SMS to UAE                         | $0.1176 per message; sender ID $225 once + $115/month; 5,000 codes ≈ $703/month | ~$8,661 (AED 31,808) |
| Expo EAS                                  | Free tier (15 + 15 builds a month) or Starter $19/month                         | $0–228               |
| Apple Developer Program                   | $99 a year                                                                      | $99                  |
| Google Play developer account             | $25 once                                                                        | $25                  |

## What this means (decisions for the register)

1. **Phone sign-in SMS costs about as much as all the hosting.** At 5,000 codes a month Twilio is
   about $703 (AED 2,582) a month. Email codes are free to send and could be the default for the
   pilot. Twilio's UAE page says a registered alphanumeric sender ID is mandatory, takes about two
   weeks, and that **new UAE sender ID registrations were on hold** when checked. This could block
   phone sign-in; confirm with Twilio before relying on it.
2. **Hosted Supabase has no Middle East region** (nearest: Mumbai, Frankfurt), and its logs are
   stored in the EU. With hosted Supabase Auth, phone numbers and identities would be stored
   outside the UAE. If UAE residency is required (D11, legal review section 2), the options are to
   relax that for sign-in data or to run the open-source Supabase Auth server in the UAE cloud
   (its cost then falls inside the container and database lines above).
3. **AWS and Azure are close**, and their price lists were the most complete. AWS is the cheaper
   of the two for this workload. Oracle is cheapest on paper but its service availability in the
   UAE regions is unverified.
4. High availability roughly doubles the database line. One- or three-year commitments typically
   cut compute by 30–40%, not included here.

## Pilot budget example (AWS, email codes only, 14 days)

| Item                                | USD      | AED        |
| ----------------------------------- | -------- | ---------- |
| Hosting, about 0.46 of a month      | ~182     | ~667       |
| Supabase Pro (one month minimum)    | ~130     | ~478       |
| Apple and Google developer accounts | 124      | ~456       |
| **Total**                           | **~436** | **~1,601** |

Adding phone sign-in SMS adds the Twilio sender ID ($225 once plus $115 a month) and about
$0.12 per code. Staging runs alongside the pilot and costs roughly the pilot hosting figure again
if kept on all month.

## Not found or not verified

Azure Log Analytics price per GB; Azure Premium SSD v1 rate for PostgreSQL; Oracle service
availability in the UAE regions and the smallest OCI Cache node; Apple's price in AED; Expo's full
overage schedule; whether Twilio's UAE registration hold is still in effect.
