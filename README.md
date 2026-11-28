# Specialty coffee marketplace | Developer handoff v1

Repository-ready planning pack for Claude Code. No application source code is included. The original 19-page PDF is included under reference/ as a visual reference. The proposed build targets UAE specialty cafes: customer mobile app, merchant web portal, branch tablet, admin console. Delivery excluded. Pickup and curbside first; QR dine-in, rewards and gifting later.

## Start here

1. Extract this folder into a new or existing project repository (do not overwrite existing files without reviewing diffs).
2. Open the repository in Claude Code. Ask it to read CLAUDE.md, README.md, docs/00-decisions.md and prompts/phase-01.md.
3. Run each phase in order. Commit after tests pass; keep unresolved decisions tracked. Never give the agent live credentials for initial development.
4. Review the decision register before integrating live payments or launching. The API and database contracts are design specifications, not executed migrations or generated clients.

## Index

- docs/00-decisions.md — proposed defaults, production blockers
- docs/01-product-requirements.md — scope and cross-role workflows
- docs/02-customer-app.md — screen contracts
- docs/03-business-portal.md — merchant screens
- docs/04-admin-panel.md — admin controls
- docs/05-barista-interface.md — fulfillment
- docs/06-database-schema.md — relational model
- docs/07-api-specification.md — API contracts
- docs/08-business-logic.md — money, state, loyalty, gifting
- docs/09-design-system.md — UX and localization
- docs/10-security.md — permissions and safeguards
- docs/11-testing-deployment.md — test and release gates
- docs/12-development-roadmap.md — phase order
- docs/13-progress.md — implementation record
- architecture/ — Mermaid diagrams
- prompts/ — 12 implementation instructions

The PDF and public BEANZ features informed scope; internal BEANZ architecture is unknown. This package is an implementation starting point, not a guarantee of a production-ready app. Validate provider capabilities, legal requirements, commercial terms and usability before launch.

## Local development

The MVP API is built (phases 1–8 and 10–11): identity, tenancy, onboarding, catalog, discovery,
cart and checkout, sandbox payments and finance, fulfilment, operations and hardening. Screens
that need sign-in wait on decision D12. Nothing is deployed and no live money is possible.
See docs/13-progress.md for what exists and how it was verified, docs/14-hardening-report.md
for test evidence and docs/15-release-plan.md for the path to staging and a pilot.

| Path                 | What it is                                                  | Local URL                           |
| -------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `apps/api`           | NestJS API (Prisma + PostgreSQL, Redis)                     | http://localhost:3000               |
| `apps/merchant`      | Next.js merchant portal, branch tablet at `/tablet`         | http://localhost:3001               |
| `apps/admin`         | Next.js admin console                                       | http://localhost:3002               |
| `apps/mobile`        | Expo customer app (iOS/Android)                             | `pnpm --filter @beans/mobile start` |
| `packages/contracts` | Shared API schemas and types                                |                                     |
| `packages/ui`        | Design tokens (working palette, brand decision D13 pending) |                                     |
| `packages/config`    | Shared TypeScript presets                                   |                                     |

Requirements: Node 22.13+, pnpm 10 (`corepack enable`), Docker.

```sh
pnpm install                       # also builds packages/contracts and packages/ui
pnpm db:up                         # PostgreSQL 16 + Redis 7 via docker-compose.yml
cp .env.example apps/api/.env
pnpm db:migrate                    # applies prisma/migrations
pnpm db:seed                       # synthetic merchants, branches, menu and staff
pnpm build && pnpm --filter @beans/api start
curl http://localhost:3000/health  # {"status":"ok",...,"checks":{"database":"up"}}
```

Checks: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`
(needs `pnpm db:up`), `pnpm build`, `pnpm --filter @beans/api db:check-migrations`. CI runs all
of them plus a secret scan and dependency audit.

API reference: `packages/contracts/openapi.json` (regenerate with
`pnpm --filter @beans/contracts openapi`). Signing in locally needs a Supabase project; see
"Signing in locally" in docs/13-progress.md.

`GET /health` answers 200 when PostgreSQL and Redis are reachable and 503 otherwise.
`GET /health/live` only confirms the process is running.

The API refuses to start with invalid settings, with the fake payment provider in production,
without a CORS allowlist in production, or with `LIVE_PAYMENTS_ENABLED=true` (blocked until
decisions D02–D08 are approved).
