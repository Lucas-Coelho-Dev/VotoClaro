const test = require('node:test');
const assert = require('node:assert/strict');
const { CandidateIdentityVault, IntegrityService } = require('../src/integrity');

const CPF = '12345678901';

function jsonResponse(body, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(text)) : null) },
    text: async () => text,
  };
}

function candidate() {
  return {
    id: '42',
    assets: [{ value: 5000 }],
    assetTotal: 5000,
    finance: {
      totalRevenue: 1000,
      totalExpense: 400,
      balance: 600,
      revenueRecords: 2,
      expenseRecords: 1,
      note: 'Valores publicados pelo TSE.',
    },
  };
}

function config(overrides = {}) {
  return {
    integrityTimeoutMs: 1000,
    integrityRetryCount: 0,
    integrityRetryDelayMs: 1,
    integrityCacheTtlMinutes: 60,
    integrityErrorCacheTtlSeconds: 30,
    integrityMaxResponseBytes: 65536,
    portalTransparenciaToken: '',
    ...overrides,
  };
}

test('cofre mantém CPF somente em memória e não o inclui no estado público', () => {
  const vault = new CandidateIdentityVault();
  vault.replace([{ SQ_CANDIDATO: '42', NR_CPF_CANDIDATO: CPF }]);
  assert.equal(vault.getCpf('42'), CPF);
  assert.equal(vault.size(), 1);
  assert.equal(JSON.stringify(vault.status()).includes(CPF), false);
});

test('TCU é consultado por CPF exato e resposta pública remove o documento', async () => {
  const vault = new CandidateIdentityVault();
  vault.replace([{ SQ_CANDIDATO: '42', NR_CPF_CANDIDATO: CPF }]);
  const service = new IntegrityService(config(), vault, {
    fetchImpl: async (url, options) => {
      assert.equal(JSON.parse(options.body).cpf, '123.456.789-01');
      if (url.endsWith('/responsaveis-contas-irregulares')) {
        return jsonResponse([
          {
            nome: 'PESSOA TESTE', numeroRegistro: '123.456.789-01', numeroProcessoFormatado: '001.002/2020-3',
            dataTransitoEmJulgado: '01/02/2024', uf: 'SP', linkAcompanhamentoProcesso: 'https://conecta-tcu.apps.tcu.gov.br/tvp/1',
          },
          { nome: 'HOMÔNIMO', numeroRegistro: '999.999.999-99', numeroProcessoFormatado: 'OUTRO' },
        ]);
      }
      return jsonResponse([]);
    },
  });
  const data = await service.get(candidate());
  assert.equal(data.publicAccounts.status, 'FOUND');
  assert.equal(data.publicAccounts.records.length, 1);
  assert.equal(data.publicAccounts.records[0].processNumber, '001.002/2020-3');
  assert.equal(JSON.stringify(data).includes(CPF), false);
  assert.equal(JSON.stringify(data).includes('123.456.789-01'), false);
});

test('Portal da Transparência mantém somente sanção com identificador exato e campos permitidos', async () => {
  const vault = new CandidateIdentityVault();
  vault.replace([{ SQ_CANDIDATO: '42', NR_CPF_CANDIDATO: CPF }]);
  const service = new IntegrityService(config({ portalTransparenciaToken: 'segredo' }), vault, {
    fetchImpl: async (url, options) => {
      if (url.includes('certidoes.apps.tcu.gov.br')) return jsonResponse([]);
      assert.equal(options.headers['chave-api-dados'], 'segredo');
      if (url.includes('/ceis?')) {
        return jsonResponse([
          {
            id: 7,
            sancionado: { nome: 'PESSOA TESTE', codigoFormatado: '123.456.789-01' },
            pessoa: { cpfFormatado: '123.456.789-01' },
            tipoSancao: { descricaoPortal: 'PROIBIÇÃO DE CONTRATAR' },
            numeroProcesso: '08000.001/2025-10',
            orgaoSancionador: { nome: 'ÓRGÃO FEDERAL', siglaUf: 'DF' },
          },
          { id: 8, sancionado: { nome: 'HOMÔNIMO', codigoFormatado: '999.999.999-99' } },
        ]);
      }
      return jsonResponse([]);
    },
  });
  const data = await service.get(candidate());
  assert.equal(data.sanctions.status, 'FOUND');
  assert.equal(data.sanctions.records.length, 1);
  assert.equal(data.sanctions.records[0].sanctionType, 'PROIBIÇÃO DE CONTRATAR');
  assert.equal(JSON.stringify(data).includes(CPF), false);
  assert.equal(JSON.stringify(data).includes('123.456.789-01'), false);
});

test('falha externa não derruba valores oficiais já importados do TSE', async () => {
  const vault = new CandidateIdentityVault();
  vault.replace([{ SQ_CANDIDATO: '42', NR_CPF_CANDIDATO: CPF }]);
  const service = new IntegrityService(config(), vault, {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  const data = await service.get(candidate());
  assert.equal(data.status, 'AVAILABLE');
  assert.equal(data.publicAccounts.status, 'UNAVAILABLE');
  assert.equal(data.campaignFinance.status, 'PUBLISHED');
  assert.equal(data.campaignFinance.totalRevenue, 1000);
});
