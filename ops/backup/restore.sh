#!/usr/bin/env bash
# Restore an encrypted backup made by backup.sh (docs/30).
#
#   AGE_IDENTITY=~/secure/beans-backup.key \
#   TARGET_URL=postgresql://.../beans_restore_drill \
#   ops/backup/restore.sh staging-20261129T020000Z.tar.gz.age
#
# Checks the SHA-256 next to the file, decrypts, verifies every file against the manifest,
# restores the database into TARGET_URL and runs the integrity checks. TARGET_URL must name a
# database containing "restore" unless CONFIRM_TARGET is set to the exact database name (for a
# real recovery into a new, empty staging database). Stored files are left in RESTORE_FILES_DIR
# for upload; nothing is uploaded automatically.
set -euo pipefail
umask 077

backup="${1:?usage: restore.sh <backup.tar.gz.age>}"
: "${AGE_IDENTITY:?set AGE_IDENTITY to the private key file}"
: "${TARGET_URL:?set TARGET_URL}"
here="$(cd "$(dirname "$0")" && pwd)"
target_db="${TARGET_URL##*/}"
case "$target_db" in
  *restore*) ;;
  *) [ "${CONFIRM_TARGET:-}" = "$target_db" ] || { echo "Refusing: TARGET_URL database must contain 'restore', or set CONFIRM_TARGET=$target_db" >&2; exit 2; } ;;
esac

if [ -f "$backup.sha256" ]; then
  (cd "$(dirname "$backup")" && sha256sum -c --quiet "$(basename "$backup").sha256")
  echo "checksum of encrypted file: OK"
else
  echo "warning: no $backup.sha256 next to the backup; skipping outer checksum" >&2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -d -i "$AGE_IDENTITY" "$backup" | tar -C "$work" -xzf -
dir="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"
(cd "$dir" && sha256sum -c --quiet manifest.sha256)
echo "manifest checksums: OK"
grep -v '^check\.' "$dir/manifest.txt" | sed 's/^/  /'

admin_url="${TARGET_URL%/*}/postgres"
if [ -z "${CONFIRM_TARGET:-}" ]; then
  psql "$admin_url" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$target_db\"" -c "CREATE DATABASE \"$target_db\""
fi
start=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET_URL" "$dir/database.dump" \
  2> >(grep -v 'schema "public" already exists' >&2 || true)
echo "restore took $(( $(date +%s) - start )) s"

expected="$(grep '^check\.' "$dir/manifest.txt" | sed 's/^check\.//; s/=/|/')"
actual="$(psql "$TARGET_URL" -At -v ON_ERROR_STOP=1 -f "$here/checks.sql")"
if [ "$expected" != "$actual" ]; then
  echo "FAILED: restored database does not match the manifest" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  exit 1
fi
if [ -n "${RESTORE_FILES_DIR:-}" ]; then
  mkdir -p "$RESTORE_FILES_DIR"
  cp -R "$dir/files/." "$RESTORE_FILES_DIR/"
  echo "stored files copied to $RESTORE_FILES_DIR"
fi
echo "OK: database restored into $target_db, counts match the backup, journal balances"
