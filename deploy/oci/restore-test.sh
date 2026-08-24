#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PASSWORD_FILE="${PGPASSWORD_FILE:-/run/secrets/postgres_password}"
VERIFY_DATABASE="votoclaro_restore_verify"
LATEST_DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'votoclaro-*.dump' | sort | tail -n 1)"

test -n "$LATEST_DUMP"
export PGPASSWORD="$(tr -d '\r\n' < "$PASSWORD_FILE")"

dropdb --if-exists --force --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" "$VERIFY_DATABASE"
createdb --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" "$VERIFY_DATABASE"
pg_restore --exit-on-error --no-owner --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" --dbname="$VERIFY_DATABASE" "$LATEST_DUMP"
psql --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" --dbname="$VERIFY_DATABASE" --tuples-only --command='SELECT COUNT(*) FROM data_snapshots;' | grep -Eq '[0-9]+'
dropdb --force --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" "$VERIFY_DATABASE"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/latest-restore-test.ok"
echo "Restauração integral verificada com sucesso."
