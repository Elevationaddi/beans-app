# Backup and recovery on free tiers (cycle 4)

**Scope:** staging (fictional data only). The founder asked for daily backups of staging with
7-day retention, using free tools only and without Supabase Pro. This document covers what is
built, what still needs the founder, and why reliable production backups remain a launch
blocker.

## 1. What is built

| Piece                     | File                             | What it does                                                                                                                                                                               |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup script             | `ops/backup/backup.sh`           | `pg_dump` of the database plus every object in the private storage bucket. The dump is restored into a scratch database and checked **before** it is kept. Then it is encrypted with `age` |
| Restore script            | `ops/backup/restore.sh`          | Checks the SHA-256, decrypts, verifies every file against the manifest, restores into a database and compares the counts. Stored files are copied out for upload                           |
| Integrity checks          | `ops/backup/checks.sql`          | Row counts for key tables and the journal balance (debits minus credits must be 0). Prints counts only, never rows                                                                         |
| Repeatable restore test   | `ops/backup/drill.sh`            | Runs on every CI build on fictional seed data with a throwaway key. Backup, restore, file check, and a tampered backup must be refused                                                     |
| Daily schedule (template) | `ops/backup/backup-workflow.yml` | GitHub Actions workflow for a **separate private repository**. Runs daily at 02:15 Dubai time, can also be run by hand, and keeps each encrypted backup for 7 days                         |

Tools used, all free and open source: PostgreSQL `pg_dump` and `pg_restore`, `age` (file
encryption), `curl`, `jq`, and GitHub Actions on the GitHub Free plan.

## 2. Where backups are kept, and why not in this repository

**The application repository `Elevationaddi/beans-app` is public.** Artifacts of a public
repository can be downloaded by any signed-in GitHub user. Even though backups are encrypted,
they must not be stored there. So the scheduled workflow is a template meant for a second,
**private** repository (for example `beans-backups`), which only the founder can access.

The GitHub Free facts below come from GitHub's billing documentation, read 2026-11-28
([included usage](https://docs.github.com/en/billing/reference/product-usage-included),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)):

| Question       | Answer for a private repository on GitHub Free                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Minutes        | 2,000 Linux minutes a month (shown as USD 12 of included usage). One backup takes about 2–4 minutes, so about 60–120 minutes a month |
| Storage        | 500 MB, shared between Actions artifacts and Packages. Seven fictional staging backups are well under 1 MB in total today            |
| Over the quota | Without a payment method on file, usage is **blocked**, not billed. Do not add a payment method to this account                      |
| Retention      | Set per upload with `retention-days: 7`. GitHub deletes the artifact after 7 days                                                    |
| Access         | Only people with access to the private repository. Keep it to the founder                                                            |
| Security       | Files are encrypted before upload. GitHub only ever holds ciphertext, and the private key never goes to GitHub                       |

**Founder decision needed:** approve a private GitHub repository holding encrypted artifacts
as the staging backup location. The founder asked not to treat artifacts as approved without
checking security, retention and limits, and the checks are above. Until this is approved, the
scheduled workflow is not switched on.

Second copy, off GitHub: once a week, the founder (or someone they authorize) downloads the
newest artifact to an encrypted company device. This gives a copy that survives losing the
GitHub account. It must never go to a personal cloud drive, email or chat.

## 3. Keys

- Create the key pair once, on the founder's own encrypted computer:
  `age-keygen -o beans-backup.key`. It prints the **public** key (`age1…`).
- The **public** key goes into the private repository as the Actions _variable_
  `AGE_RECIPIENT`. It is not secret.
- The **private** key file stays offline: on the encrypted device, plus a printed or USB copy
  in a safe place. It is needed for every restore. **If it is lost, every backup is unreadable.**
- Never commit, paste or send the private key. Nobody on the project will ask for it.
- If the key is ever exposed: create a new pair, replace `AGE_RECIPIENT`, and let the old
  backups expire after 7 days.

## 4. Setting up the daily backup (founder, about 15 minutes, after staging exists)

1. On GitHub, create a new **private** repository, for example `beans-backups`.
2. Copy `ops/backup/backup-workflow.yml` into it as `.github/workflows/backup.yml`.
3. In that repository, open Settings → Secrets and variables → Actions:
   - Add the secrets `STAGING_DATABASE_URL` (the Supabase **session pooler** connection string;
     GitHub runners have no IPv6, so the direct connection does not work), `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET`.
   - Add the variable `AGE_RECIPIENT` (the public key).
4. Open Actions → staging-backup → **Run workflow** to take the first backup by hand. Check
   that the run summary says "Restore check: passed".

## 5. Success and failure logs

- Every run is listed under Actions in the private repository and kept for GitHub's default
  log retention. The run summary shows the encrypted size, the SHA-256, the restore check result
  and the number of files backed up. It never shows rows, file names or secrets.
- When a scheduled run fails, GitHub emails the person who last edited the schedule (default
  notification settings). A failure always means **no** backup was kept for that day, because
  the script stops before encrypting if any check fails.
- Weekly: someone looks at the Actions list and confirms seven green runs.

## 6. Restore

Test restore (monthly, on the founder's device or a developer's machine with PostgreSQL 17 and
`age` installed):

```bash
AGE_IDENTITY=~/secure/beans-backup.key \
TARGET_URL=postgresql://localhost:5432/beans_restore_drill \
RESTORE_FILES_DIR=./restored-files \
ops/backup/restore.sh staging-YYYYMMDDTHHMMSSZ.tar.gz.age
```

Write the date, the backup name, the restore time and "OK" or the error in the staging test log.
Then delete the restored database and the files.

Real recovery of staging:

1. Create a new, empty Supabase Free project (Mumbai), or empty the broken one.
2. Run `restore.sh` with `TARGET_URL` set to the new database and `CONFIRM_TARGET` set to its
   exact database name. The script refuses any other target unless the name contains `restore`.
3. Upload the files in `RESTORE_FILES_DIR` to the private bucket under the same paths.
4. Point the API's `DATABASE_URL` at the new database and redeploy. Then run the staging smoke
   tests (docs/18).

Recovery point: up to 24 hours of changes can be lost. Recovery time: under an hour for
staging-sized data.

## 7. Retention

| Copy                                | Kept for                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| Daily encrypted artifact (GitHub)   | 7 days, deleted automatically                                     |
| Weekly copy on the encrypted device | The newest 4 weekly copies; delete older ones (proposal, founder) |
| Restore drill databases             | Deleted right after the drill                                     |

## 8. Things that are never allowed

- Database exports, customer information, secrets or financial records in any git repository.
  `.gitignore` blocks `*.dump`, `*.age`, `*.sql.gz` and `backups/`, and gitleaks runs on
  every pull request.
- Backups in the public application repository's artifacts.
- Running backups only to keep a free project awake. Supabase Free pauses inactive projects
  after a week. A daily backup reads the database, but it exists to protect data, and staging
  must not depend on it to stay awake (docs/31).

## 9. Production: launch blocker

This setup is good enough for fictional staging. It is **not** a reliable production backup:

- There is no point-in-time recovery, so up to 24 hours of orders and payments could be lost.
- It depends on GitHub Free scheduled runs, which GitHub can delay during busy periods.
- There is one key holder.
- Data would be stored outside the UAE (see docs/28).

Before real customer or financial data exists, the founder must approve one of these:

- Supabase Pro, USD 25 a month, which includes daily managed backups. Point-in-time recovery
  is an add-on at extra cost.
- Another approved paid option.
- Formally accepting the risk in writing.

**This is a launch blocker** (docs/19).
