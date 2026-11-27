# System architecture
```mermaid
flowchart TD
 C[Customer Expo app] --> API[NestJS API]
 M[Merchant Next.js portal] --> API
 T[Barista tablet web] --> API
 A[Admin Next.js console] --> API
 API --> AUTH[Supabase Auth verification]
 API --> CAT[Catalog and pricing]
 API --> ORD[Order state machine]
 API --> FIN[Payments and ledger]
 API --> SUP[Support and reporting]
 CAT --> DB[(PostgreSQL)]
 ORD --> DB
 FIN --> DB
 SUP --> DB
 DB --> OUT[Transactional outbox]
 OUT --> Q[Redis BullMQ workers]
 Q --> PAY[Marketplace payment provider]
 PAY --> WH[Signed webhook endpoint]
 WH --> API
 Q --> N[Push and email]
 Q --> WS[Scoped realtime events]
 WS --> C
 WS --> T
 API --> OBJ[Private object storage]
 C --> MAP[Restricted maps SDK]
```
Use one API and one database initially; queues for durable asynchronous processing, not source of truth. Keep external calls outside DB transactions. Realtime sends invalidation/version events, then clients fetch authorized data.
