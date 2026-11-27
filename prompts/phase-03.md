# Phase 03 — Merchant onboarding

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/03-*.md, docs/04-*.md, docs/06-*.md, docs/07-*.md, docs/10-*.md. Inspect existing files and prior phase evidence.

## Scope
Implement application drafts, document quarantine, review, approval/suspension, merchant/branch permissions and admin queue.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
Unapproved merchant cannot publish; review logged; cross-tenant files denied.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
