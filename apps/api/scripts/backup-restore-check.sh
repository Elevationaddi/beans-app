#!/usr/bin/env bash
# Backup and restore drill (docs/11 Q22). Dumps a database, restores it into a scratch
# database, and checks that row counts and the journal balance match. Never touches the
# source beyond reading it. Usage:
#   SOURCE_URL=postgresql://beans:beans@localhost:5432/beans_test \
#   RESTORE_URL=postgresql://beans:beans@localhost:5432/beans_restore_check \
#   apps/api/scripts/backup-restore-check.sh
set -euo pipefail

: "${SOURCE_URL:?set SOURCE_URL}"
: "${RESTORE_URL:?set RESTORE_URL}"
case "$RESTORE_URL" in
  *restore*) ;;
  *) echo "RESTORE_URL must name a scratch database containing 'restore'" >&2; exit 2 ;;
esac

dump="$(mktemp -d)/backup.dump"
restore_db="${RESTORE_URL##*/}"
admin_url="${RESTORE_URL%/*}/postgres"

start=$(date +%s)
pg_dump --format=custom --no-owner --file "$dump" "$SOURCE_URL"
dumped=$(date +%s)
psql "$admin_url" -q -c "DROP DATABASE IF EXISTS \"$restore_db\"" -c "CREATE DATABASE \"$restore_db\""
pg_restore --no-owner --exit-on-error --dbname "$RESTORE_URL" "$dump"
restored=$(date +%s)

checks="SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'refunds', count(*) FROM refunds
UNION ALL SELECT 'journal_lines', count(*) FROM journal_lines
UNION ALL SELECT 'audit_events', count(*) FROM audit_events
UNION ALL SELECT 'journal_debit_minus_credit', COALESCE(sum(debit_fils - credit_fils), 0) FROM journal_lines
ORDER BY 1"
before=$(psql "$SOURCE_URL" -At -c "$checks")
after=$(psql "$RESTORE_URL" -At -c "$checks")

echo "dump: $((dumped - start)) s, restore: $((restored - dumped)) s, size: $(du -h "$dump" | cut -f1)"
echo "$after" | sed 's/^/  /'
if [ "$before" != "$after" ]; then
  echo "MISMATCH between source and restored database" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
if ! echo "$after" | grep -q '^journal_debit_minus_credit|0$'; then
  echo "Restored journal does not balance" >&2
  exit 1
fi
psql "$admin_url" -q -c "DROP DATABASE \"$restore_db\""
rm -f "$dump"
echo "OK: restored copy matches and the journal balances"
