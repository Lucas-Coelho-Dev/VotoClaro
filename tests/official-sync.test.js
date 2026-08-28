const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { OfficialDataSync } = require('../src/official-sync');

function financeArchive() {
  const zip = new AdmZip();
  zip.addFile('receitas_candidatos_2026_BRASIL.csv', Buffer.from('SQ_CANDIDATO;VR_RECEITA\r\n1;10,50\r\n', 'latin1'));
  zip.addFile('receitas_candidatos_doador_originario_2026_BRASIL.csv', Buffer.from('SQ_CANDIDATO;VR_RECEITA\r\n1;99,00\r\n', 'latin1'));
  zip.addFile('despesas_contratadas_candidatos_2026_BRASIL.csv', Buffer.from('SQ_CANDIDATO;VR_DESPESA_CONTRATADA\r\n1;7,25\r\n', 'latin1'));
  zip.addFile('despesas_pagas_candidatos_2026_BRASIL.csv', Buffer.from('SQ_CANDIDATO;VR_DESPESA_PAGA\r\n1;5,00\r\n', 'latin1'));
  zip.addFile('receitas_candidatos_2026_RJ.csv', Buffer.from('SQ_CANDIDATO;VR_RECEITA\r\n1;10,50\r\n', 'latin1'));
  return zip.toBuffer();
}

test('separa somente receitas diretas e despesas contratadas do consolidado nacional', () => {
  const synchronizer = new OfficialDataSync({}, {}, {});
  const buffer = financeArchive();
  const revenues = synchronizer.parseZip(buffer, /^receitas_candidatos_2026_BRASIL\.csv$/i);
  const expenses = synchronizer.parseZip(buffer, /^despesas_contratadas_candidatos_2026_BRASIL\.csv$/i);

  assert.equal(revenues.length, 1);
  assert.equal(revenues[0].VR_RECEITA, '10,50');
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].VR_DESPESA_CONTRATADA, '7,25');
});

test('falha de forma explícita quando o arquivo esperado não existe no ZIP', () => {
  const synchronizer = new OfficialDataSync({}, {}, {});
  assert.throws(
    () => synchronizer.parseZip(financeArchive(), /^arquivo_inexistente\.csv$/i),
    /arquivo CSV esperado/i,
  );
});
