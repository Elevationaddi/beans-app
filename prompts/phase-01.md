# Phase 01 — Foundation

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/01-*.md, docs/09-*.md, docs/10-*.md, docs/11-*.md. Inspect existing files and prior phase evidence.

## Scope
Initialize pnpm workspace apps/mobile, apps/merchant, apps/admin, apps/api, packages/contracts, packages/ui, packages/config; tablet route in merchant app; Docker Compose, env validation, CI, lint/types/test scripts; no business features yet.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
All apps build, health endpoint responds, local DB/Redis reachable, no secrets committed.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
