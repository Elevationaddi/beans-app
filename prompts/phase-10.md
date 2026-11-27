# Phase 10 — Operations and insights

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/03-*.md, docs/04-*.md, docs/07-*.md, docs/10-*.md. Inspect existing files and prior phase evidence.

## Scope
Build tickets and messages, scoped dashboard, analytics, reports, audit viewer, alerts and settings. Campaign features only after phase-two approval.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
Q15,Q16,Q24; aggregate metrics reconcile; exports scoped.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
