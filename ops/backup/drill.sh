#!/usr/bin/env bash
# Repeatable backup and restore test (runs in CI on fictional seed data, docs/30).
# Uses a throwaway key pair and a stand-in storage bucket, then checks that:
#   1. backup.sh produces an encrypted file after proving the dump restores,
#   2. restore.sh restores it with matching counts and the stored files,
#   3. a tampered backup is refused.
# Usage: SOURCE_URL=postgresql://beans:beans@localhost:5432/beans_test ops/backup/drill.sh
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"
here="$(cd "$(dirname "$0")" && pwd)"
base="${SOURCE_URL%/*}"
work="$(mktemp -d)"
node "$here/test/mock-storage.mjs" &
mock=$!
trap 'kill $mock 2>/dev/null || true; rm -rf "$work"' EXIT
sleep 1

age-keygen -o "$work/key.txt" 2>/dev/null
recipient="$(age-keygen -y "$work/key.txt")"

SOURCE_URL="$SOURCE_URL" CHECK_URL="$base/drill_restore_check" AGE_RECIPIENT="$recipient" \
  OUT_DIR="$work/out" SUPABASE_URL=http://127.0.0.1:54999 \
  SUPABASE_SERVICE_ROLE_KEY=drill-service-key SUPABASE_STORAGE_BUCKET=drill \
  "$here/backup.sh"
file="$(ls "$work"/out/*.age)"
if gzip -t <"$file" 2>/dev/null || grep -qa "journal_lines" "$file"; then
  echo "FAILED: backup is not encrypted" >&2
  exit 1
fi

AGE_IDENTITY="$work/key.txt" TARGET_URL="$base/drill_restore_target" \
  RESTORE_FILES_DIR="$work/files" "$here/restore.sh" "$file"
[ "$(find "$work/files" -type f | wc -l)" -eq 2 ] || { echo "FAILED: stored files not restored" >&2; exit 1; }

cp "$file" "$work/tampered.age"
printf 'x' | dd of="$work/tampered.age" bs=1 seek=200 conv=notrunc 2>/dev/null
if AGE_IDENTITY="$work/key.txt" TARGET_URL="$base/drill_restore_tampered" \
  "$here/restore.sh" "$work/tampered.age" >/dev/null 2>&1; then
  echo "FAILED: a tampered backup was accepted" >&2
  exit 1
fi
psql "$base/postgres" -q -c 'DROP DATABASE IF EXISTS drill_restore_target' -c 'DROP DATABASE IF EXISTS drill_restore_tampered'
echo "DRILL OK: encrypted backup restored with matching counts and files; tampering refused"
