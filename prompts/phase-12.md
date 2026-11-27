# Phase 12 — Release preparation

Read CLAUDE.md, README.md, docs/00-decisions.md, docs/13-progress.md and docs/00-*.md, docs/10-*.md, docs/11-*.md, docs/12-*.md. Inspect existing files and prior phase evidence.

## Scope
Prepare staging release, migrations, operational runbook, monitoring, privacy/app store checklist, pilot plan and rollback. Never deploy or enable live money automatically.

## Execution
1. Identify applicable requirements, affected files, unresolved decisions and dependencies. Do not invent unapproved values.
2. Implement a vertical slice with real persistence and authorization; use explicit sandbox adapters when necessary. Update DTOs, migrations, generated clients and documentation.
3. Add unit/integration/E2E tests for success, failure, authorization and concurrency where relevant. Run actual scripts; fix failures or record blockers.
4. Update progress log with changed files, commands/results, migration/rollback notes and remaining gaps. Do not silently skip tests.

## Completion gate
Explicit owner signoff, approved decisions, pilot and external review evidence; unresolved gates block launch.

Stop at phase boundary and report evidence before moving on. Do not deploy, spend money, or enable production credentials.
