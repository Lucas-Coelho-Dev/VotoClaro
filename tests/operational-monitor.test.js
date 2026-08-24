const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDiskUsage, availabilityState } = require('../src/operational-monitor');

test('interpreta o percentual de espaço usado sem guardar nomes de arquivos', () => {
  assert.equal(parseDiskUsage('Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda 100 82 18 82% /backups'), 82);
});

test('alerta indisponibilidade, backup vencido e pouco espaço', () => {
  const state = availabilityState({ httpOk: false, dataReady: false, diskPercent: 91, backupAgeHours: 48 });
  assert.equal(state.status, 'ALERT');
  assert.deepEqual(state.alerts, ['SITE_UNAVAILABLE', 'DISK_SPACE_LOW', 'BACKUP_OVERDUE']);
});

test('fica saudável com portal, dados, disco e backup dentro dos limites', () => {
  assert.deepEqual(availabilityState({ httpOk: true, dataReady: true, diskPercent: 52, backupAgeHours: 6 }), { status: 'OK', alerts: [] });
});
