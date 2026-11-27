# Coffee marketplace — repository instructions
Read README.md, docs/00-decisions.md and docs/01-product-requirements.md first. For each phase read its prompt and linked specifications. This is an original UAE marketplace, not a copy of BEANZ code or branding.

## Non-negotiable instructions
- Inspect existing repository before editing; preserve existing work. Use TypeScript strict mode, pnpm workspace, React Native/Expo, Next.js, NestJS, Prisma/PostgreSQL, Supabase Auth, Redis/BullMQ. Verify compatible stable versions against official docs before pinning. Use one modular backend, not microservices.
- Never invent commercial or legal policy. Unknown decisions are launch blockers; use explicitly labeled sandbox fixtures and feature flags, not live money. No stored-value wallet, gift sales or real payouts until approved.
- Server is authoritative for identity, tenant scope, catalog availability, price, money, state transitions and rewards. Never trust client totals, merchant IDs or role claims supplied in requests. Verify token signature/issuer/audience/expiry; resolve membership in DB.
- Use integer fils, UTC timestamps, branch timezone Asia/Dubai, AED; no floating-point money. Transactional outbox, immutable financial journal, idempotent writes and provider webhooks. Do not store raw payment credentials or card data.
- Never expose secrets in mobile/web bundles, logs, git, screenshots or tests. Do not execute destructive commands, deploy production, enable live payments or send real notifications without explicit approval.
- Build one phase at a time. First state plan and affected files, then implement, migrate locally, test and document. No fake success UI, no placeholder production endpoints, no silent error swallowing. Report actual command outputs and unresolved failures. Do not mark complete until phase gates pass.
- Use accessible English/Arabic interfaces, RTL, meaningful loading/empty/error/offline states. Do not invent production translations; mark for native review.
- Update docs/13-progress.md with phase status, commands, tests, decisions, migration and rollback notes. If specifications conflict, stop affected work, record conflict and request decision; independent work can continue.

## Specification precedence
Approved decision register > explicit functional rules > API/data contracts > visual sketches. Any inconsistency is a blocker for the affected feature, not permission to guess.
