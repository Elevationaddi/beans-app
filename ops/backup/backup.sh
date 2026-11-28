#!/usr/bin/env bash
# Encrypted staging backup: database and stored files (docs/30).
#
# 1. pg_dump of the database (custom format, read-only on the source).
# 2. The dump is restored into a throwaway local database and checked (row counts match the
#    source, journal balances) BEFORE anything is kept.
# 3. Every object in the private storage bucket is downloaded.
# 4. Dump, files and a manifest (sizes, SHA-256, counts) are packed and encrypted with `age`
#    to the public key in AGE_RECIPIENT. Only the holder of the matching private key can read
#    the result. Plain copies are deleted before the script exits.
#
# Required: SOURCE_URL (session pooler URL, IPv4), CHECK_URL (scratch database whose name
# contains "restore"), AGE_RECIPIENT (age1...), OUT_DIR.
# Files: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, or
# BACKUP_FILES=skip to state explicitly that there is no bucket to back up.
# Prints counts, sizes and checksums only. Never prints rows, file names or secrets.
set -euo pipefail
umask 077

: "${SOURCE_URL:?set SOURCE_URL}"
: "${CHECK_URL:?set CHECK_URL}"
: "${AGE_RECIPIENT:?set AGE_RECIPIENT to the backup public key (age1...)}"
: "${OUT_DIR:?set OUT_DIR}"
case "$CHECK_URL" in *restore*) ;; *) echo "CHECK_URL must name a scratch database containing 'restore'" >&2; exit 2 ;; esac
case "$AGE_RECIPIENT" in age1*) ;; *) echo "AGE_RECIPIENT must be an age public key (age1...)" >&2; exit 2 ;; esac

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="staging-$stamp"
mkdir -p "$work/$name/files" "$OUT_DIR"

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

# 1. Dump
log "dumping database"
pg_dump --format=custom --no-owner --no-privileges --file "$work/$name/database.dump" "$SOURCE_URL"
source_checks="$(psql "$SOURCE_URL" -At -v ON_ERROR_STOP=1 -f "$here/checks.sql")"

# 2. Prove the dump restores before keeping it
log "restoring into scratch database for checks"
check_db="${CHECK_URL##*/}"
admin_url="${CHECK_URL%/*}/postgres"
psql "$admin_url" -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$check_db\"" -c "CREATE DATABASE \"$check_db\""
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$CHECK_URL" "$work/$name/database.dump" \
  2> >(grep -v 'schema "public" already exists' >&2 || true)
restored_checks="$(psql "$CHECK_URL" -At -v ON_ERROR_STOP=1 -f "$here/checks.sql")"
psql "$admin_url" -q -c "DROP DATABASE \"$check_db\""
if [ "$source_checks" != "$restored_checks" ]; then
  echo "FAILED: restored copy does not match the source" >&2
  diff <(echo "$source_checks") <(echo "$restored_checks") >&2 || true
  exit 1
fi
if ! grep -q '^journal_debit_minus_credit|0$' <<<"$restored_checks"; then
  echo "FAILED: restored journal does not balance" >&2
  exit 1
fi

# 3. Files
file_count=0
if [ "${BACKUP_FILES:-}" = "skip" ]; then
  log "files: skipped on purpose (BACKUP_FILES=skip)"
  files_mode="skipped"
else
  : "${SUPABASE_URL:?set SUPABASE_URL or BACKUP_FILES=skip}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"
  : "${SUPABASE_STORAGE_BUCKET:?set SUPABASE_STORAGE_BUCKET}"
  files_mode="bucket"
  log "listing storage bucket"
  # Key goes through a header file so it never appears in the process list.
  hdr="$work/auth.hdr"
  printf 'Authorization: Bearer %s\napikey: %s\n' "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" >"$hdr"
  list_prefix() {
    local prefix="$1" offset=0 page
    while :; do
      page="$(curl -fsS -H @"$hdr" -H 'Content-Type: application/json' \
        -d "{\"prefix\":\"$prefix\",\"limit\":1000,\"offset\":$offset}" \
        "$SUPABASE_URL/storage/v1/object/list/$SUPABASE_STORAGE_BUCKET")"
      # Folders have a null id; recurse into them.
      jq -r '.[] | select(.id == null) | .name' <<<"$page" | while read -r dir; do
        [ -n "$dir" ] && list_prefix "${prefix:+$prefix/}$dir"
      done
      jq -r --arg p "$prefix" '.[] | select(.id != null) | (if $p == "" then .name else $p + "/" + .name end)' <<<"$page"
      [ "$(jq length <<<"$page")" -lt 1000 ] && break
      offset=$((offset + 1000))
    done
  }
  list_prefix "" >"$work/objects.txt"
  while IFS= read -r object; do
    [ -z "$object" ] && continue
    mkdir -p "$work/$name/files/$(dirname "$object")"
    curl -fsS -H @"$hdr" -o "$work/$name/files/$object" \
      "$SUPABASE_URL/storage/v1/object/authenticated/$SUPABASE_STORAGE_BUCKET/$object"
    file_count=$((file_count + 1))
  done <"$work/objects.txt"
  rm -f "$hdr"
  log "files downloaded: $file_count"
fi

# 4. Manifest, pack, encrypt
(
  cd "$work/$name"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum >manifest.sha256
)
{
  echo "created_utc=$stamp"
  echo "pg_dump_version=$(pg_dump --version | awk '{print $3}')"
  echo "server_version=$(psql "$SOURCE_URL" -At -c 'SHOW server_version')"
  echo "files_mode=$files_mode"
  echo "file_count=$file_count"
  echo "$restored_checks" | sed 's/|/=/; s/^/check./'
} >"$work/$name/manifest.txt"

tar -C "$work" -cf - "$name" | gzip -9 | age -r "$AGE_RECIPIENT" -o "$OUT_DIR/$name.tar.gz.age"
(cd "$OUT_DIR" && sha256sum "$name.tar.gz.age" >"$name.tar.gz.age.sha256")
size="$(du -h "$OUT_DIR/$name.tar.gz.age" | cut -f1)"
log "OK $name.tar.gz.age ($size), files: $file_count"
echo "$restored_checks" | sed 's/^/  /'
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "name=$name" >>"$GITHUB_OUTPUT"; fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Backup $name"
    echo "- Encrypted size: $size"
    echo "- SHA-256: \`$(cut -d' ' -f1 "$OUT_DIR/$name.tar.gz.age.sha256")\`"
    echo "- Restore check: passed (counts match the source, journal balances)"
    echo "- Files backed up: $file_count ($files_mode)"
  } >>"$GITHUB_STEP_SUMMARY"
fi
