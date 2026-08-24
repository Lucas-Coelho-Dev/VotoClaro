#!/bin/sh
set -eu

INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
RESTORE_INTERVAL_DAYS="${RESTORE_TEST_INTERVAL_DAYS:-7}"

while true; do
  if /opt/votoclaro/backup-now.sh; then
    if [ ! -f /backups/latest-restore-test.ok ] || find /backups/latest-restore-test.ok -mtime "+$RESTORE_INTERVAL_DAYS" -print -quit | grep -q .; then
      /opt/votoclaro/restore-test.sh || echo "ALERTA: o teste de restauração falhou; o banco ativo não foi alterado."
    fi
  else
    echo "ALERTA: o backup diário falhou; a versão anterior foi preservada."
  fi
  sleep "$INTERVAL_SECONDS"
done
