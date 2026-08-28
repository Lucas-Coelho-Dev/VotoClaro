const { SOURCES } = require('./sources');

const TCU_ENDPOINTS = Object.freeze([
  {
    path: 'responsaveis-contas-irregulares',
    registry: 'CONTAS_IRREGULARES',
    label: 'Contas julgadas irregulares — decisão transitada em julgado',
    explanation: 'O TCU informa que a decisão sobre as contas transitou em julgado.',
  },
  {
    path: 'responsaveis-fins-eleitorais',
    registry: 'POSSIVEL_IMPLICACAO_ELEITORAL',
    label: 'Contas irregulares com possível implicação eleitoral',
    explanation: 'O cadastro do TCU reúne decisões com imputação de débito e trânsito em julgado nos últimos oito anos. O TCU não declara inelegibilidade.',
  },
  {
    path: 'responsaveis-inabilitados',
    registry: 'INABILITACAO',
    label: 'Inabilitação determinada pelo TCU',
    explanation: 'A decisão do TCU impede o exercício de cargo em comissão ou função de confiança pelo período publicado.',
  },
  {
    path: 'responsaveis-inidoneos',
    registry: 'INIDONEIDADE',
    label: 'Inidoneidade para participar de licitações',
    explanation: 'O TCU publica decisão que impede a participação em licitações no período informado.',
  },
]);

const PORTAL_ENDPOINTS = Object.freeze([
  { path: 'ceis', registry: 'CEIS', label: 'CEIS — Empresas e Pessoas Sancionadas', query: 'codigoSancionado' },
  { path: 'cnep', registry: 'CNEP', label: 'CNEP — Empresas Punidas', query: 'codigoSancionado' },
  { path: 'ceaf', registry: 'CEAF', label: 'CEAF — Expulsões da Administração Federal', query: 'cpfSancionado' },
]);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validCpfDigits(value) {
  const normalized = digits(value);
  return normalized.length === 11 && !/^(\d)\1{10}$/.test(normalized);
}

function formatCpf(value) {
  const normalized = digits(value).padStart(11, '0');
  return normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.content)) return payload.content;
  return [];
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstText(...values) {
  const value = values.find((item) => typeof item === 'string' && item.trim());
  return value ? value.trim() : null;
}

class CandidateIdentityVault {
  constructor() {
    this.cpfs = new Map();
    this.replacedAt = null;
  }

  replace(candidateRows = []) {
    const next = new Map();
    for (const row of candidateRows) {
      const candidateId = String(row?.SQ_CANDIDATO || '').trim();
      const cpf = digits(row?.NR_CPF_CANDIDATO);
      if (candidateId && validCpfDigits(cpf)) next.set(candidateId, cpf);
    }
    this.cpfs = next;
    this.replacedAt = new Date().toISOString();
    return next.size;
  }

  getCpf(candidateId) {
    return this.cpfs.get(String(candidateId || '')) || null;
  }

  size() {
    return this.cpfs.size;
  }

  status() {
    return { loaded: this.cpfs.size > 0, candidatesWithIdentifier: this.cpfs.size, replacedAt: this.replacedAt };
  }
}

class IntegrityService {
  constructor(config, identityVault, dependencies = {}) {
    this.config = config;
    this.identityVault = identityVault;
    this.fetchImpl = dependencies.fetchImpl || fetch;
    this.wait = dependencies.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.cache = new Map();
    this.timeoutMs = Number(config.integrityTimeoutMs) || 30000;
    this.retryCount = config.integrityRetryCount === undefined ? 1 : Math.max(0, Number(config.integrityRetryCount) || 0);
    this.retryDelayMs = Number(config.integrityRetryDelayMs) || 500;
    this.cacheTtlMs = (Number(config.integrityCacheTtlMinutes) || 360) * 60 * 1000;
    this.errorCacheTtlMs = (Number(config.integrityErrorCacheTtlSeconds) || 300) * 1000;
    this.maxResponseBytes = Number(config.integrityMaxResponseBytes) || 1024 * 1024;
    this.portalToken = String(config.portalTransparenciaToken || '').trim();
    this.datajudApiKey = String(config.datajudApiKey || '').replace(/^APIKey\s+/i, '').trim();
    this.googleFactCheckApiKey = String(config.googleFactCheckApiKey || '').trim();
    this.factCheckMaxAgeDays = Math.max(1, Number(config.factCheckMaxAgeDays) || 2920);
    this.factCheckPageSize = Math.max(1, Math.min(20, Number(config.factCheckPageSize) || 10));
    this.lastCheckAt = null;
    this.lastState = 'NOT_QUERIED';
  }

  getStatus() {
    return {
      state: this.lastState,
      lastCheckAt: this.lastCheckAt,
      identityVault: this.identityVault.status(),
      tcu: 'ACTIVE',
      portalTransparencia: this.portalToken ? 'ACTIVE' : 'CREDENTIAL_REQUIRED',
      datajud: this.datajudApiKey ? 'ACTIVE' : 'CREDENTIAL_REQUIRED',
      googleFactCheck: this.googleFactCheckApiKey ? 'ACTIVE' : 'CREDENTIAL_REQUIRED',
      matching: 'EXACT_OFFICIAL_IDENTIFIER',
    };
  }

  async requestJson(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'VotoClaro/2.0 (transparencia-eleitoral; fontes-oficiais)',
            ...(options.headers || {}),
          },
        });
        const declaredLength = Number.parseInt(response.headers?.get?.('content-length') || '0', 10);
        if (declaredLength > this.maxResponseBytes) throw new Error('INTEGRITY_RESPONSE_TOO_LARGE');
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) throw new Error('INTEGRITY_RESPONSE_TOO_LARGE');
        if (!response.ok) throw new Error(`INTEGRITY_HTTP_${response.status}`);
        return text ? JSON.parse(text) : [];
      } catch (error) {
        lastError = error;
        const retryable = error?.name === 'AbortError' || /^INTEGRITY_HTTP_(429|5\d\d)$/.test(error?.message || '');
        if (!retryable || attempt >= this.retryCount) break;
        await this.wait(this.retryDelayMs * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async queryTcu(cpf) {
    const results = await Promise.allSettled(TCU_ENDPOINTS.map(async (definition) => {
      const payload = await this.requestJson(`https://certidoes.apps.tcu.gov.br/api/publico/${definition.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: formatCpf(cpf) }),
      });
      return asArray(payload)
        .filter((record) => digits(record?.numeroRegistro) === cpf)
        .map((record) => ({
          registry: definition.registry,
          label: definition.label,
          stage: 'FINAL_DECISION',
          explanation: definition.explanation,
          name: firstText(record.nome),
          processNumber: firstText(record.numeroProcessoFormatado),
          decisionNumber: firstText(record.numeroAcordaoFormatado),
          decisionDate: firstText(record.dataAcordao),
          finalDecisionDate: firstText(record.dataTransitoEmJulgado),
          endDate: firstText(record.dataFinalFinsEleitorais, record.dataFinalSancao),
          municipality: firstText(record.municipio),
          uf: firstText(record.uf),
          officialLinks: [
            safeUrl(record.linkDeliberacoesProcesso),
            safeUrl(record.linkAcompanhamentoProcesso),
          ].filter(Boolean),
        }));
    }));
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const records = fulfilled.flatMap((result) => result.value);
    if (!fulfilled.length) {
      return {
        status: 'UNAVAILABLE', records: [], source: this.tcuSource(),
        message: 'Os serviços do TCU não responderam agora. Nenhuma conclusão substituta foi exibida.',
      };
    }
    if (fulfilled.length < TCU_ENDPOINTS.length) {
      return {
        status: records.length ? 'FOUND' : 'PARTIAL', records, partial: true, source: this.tcuSource(),
        message: records.length
          ? 'Há registros oficiais, mas parte dos cadastros do TCU ficou indisponível nesta consulta.'
          : 'A consulta foi parcial; por isso não é possível afirmar ausência de registros no TCU.',
      };
    }
    return {
      status: records.length ? 'FOUND' : 'NONE_FOUND', records, source: this.tcuSource(),
      message: records.length
        ? `${records.length} registro(s) oficial(is) localizado(s) por correspondência exata.`
        : 'Nenhum registro foi retornado pelos quatro cadastros consultados do TCU. Isso não equivale a certidão de inexistência de irregularidade.',
    };
  }

  tcuSource() {
    return {
      id: SOURCES.tcu.id,
      name: SOURCES.tcu.name,
      authority: SOURCES.tcu.authority,
      url: SOURCES.tcu.url,
      fetchedAt: new Date().toISOString(),
      confidence: 'OFFICIAL',
    };
  }

  portalRecordMatches(row, cpf, registry) {
    const identifiers = registry === 'CEAF'
      ? [row?.punicao?.cpfPunidoFormatado, row?.cpfSancionado, row?.pessoa?.cpfFormatado]
      : [row?.sancionado?.codigoFormatado, row?.pessoa?.cpfFormatado, row?.codigoSancionado];
    return identifiers.some((identifier) => digits(identifier) === cpf);
  }

  sanitizePortalRecord(row, definition) {
    const ceaf = definition.registry === 'CEAF';
    return {
      registry: definition.registry,
      label: definition.label,
      stage: 'ADMINISTRATIVE_SANCTION',
      recordId: row?.id === undefined || row?.id === null ? null : String(row.id),
      name: firstText(row?.sancionado?.nome, row?.punicao?.nomePunido, row?.pessoa?.nome),
      sanctionType: firstText(
        row?.tipoSancao?.descricaoPortal,
        row?.tipoSancao?.descricaoResumida,
        row?.tipoPunicao?.descricao,
        row?.punicao?.tipoPunicao,
      ),
      startDate: firstText(row?.dataInicioSancao, row?.dataPublicacao),
      endDate: firstText(row?.dataFinalSancao),
      publicationDate: firstText(row?.dataPublicacao),
      processNumber: firstText(row?.numeroProcesso, row?.punicao?.processo),
      sanctioningBody: firstText(row?.orgaoSancionador?.nome, row?.orgaoLotacao?.nome, row?.orgaoLotacao),
      uf: firstText(row?.orgaoSancionador?.siglaUf, row?.uf),
      legalBasis: firstText(row?.fundamentacao),
      fineValue: definition.registry === 'CNEP' && Number.isFinite(Number(row?.valorMulta)) ? Number(row.valorMulta) : null,
      publicationUrl: safeUrl(row?.linkPublicacao),
      explanation: ceaf
        ? 'Punição expulsiva publicada no cadastro oficial da Administração Pública Federal.'
        : 'Sanção administrativa publicada no cadastro oficial; consulte o processo e a vigência informados pela fonte.',
    };
  }

  async queryPortal(cpf) {
    const source = {
      id: SOURCES.cgu.id,
      name: SOURCES.cgu.name,
      authority: SOURCES.cgu.authority,
      url: SOURCES.cgu.url,
      fetchedAt: new Date().toISOString(),
      confidence: 'OFFICIAL',
    };
    if (!this.portalToken) {
      return {
        status: 'DISABLED', records: [], source,
        message: 'A chave gratuita da API do Portal da Transparência ainda não foi configurada neste ambiente.',
      };
    }
    const results = await Promise.allSettled(PORTAL_ENDPOINTS.map(async (definition) => {
      const parameters = new URLSearchParams({ [definition.query]: cpf, pagina: '1' });
      const payload = await this.requestJson(`https://api.portaldatransparencia.gov.br/api-de-dados/${definition.path}?${parameters}`, {
        headers: { 'chave-api-dados': this.portalToken },
      });
      return asArray(payload)
        .filter((row) => this.portalRecordMatches(row, cpf, definition.registry))
        .map((row) => this.sanitizePortalRecord(row, definition));
    }));
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const records = fulfilled.flatMap((result) => result.value);
    if (!fulfilled.length) {
      return {
        status: 'UNAVAILABLE', records: [], source,
        message: 'A API do Portal da Transparência não respondeu agora. Nenhuma conclusão substituta foi exibida.',
      };
    }
    if (fulfilled.length < PORTAL_ENDPOINTS.length) {
      return {
        status: records.length ? 'FOUND' : 'PARTIAL', records, partial: true, source,
        message: records.length
          ? 'Há sanção publicada, mas parte dos cadastros ficou indisponível nesta consulta.'
          : 'A consulta foi parcial; não é possível afirmar ausência de sanções administrativas.',
      };
    }
    return {
      status: records.length ? 'FOUND' : 'NONE_FOUND', records, source,
      message: records.length
        ? `${records.length} sanção(ões) administrativa(s) localizada(s) por correspondência exata.`
        : 'Nenhum registro foi retornado em CEIS, CNEP ou CEAF. Isso não equivale a certidão de inexistência de irregularidade.',
    };
  }

  datajudSource() {
    return {
      id: SOURCES.cnj.id,
      name: SOURCES.cnj.name,
      authority: SOURCES.cnj.authority,
      url: SOURCES.cnj.url,
      fetchedAt: new Date().toISOString(),
      confidence: 'OFFICIAL',
    };
  }

  datajudAliases(candidate) {
    const uf = String(candidate?.uf || '').toLowerCase();
    if (/^[a-z]{2}$/.test(uf)) return [`api_publica_tre-${uf}`, 'api_publica_tse'];
    return ['api_publica_tse'];
  }

  sanitizeDatajudHit(hit, expectedProcess) {
    const source = hit?._source || {};
    const processNumber = digits(source.numeroProcesso);
    if (processNumber !== expectedProcess) return null;
    const movements = Array.isArray(source.movimentos) ? source.movimentos : [];
    const lastMovement = [...movements]
      .sort((left, right) => String(right?.dataHora || '').localeCompare(String(left?.dataHora || '')))[0];
    return {
      processNumber,
      court: firstText(source.tribunal),
      degree: firstText(source.grau),
      filingDate: firstText(source.dataAjuizamento),
      className: firstText(source.classe?.nome),
      judgingBody: firstText(source.orgaoJulgador?.nome),
      subjects: (Array.isArray(source.assuntos) ? source.assuntos : [])
        .map((subject) => firstText(subject?.nome))
        .filter(Boolean)
        .slice(0, 10),
      lastMovement: lastMovement ? {
        date: firstText(lastMovement.dataHora),
        name: firstText(lastMovement.nome),
      } : null,
      stage: 'ELECTORAL_REGISTRATION_PROCESS',
      explanation: 'Metadados do processo de registro eleitoral cujo número foi publicado pelo TSE. Este resultado não representa pesquisa do histórico judicial pessoal da candidatura.',
    };
  }

  async queryDatajud(candidate) {
    const source = this.datajudSource();
    const processNumber = digits(candidate?.registrationProcess);
    if (processNumber.length !== 20) {
      return {
        status: 'NOT_APPLICABLE', records: [], source,
        message: 'O TSE não publicou um número CNJ válido de processo de registro para esta candidatura.',
      };
    }
    if (!this.datajudApiKey) {
      return {
        status: 'DISABLED', records: [], source,
        message: 'A chave pública vigente do DataJud ainda não foi configurada no servidor.',
      };
    }
    const body = JSON.stringify({
      size: 5,
      _source: ['numeroProcesso', 'tribunal', 'grau', 'dataAjuizamento', 'classe', 'orgaoJulgador', 'assuntos', 'movimentos'],
      query: { match: { numeroProcesso: processNumber } },
    });
    const results = await Promise.allSettled(this.datajudAliases(candidate).map(async (alias) => {
      const payload = await this.requestJson(`https://api-publica.datajud.cnj.jus.br/${alias}/_search`, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.datajudApiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      return (Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [])
        .map((hit) => this.sanitizeDatajudHit(hit, processNumber))
        .filter(Boolean);
    }));
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const records = [...new Map(
      fulfilled.flatMap((result) => result.value).map((record) => [`${record.court}|${record.degree}|${record.processNumber}`, record]),
    ).values()];
    if (!fulfilled.length) {
      return {
        status: 'UNAVAILABLE', records: [], source,
        message: 'O DataJud não respondeu agora. Nenhuma associação substituta foi feita por nome.',
      };
    }
    return {
      status: records.length ? 'FOUND' : (fulfilled.length < this.datajudAliases(candidate).length ? 'PARTIAL' : 'NONE_FOUND'),
      records,
      partial: fulfilled.length < this.datajudAliases(candidate).length,
      source,
      message: records.length
        ? 'Processo de registro localizado pelo número CNJ exato publicado pelo TSE.'
        : 'O número de registro foi consultado, mas nenhum processo correspondente foi retornado. Isso não autoriza busca ou associação por nome.',
    };
  }

  factCheckSource() {
    return {
      id: SOURCES.factCheck.id,
      name: SOURCES.factCheck.name,
      authority: SOURCES.factCheck.authority,
      url: SOURCES.factCheck.url,
      fetchedAt: new Date().toISOString(),
      confidence: 'SECONDARY',
    };
  }

  async queryFactChecks(candidate) {
    const source = this.factCheckSource();
    if (!this.googleFactCheckApiKey) {
      return {
        status: 'DISABLED', records: [], source,
        message: 'A chave do Google Fact Check Tools ainda não foi configurada no servidor.',
      };
    }
    const query = firstText(candidate?.name, candidate?.ballotName);
    if (!query) return { status: 'NOT_APPLICABLE', records: [], source, message: 'A candidatura não possui nome oficial disponível para a busca textual.' };
    const parameters = new URLSearchParams({
      query,
      languageCode: 'pt',
      maxAgeDays: String(this.factCheckMaxAgeDays),
      pageSize: String(this.factCheckPageSize),
      key: this.googleFactCheckApiKey,
    });
    try {
      const payload = await this.requestJson(`https://factchecktools.googleapis.com/v1alpha1/claims:search?${parameters}`);
      const records = (Array.isArray(payload?.claims) ? payload.claims : []).flatMap((claim) => (
        (Array.isArray(claim?.claimReview) ? claim.claimReview : []).map((review) => ({
          claim: firstText(claim.text),
          claimant: firstText(claim.claimant),
          claimDate: firstText(claim.claimDate),
          publisher: firstText(review?.publisher?.name, review?.publisher?.site),
          publisherSite: firstText(review?.publisher?.site),
          title: firstText(review.title),
          reviewDate: firstText(review.reviewDate),
          rating: firstText(review.textualRating),
          languageCode: firstText(review.languageCode),
          url: safeUrl(review.url),
          stage: 'SECONDARY_FACT_CHECK',
        }))
      )).filter((record) => record.claim && record.url).slice(0, this.factCheckPageSize);
      return {
        status: records.length ? 'FOUND' : 'NONE_FOUND', records, source, query,
        message: records.length
          ? 'Checagens localizadas por busca textual. O VotoClaro não presume que toda alegação encontrada seja de autoria da candidatura.'
          : 'Nenhuma checagem foi retornada para a busca textual. Isso não comprova que não existam alegações ou verificações publicadas.',
      };
    } catch {
      return {
        status: 'UNAVAILABLE', records: [], source, query,
        message: 'O serviço de checagens não respondeu agora. Nenhum resultado substituto foi criado.',
      };
    }
  }

  async remoteData(candidate, cpf, forceRefresh) {
    const candidateId = candidate.id;
    const cached = this.cache.get(candidateId);
    if (!forceRefresh && cached) {
      const ttl = cached.hasError ? this.errorCacheTtlMs : this.cacheTtlMs;
      if (Date.now() - cached.savedAt < ttl) return cached.data;
    }
    const publicAccountsTask = cpf ? this.queryTcu(cpf) : Promise.resolve({
      status: 'IDENTITY_NOT_READY', records: [], source: this.tcuSource(),
      message: 'A identificação oficial ainda não está carregada na memória do servidor. Aguarde a sincronização do TSE.',
    });
    const sanctionsTask = cpf ? this.queryPortal(cpf) : Promise.resolve({
      status: this.portalToken ? 'IDENTITY_NOT_READY' : 'DISABLED', records: [],
      source: { id: SOURCES.cgu.id, name: SOURCES.cgu.name, authority: SOURCES.cgu.authority, url: SOURCES.cgu.url, confidence: 'OFFICIAL' },
      message: this.portalToken
        ? 'A identificação oficial ainda não está carregada na memória do servidor.'
        : 'A chave gratuita da API do Portal da Transparência ainda não foi configurada neste ambiente.',
    });
    const [publicAccounts, sanctions, datajud, factChecks] = await Promise.all([
      publicAccountsTask,
      sanctionsTask,
      this.queryDatajud(candidate),
      this.queryFactChecks(candidate),
    ]);
    const data = { checkedAt: new Date().toISOString(), publicAccounts, sanctions, datajud, factChecks };
    const hasError = ['UNAVAILABLE', 'PARTIAL'].includes(publicAccounts.status)
      || ['UNAVAILABLE', 'PARTIAL'].includes(sanctions.status)
      || ['UNAVAILABLE', 'PARTIAL'].includes(datajud.status);
    this.cache.set(candidateId, { savedAt: Date.now(), hasError, data });
    this.lastCheckAt = data.checkedAt;
    this.lastState = hasError ? 'PARTIAL' : 'OK';
    return data;
  }

  campaignFinance(candidate) {
    if (!candidate.finance) {
      return {
        status: 'NOT_PUBLISHED', totalRevenue: null, totalExpense: null, balance: null,
        revenueRecords: 0, expenseRecords: 0, source: this.tseFinanceSource(),
        message: 'A fonte eleitoral importada ainda não publicou movimentações para esta candidatura.',
      };
    }
    return {
      status: 'PUBLISHED',
      totalRevenue: Number(candidate.finance.totalRevenue || 0),
      totalExpense: Number(candidate.finance.totalExpense || 0),
      balance: Number(candidate.finance.balance || 0),
      revenueRecords: Number(candidate.finance.revenueRecords || 0),
      expenseRecords: Number(candidate.finance.expenseRecords || 0),
      expenseBasis: candidate.finance.expenseBasis || 'CONTRACTED',
      source: this.tseFinanceSource(),
      message: candidate.finance.note || 'Valores publicados pela Justiça Eleitoral.',
    };
  }

  tseFinanceSource() {
    return {
      name: 'TSE — Prestação de contas eleitorais 2026',
      authority: 'Tribunal Superior Eleitoral',
      url: SOURCES.tseRevenue.url,
      confidence: 'OFFICIAL',
    };
  }

  declaredAssets(candidate) {
    const assets = Array.isArray(candidate.assets) ? candidate.assets : [];
    return {
      status: assets.length ? 'PUBLISHED' : 'NOT_PUBLISHED',
      count: assets.length,
      total: Number(candidate.assetTotal || 0),
      source: { name: SOURCES.tseAssets.name, authority: SOURCES.tseAssets.authority, url: SOURCES.tseAssets.url, confidence: 'OFFICIAL' },
      message: assets.length
        ? 'Soma dos bens declarados pela candidatura e publicados pelo TSE.'
        : 'Nenhum bem consta no arquivo importado; isso não permite distinguir ausência de bens de publicação ainda incompleta.',
    };
  }

  legislativeExpenses(candidate, legislative, legislativeState) {
    if (!candidate.legislative) {
      return {
        status: 'NO_VERIFIED_MANDATE', totalShown: null, recordsShown: 0,
        message: 'Não há correspondência exata com mandato parlamentar atual; nenhuma despesa foi atribuída por nome aproximado.',
      };
    }
    if (legislativeState === 'UNAVAILABLE' || !legislative) {
      return {
        status: 'UNAVAILABLE', totalShown: null, recordsShown: 0,
        message: 'A Casa legislativa não respondeu agora.',
      };
    }
    if (!legislative.expenses) {
      return {
        status: 'NOT_PUBLISHED_IN_QUERY', totalShown: null, recordsShown: 0,
        source: legislative.source,
        message: 'A consulta atual da Casa legislativa não trouxe um resumo de despesas para este mandato.',
      };
    }
    return {
      status: 'PUBLISHED',
      year: legislative.expenses.year,
      totalShown: Number(legislative.expenses.totalShown || 0),
      recordsShown: Number(legislative.expenses.recordsShown || 0),
      partial: Boolean(legislative.expenses.partial),
      source: legislative.source,
      message: legislative.expenses.partial
        ? 'Soma do recorte retornado pela API; existem mais registros além dos exibidos.'
        : 'Soma dos registros retornados pela API oficial nesta consulta.',
    };
  }

  async get(candidate, options = {}) {
    const cpf = this.identityVault.getCpf(candidate.id);
    const remote = await this.remoteData(candidate, cpf, Boolean(options.forceRefresh));
    const definitiveRecords = [
      ...(remote.publicAccounts.records || []),
      ...(remote.sanctions.records || []),
    ].length;
    return {
      status: 'AVAILABLE',
      checkedAt: remote.checkedAt,
      summary: {
        definitiveOfficialRecords: definitiveRecords,
        label: definitiveRecords
          ? `${definitiveRecords} registro(s) oficial(is) localizado(s)`
          : 'Nenhum registro definitivo localizado nas consultas concluídas',
        warning: 'Não existe nota, ranking ou rótulo de “escândalo”. Cada registro precisa ser lido conforme seu estágio e fonte.',
      },
      publicAccounts: remote.publicAccounts,
      sanctions: remote.sanctions,
      datajud: remote.datajud,
      factChecks: remote.factChecks,
      campaignFinance: this.campaignFinance(candidate),
      declaredAssets: this.declaredAssets(candidate),
      legislativeExpenses: this.legislativeExpenses(candidate, options.legislative, options.legislativeState),
      methodology: {
        matching: 'TCU e Portal da Transparência são consultados somente pelo identificador oficial completo do candidato, nunca apenas pelo nome.',
        datajud: 'O DataJud é consultado somente pelo número CNJ do processo de registro publicado pelo TSE. Ele não é usado para procurar histórico judicial por nome.',
        factCheck: 'Checagens são resultados textuais de fonte secundária e não são atribuídas automaticamente à candidatura.',
        privacy: 'O identificador é mantido apenas na memória do servidor durante a sincronização e a consulta; não é gravado no snapshot, enviado ao navegador, incluído em logs ou retornado pela API.',
        legalStage: 'Investigação, acusação, sanção administrativa, decisão de contas e condenação judicial são situações distintas. Este módulo não presume culpa nem inelegibilidade.',
        absence: 'Ausência de resultado não é atestado de idoneidade: uma fonte pode estar desatualizada, fora do escopo ou temporariamente indisponível.',
      },
    };
  }
}

module.exports = {
  CandidateIdentityVault,
  IntegrityService,
  digits,
  formatCpf,
};
