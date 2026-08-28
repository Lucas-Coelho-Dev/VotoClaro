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

test('DataJud consulta somente o número CNJ exato publicado pelo TSE', async () => {
  const service = new IntegrityService(config({ datajudApiKey: 'chave-publica' }), new CandidateIdentityVault(), {
    fetchImpl: async (url, options) => {
      assert.match(url, /api_publica_(?:tre-rj|tse)\/_search$/);
      assert.equal(options.headers.Authorization, 'APIKey chave-publica');
      assert.equal(JSON.parse(options.body).query.match.numeroProcesso, '06000001220266000000');
      return jsonResponse({ hits: { hits: [{ _source: {
        numeroProcesso: '06000001220266000000', tribunal: 'TRE-RJ', grau: 'G1',
        classe: { nome: 'Registro de Candidatura' }, movimentos: [{ nome: 'Distribuído', dataHora: '2026-08-10T12:00:00Z' }],
      } }] } });
    },
  });
  const result = await service.queryDatajud({ registrationProcess: '0600000-12.2026.6.00.0000', uf: 'RJ' });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].className, 'Registro de Candidatura');
});

test('Fact Check é marcado como busca secundária e preserva o publicador', async () => {
  const service = new IntegrityService(config({ googleFactCheckApiKey: 'chave-google' }), new CandidateIdentityVault(), {
    fetchImpl: async (url) => {
      assert.match(url, /claims:search\?/);
      assert.match(url, /key=chave-google/);
      return jsonResponse({ claims: [{
        text: 'Uma alegação pública', claimant: 'Pessoa citada',
        claimReview: [{
          publisher: { name: 'Agência de checagem', site: 'checagem.example' },
          title: 'Verificação publicada', textualRating: 'Contexto ausente',
          reviewDate: '2026-08-20T00:00:00Z', url: 'https://checagem.example/verificacao',
        }],
      }] });
    },
  });
  const result = await service.queryFactChecks({ name: 'PESSOA TESTE' });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.source.confidence, 'SECONDARY');
  assert.equal(result.records[0].publisher, 'Agência de checagem');
});
