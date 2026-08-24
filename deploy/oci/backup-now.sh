#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
SOURCE_DATA_DIR="${SOURCE_DATA_DIR:-/source-data}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/votoclaro-$STAMP.dump"
SUMMARY_FILE="$BACKUP_DIR/votoclaro-summaries-$STAMP.tar.gz"
PASSWORD_FILE="${PGPASSWORD_FILE:-/run/secrets/postgres_password}"

mkdir -p "$BACKUP_DIR"
export PGPASSWORD="$(tr -d '\r\n' < "$PASSWORD_FILE")"

pg_dump --host="${PGHOST:-db}" --port="${PGPORT:-5432}" --username="${PGUSER:-votoclaro}" --dbname="${PGDATABASE:-votoclaro}" --format=custom --compress=6 --file="$DUMP_FILE.tmp"
mv "$DUMP_FILE.tmp" "$DUMP_FILE"
pg_restore --list "$DUMP_FILE" >/dev/null

if [ -d "$SOURCE_DATA_DIR/government-plan-summaries" ]; then
  tar -czf "$SUMMARY_FILE.tmp" -C "$SOURCE_DATA_DIR" government-plan-summaries
  mv "$SUMMARY_FILE.tmp" "$SUMMARY_FILE"
fi

if [ -f "$SUMMARY_FILE" ]; then
  sha256sum "$DUMP_FILE" "$SUMMARY_FILE" > "$BACKUP_DIR/votoclaro-$STAMP.sha256"
else
  sha256sum "$DUMP_FILE" > "$BACKUP_DIR/votoclaro-$STAMP.sha256"
fi
find "$BACKUP_DIR" -type f -name 'votoclaro-*' -mtime "+$RETENTION_DAYS" -delete
printf '%s\n' "$STAMP" > "$BACKUP_DIR/latest-backup.txt.tmp"
mv "$BACKUP_DIR/latest-backup.txt.tmp" "$BACKUP_DIR/latest-backup.txt"
echo "Backup concluído e arquivo validado: $STAMP"
