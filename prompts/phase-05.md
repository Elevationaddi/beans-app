# Phase 05 — Customer discovery

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/02-*.md, docs/07-*.md, docs/09-*.md. Inspect existing files and prior phase evidence.

## Scope
Build guest onboarding, Home, Explore, branch menu, product customizer, favorites and profile. Use actual API, localized states.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
Q01–Q03 and accessibility smoke tests; guest cannot checkout.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
