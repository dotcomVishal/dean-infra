#!/usr/bin/env bash
# Naming contract for the shared database (Agent/analysis.md 4.1): every table and
# view is prefixed (core_ / mnt_), and no SQL names a database or runs USE.
# Run from infra-backend-v2/. Exits non-zero and prints the offending lines.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
T='users|tickets|reports|attachments|audit_logs|tenders|bills|ticket_messages|financial_limits|user_scopes|user_availability|notifications|deleted_tickets|schema_migrations'
fail=0

# 1. An old unprefixed table name after an SQL keyword.
#    migrate.js is excluded: it looks for the unprefixed legacy table on purpose.
out=$(grep -rnE "\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS|REFERENCES)\s+\`?($T)\b" src scripts test migrations/core migrations/mnt \
        --exclude=migrate.js --exclude=lint-sql-names.sh)
[ -z "$out" ] || { echo "Unprefixed table name in SQL:"; echo "$out"; fail=1; }

# 2. A USE statement, or a table or view created/altered/dropped without a prefix.
out=$(grep -rnP '^\s*USE\s|\b(TABLE|VIEW)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?+`?(?!core_|mnt_)[A-Za-z_]' migrations/core migrations/mnt)
[ -z "$out" ] || { echo "USE statement or unprefixed object in migrations:"; echo "$out"; fail=1; }

# 3. No database name written into SQL.
out=$(grep -rnE "infraseva(_ci)?\.|deanery_infra" src scripts migrations/core migrations/mnt --exclude=lint-sql-names.sh)
[ -z "$out" ] || { echo "Database name in code or SQL:"; echo "$out"; fail=1; }

[ "$fail" = 0 ] && echo "sql names OK"
exit "$fail"
