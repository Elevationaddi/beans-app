# Phase 02 — Data and identity

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/06-*.md, docs/07-*.md, docs/10-*.md. Inspect existing files and prior phase evidence.

## Scope
Create core migrations and seeds; auth token verification, membership guards, admin MFA requirements, audit, idempotency and outbox; generate initial OpenAPI.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
Tenant isolation tests, role revocation, migrations from empty DB, API client generation.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
