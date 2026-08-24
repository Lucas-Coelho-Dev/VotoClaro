require('../src/install-safe-console').installSafeConsole();
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseDiskUsage, availabilityState } = require('../src/operational-monitor');
const { safeErrorMessage } = require('../src/safe-log');

const execFileAsync = promisify(execFile);
const healthUrl = process.env.MONITOR_HEALTH_URL || 'http://app:3000/api/v1/health';
const statusFile = process.env.MONITOR_STATUS_FILE || '/monitor/status.json';
const backupDir = process.env.BACKUP_DIR || '/backups';
const intervalMs = Math.max(60, Number(process.env.MONITOR_INTERVAL_SECONDS) || 300) * 1000;
const diskWarningPercent = Math.min(99, Math.max(50, Number(process.env.MONITOR_DISK_WARNING_PERCENT) || 80));
const backupMaximumAgeHours = Math.max(1, Number(process.env.MONITOR_BACKUP_MAX_AGE_HOURS) || 30);

async function latestBackupAgeHours() {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    const dumps = entries.filter((entry) => entry.isFile() && /^votoclaro-.*\.dump$/.test(entry.name));
    if (!dumps.length) return null;
    const stats = await Promise.all(dumps.map(async (entry) => fs.stat(path.join(backupDir, entry.name))));
    const latest = Math.max(...stats.map((item) => item.mtimeMs));
    return Math.round(((Date.now() - latest) / 3_600_000) * 10) / 10;
  } catch {
    return null;
  }
}

async function diskUsage() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk', backupDir]);
    return parseDiskUsage(stdout);
  } catch {
    return null;
  }
}

async function websiteHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(healthUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    return { httpOk: response.ok, dataReady: Boolean(body.dataReady), status: body.status || null, importedAt: body.importedAt || null };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeStatus(status) {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  const temporary = `${statusFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(status, null, 2), 'utf8');
  await fs.rename(temporary, statusFile);
}

async function check() {
  let website = { httpOk: false, dataReady: false, status: null, importedAt: null };
  let error = null;
  try {
    website = await websiteHealth();
  } catch (caught) {
    error = safeErrorMessage(caught);
  }
  const [diskPercent, backupAgeHours] = await Promise.all([diskUsage(), latestBackupAgeHours()]);
  const state = availabilityState({ website, ...website, diskPercent, backupAgeHours, diskWarningPercent, backupMaximumAgeHours });
  const status = { checkedAt: new Date().toISOString(), ...state, website, diskPercent, backupAgeHours, error };
  await writeStatus(status);
  console.log(JSON.stringify(status));
}

async function start() {
  await check();
  setInterval(() => check().catch((error) => console.error(safeErrorMessage(error))), intervalMs);
}

start().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
