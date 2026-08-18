const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBrazilianDecimal,
  statusGroup,
  normalizeCandidate,
  candidateChanges,
  attachCandidateComplement,
} = require('../src/normalize');

test('converte valores monetários brasileiros sem estimar', () => {
  assert.equal(parseBrazilianDecimal('1.234.567,89'), 1234567.89);
  assert.equal(parseBrazilianDecimal('1000.50'), 1000.5);
  assert.equal(parseBrazilianDecimal('#NULO#'), 0);
});

test('preserva o texto oficial e cria apenas uma categoria visual', () => {
  assert.equal(statusGroup('DEFERIDO'), 'APPROVED');
  assert.equal(statusGroup('INDEFERIDO COM RECURSO'), 'DENIED');
  assert.equal(statusGroup('AGUARDANDO JULGAMENTO'), 'PENDING');
  assert.equal(statusGroup('RENÚNCIA'), 'WITHDRAWN');
});

test('normalização não inclui CPF, e-mail ou título eleitoral', () => {
  const candidate = normalizeCandidate({
    SQ_CANDIDATO: '123',
    ANO_ELEICAO: '2026',
    CD_ELEICAO: '999',
    SG_UE: 'BR',
    SG_UF: 'BR',
    NM_CANDIDATO: 'PESSOA TESTE',
    NM_URNA_CANDIDATO: 'TESTE',
    NR_CANDIDATO: '42',
    DS_CARGO: 'PRESIDENTE',
    SG_PARTIDO: 'ABC',
    DS_SITUACAO_CANDIDATURA: 'DEFERIDO',
    NR_CPF_CANDIDATO: '12345678901',
    NM_EMAIL: 'privado@example.com',
    NR_TITULO_ELEITORAL_CANDIDATO: '999999999',
  });
  const serialized = JSON.stringify(candidate);
  assert.equal(serialized.includes('12345678901'), false);
  assert.equal(serialized.includes('privado@example.com'), false);
  assert.equal(serialized.includes('999999999'), false);
  assert.equal(candidate.tseId, '123');
});

test('detecta alterações de situação entre snapshots', () => {
  const previous = [{ id: '1', ballotName: 'A', status: 'AGUARDANDO', statusDetail: '', party: 'ABC', ballotNumber: 10, office: 'CARGO' }];
  const next = [{ ...previous[0], status: 'DEFERIDO' }];
  const changes = candidateChanges(previous, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, 'status');
  assert.equal(changes[0].currentValue, 'DEFERIDO');
});

test('marcadores técnicos de ausência não viram conteúdo público', () => {
  const candidate = normalizeCandidate({
    SQ_CANDIDATO: '5', NM_CANDIDATO: 'PESSOA', NM_URNA_CANDIDATO: 'PESSOA',
    DS_SITUACAO_CANDIDATURA: '#NE', SG_UE: 'SP', SG_UF: 'SP',
  });
  assert.equal(candidate.status, 'Aguardando publicação');
  assert.equal(candidate.statusGroup, 'PENDING');
});

test('arquivo complementar prevalece para a situação de julgamento', () => {
  const candidate = normalizeCandidate({
    SQ_CANDIDATO: '9', NM_CANDIDATO: 'PESSOA', NM_URNA_CANDIDATO: 'PESSOA',
    DS_SITUACAO_CANDIDATURA: '#NE', SG_UE: 'SP', SG_UF: 'SP',
  });
  attachCandidateComplement([candidate], [{
    SQ_CANDIDATO: '9', DS_SITUACAO_JULGAMENTO: 'AGUARDANDO JULGAMENTO',
    NR_PROCESSO: '06000000020266100000', VR_DESPESA_MAX_CAMPANHA: '1.234,56',
  }]);
  assert.equal(candidate.status, 'AGUARDANDO JULGAMENTO');
  assert.equal(candidate.statusGroup, 'PENDING');
  assert.equal(candidate.registrationProcess, '06000000020266100000');
  assert.equal(candidate.maximumCampaignExpense, 1234.56);
});
