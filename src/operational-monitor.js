function parseDiskUsage(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  const columns = lines.at(-1)?.trim().split(/\s+/) || [];
  const percent = Number.parseInt(columns.find((value) => /^\d+%$/.test(value)) || '', 10);
  return Number.isFinite(percent) ? percent : null;
}

function availabilityState({ httpOk, dataReady, diskPercent, backupAgeHours, diskWarningPercent = 80, backupMaximumAgeHours = 30 }) {
  const alerts = [];
  if (!httpOk) alerts.push('SITE_UNAVAILABLE');
  if (httpOk && !dataReady) alerts.push('OFFICIAL_DATA_NOT_READY');
  if (diskPercent === null) alerts.push('DISK_NOT_MEASURED');
  else if (diskPercent >= diskWarningPercent) alerts.push('DISK_SPACE_LOW');
  if (backupAgeHours === null) alerts.push('BACKUP_NOT_FOUND');
  else if (backupAgeHours > backupMaximumAgeHours) alerts.push('BACKUP_OVERDUE');
  return { status: alerts.length ? 'ALERT' : 'OK', alerts };
}

module.exports = { parseDiskUsage, availabilityState };
