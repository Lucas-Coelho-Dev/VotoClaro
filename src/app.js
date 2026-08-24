const crypto = require('crypto');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const {
  config,
  store,
  synchronizer,
  legislativeService,
  geographyService,
  governmentPlanService,
  governmentPlanSummaryService,
  integrityService,
  initializeRuntime,
} = require('./runtime');
const { publicSources } = require('./sources');
const { searchable, isVoterFacingOffice, attachRunningMates } = require('./normalize');
const { IDEOLOGY_SOURCE, IDEOLOGY_FILTERS, getPartyIdeology, partyMarkSvg } = require('./parties');
const {
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
  LEGISLATIVE_LLM_ANALYSIS_VERSION,
  LEGISLATIVE_LLM_PROMPT_VERSION,
} = require('./local-llm');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Em produção, força HTTPS. No acesso de teste pela rede local, o IP usa
      // HTTP e esta diretiva faria o celular tentar baixar CSS/JS por HTTPS.
      upgradeInsecureRequests: config.environment === 'production' ? [] : null,
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(compression());
app.use(express.json({ limit: '32kb', type: 'application/json' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (request) => request.path === '/api/v1/health',
}));

const candidateViewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_CANDIDATE_VIEWS',
    message: 'Muitas aberturas foram registradas em pouco tempo. Tente novamente mais tarde.',
  },
});

app.use(async (request, response, next) => {
  try {
    await initializeRuntime();
    response.setHeader('X-Data-Policy', 'official-primary-secondary-attributed');
    next();
  } catch (error) {
    next(error);
  }
});

const publicSnapshotCache = new WeakMap();

function publicSnapshot(snapshot) {
  if (publicSnapshotCache.has(snapshot)) return publicSnapshotCache.get(snapshot);
  const directCandidates = snapshot.candidates.filter(isVoterFacingOffice);
  const needsTicketMigration = directCandidates.some((candidate) => !Array.isArray(candidate.runningMates));
  const candidates = needsTicketMigration ? attachRunningMates(snapshot.candidates) : directCandidates;
  const value = {
    ...snapshot,
    meta: { ...snapshot.meta, candidateCount: candidates.length },
    candidates,
  };
  publicSnapshotCache.set(snapshot, value);
  return value;
}

function snapshotOrUnavailable(response) {
  const snapshot = store.getSnapshot();
  if (!snapshot) {
    response.status(503).json({
      error: 'DATA_NOT_READY',
      message: 'A primeira sincronização com o TSE ainda não foi concluída.',
      syncing: synchronizer.isRunning(),
    });
    return null;
  }
  return publicSnapshot(snapshot);
}

function candidateSummary(candidate) {
  return {
    id: candidate.id,
    tseId: candidate.tseId,
    electionYear: candidate.electionYear,
    name: candidate.name,
    ballotName: candidate.ballotName,
    ballotNumber: candidate.ballotNumber,
    office: candidate.office,
    uf: candidate.uf,
    electionUnit: candidate.electionUnit,
    electionUnitName: candidate.electionUnitName,
    party: candidate.party,
    partyName: candidate.partyName,
    partyNumber: candidate.partyNumber,
    partyImageUrl: `/api/v1/parties/${encodeURIComponent(candidate.party || 'SEM-PARTIDO')}/mark.svg?v=2`,
    partyIdeology: getPartyIdeology(candidate.party),
    status: candidate.status,
    statusDetail: candidate.statusDetail,
    statusGroup: candidate.statusGroup,
    photoUrl: candidate.photoUrl,
    assetTotal: candidate.assetTotal,
    assetCount: candidate.assets.length,
    finance: candidate.finance,
    runningMates: candidate.runningMates || [],
    source: candidate.sources[0],
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  office: z.string().trim().max(80).optional().default(''),
  uf: z.string().trim().max(2).optional().default(''),
  party: z.string().trim().max(30).optional().default(''),
  ideology: z.enum(['ESQUERDA', 'CENTRO', 'DIREITA', 'NAO_CLASSIFICADO']).optional(),
  status: z.enum(['APPROVED', 'PENDING', 'DENIED', 'CANCELLED', 'WITHDRAWN', 'DECEASED']).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(24),
});

const popularQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).optional().default(6),
});

const analysisReportSchema = z.object({
  candidateId: z.string().regex(/^\d{8,20}$/),
  subjectType: z.enum(['GOVERNMENT_PLAN', 'LEGISLATIVE_ITEM']),
  subjectKey: z.string().trim().max(128).optional().default(''),
  category: z.enum(['INCORRECT_EXCERPT', 'WRONG_PAGE', 'AUTHORSHIP', 'BIASED_LANGUAGE', 'OTHER']),
  pageNumber: z.coerce.number().int().min(1).max(5000).optional(),
  details: z.string().trim().min(20).max(1000),
  analysisVersion: z.string().trim().max(80).optional().default(''),
});

const analysisReportUpdateSchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolutionNote: z.string().trim().min(10).max(1000),
});

function sourceAlerts(snapshot) {
  return Object.entries(snapshot?.sourceStatuses || {})
    .filter(([, status]) => status?.alert || status?.state === 'ERROR')
    .map(([sourceId, status]) => ({
      sourceId,
      state: status.state || 'ERROR',
      message: status.message || 'A fonte não respondeu na última tentativa.',
      lastAttemptAt: status.lastAttemptAt || status.finishedAt || null,
      lastSuccessAt: status.lastSuccessAt || null,
      consecutiveFailures: Number(status.consecutiveFailures || 1),
    }));
}

app.get('/api/v1/health', (request, response) => {
  const storedSnapshot = store.getSnapshot();
  const snapshot = storedSnapshot ? publicSnapshot(storedSnapshot) : null;
  const importedAt = snapshot?.meta?.importedAt || null;
  const ageHours = importedAt ? (Date.now() - new Date(importedAt).getTime()) / 3_600_000 : null;
  const stale = ageHours === null || ageHours > 36;
  const planAnalysisStatus = governmentPlanSummaryService.getStatus();
  const legislativeAnalysisStatus = legislativeService.getStatus();
  response.status(snapshot && !stale ? 200 : 503).json({
    status: !snapshot ? 'INITIALIZING' : stale ? 'STALE' : 'OK',
    dataReady: Boolean(snapshot),
    syncing: synchronizer.isRunning(),
    persistence: store.backend,
    electionYear: 2026,
    candidateCount: snapshot?.meta?.candidateCount || 0,
    photoCount: snapshot?.meta?.photoCount || 0,
    importedAt,
    sourceGeneratedAt: snapshot?.meta?.sourceGeneratedAt || null,
    sourceAlerts: sourceAlerts(snapshot),
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    checksum: snapshot?.meta?.checksum || null,
    integrity: integrityService.getStatus(),
    localPlanAnalysis: {
      enabled: Boolean(planAnalysisStatus.enabled),
      mode: planAnalysisStatus.mode,
      model: planAnalysisStatus.model,
      queuedDocuments: planAnalysisStatus.queuedDocuments,
      workerRunning: planAnalysisStatus.workerRunning,
      precomputeRunning: planAnalysisStatus.precomputeRunning,
      scannedCandidates: planAnalysisStatus.scannedCandidates,
      eligibleCandidates: planAnalysisStatus.eligibleCandidates,
      precomputeCompletedAt: planAnalysisStatus.precomputeCompletedAt,
      lastSuccessAt: planAnalysisStatus.lastSuccessAt,
      lastErrorAt: planAnalysisStatus.lastErrorAt,
    },
    localLegislativeAnalysis: legislativeAnalysisStatus,
  });
});

const analysisReportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REPORTS',
    message: 'Muitos relatos foram enviados em pouco tempo. Tente novamente mais tarde.',
  },
});

app.get('/api/v1/sources', (request, response) => {
  const snapshot = store.getSnapshot();
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  response.json({
    dataPolicy: 'Dados oficiais são reproduzidos sem estimativas. Fontes secundárias nunca substituem a fonte oficial.',
    sources: publicSources(snapshot?.sourceStatuses || {}),
    alerts: sourceAlerts(snapshot),
    syncRuns: store.getRuns(),
    snapshot: snapshot?.meta || null,
  });
});

app.get('/api/v1/ai/methodology', async (request, response, next) => {
  try {
    const statistics = await store.getAiAuditStats();
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
    return response.json({
      generatedAt: new Date().toISOString(),
      model: config.localLlmModel,
      analyses: {
        governmentPlans: {
          analysisVersion: LOCAL_LLM_ANALYSIS_VERSION,
          promptVersion: LOCAL_LLM_PROMPT_VERSION,
          documents: ['PDFs de propostas de governo publicados pelo TSE'],
        },
        legislativeItems: {
          analysisVersion: LEGISLATIVE_LLM_ANALYSIS_VERSION,
          promptVersion: LEGISLATIVE_LLM_PROMPT_VERSION,
          documents: ['Ementas, situações e autorias oficiais da Câmara dos Deputados e do Senado Federal'],
        },
      },
      validations: [
        'Cada tema do plano é analisado isoladamente para reduzir mistura entre assuntos.',
        'Toda evidência textual precisa existir na página indicada do PDF oficial.',
        'Números que não aparecem nos documentos fornecidos à IA são rejeitados.',
        'Autoria legislativa só é mostrada após correspondência exata com a fonte oficial.',
        'Impactos são cenários condicionais e não previsões, garantias ou notas eleitorais.',
      ],
      limitations: [
        'A IA pode simplificar demais, deixar de identificar uma proposta ou interpretar de forma incompleta.',
        'O sistema não calcula custo, viabilidade, prioridade política nem chance de cumprimento.',
        'PDFs digitalizados como imagem podem não oferecer texto extraível suficiente.',
        'A conferência humana do documento original continua recomendada.',
      ],
      correctionHistory: [
        { date: '2026-08-24', version: LOCAL_LLM_ANALYSIS_VERSION, change: 'Visão geral passou a reunir todos os temas identificados, sem usar Educação como resumo de todo o plano.' },
        { date: '2026-08-24', version: LOCAL_LLM_ANALYSIS_VERSION, change: 'Campos temáticos passaram a preservar o estado aberto durante atualizações automáticas.' },
        { date: '2026-08-24', version: LOCAL_LLM_ANALYSIS_VERSION, change: 'Explicações passaram a separar mudança, caminho até a sociedade e lacunas do documento.' },
      ],
      statistics,
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/v1/reports', analysisReportRateLimit, async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const report = analysisReportSchema.parse(request.body);
    if (!snapshot.candidates.some((candidate) => candidate.id === report.candidateId)) {
      return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND', message: 'Candidatura não encontrada na publicação oficial atual.' });
    }
    const trackingCode = `VC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const stored = await store.createAnalysisReport({
      ...report,
      trackingCode,
      createdAt: new Date().toISOString(),
    });
    response.setHeader('Cache-Control', 'no-store');
    return response.status(201).json({
      data: {
        trackingCode: stored.trackingCode,
        status: stored.status,
        createdAt: stored.createdAt,
        statusUrl: `/report-status.html?code=${encodeURIComponent(stored.trackingCode)}`,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/reports/:trackingCode', async (request, response, next) => {
  try {
    const trackingCode = String(request.params.trackingCode || '').trim().toUpperCase();
    if (!/^VC-[A-F0-9]{12}$/.test(trackingCode)) {
      return response.status(400).json({ error: 'INVALID_TRACKING_CODE', message: 'Protocolo inválido.' });
    }
    const report = await store.getAnalysisReport(trackingCode);
    if (!report) return response.status(404).json({ error: 'REPORT_NOT_FOUND', message: 'Relato não encontrado.' });
    response.setHeader('Cache-Control', 'no-store');
    return response.json({ data: report });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/filters', (request, response) => {
  const snapshot = snapshotOrUnavailable(response);
  if (!snapshot) return;
  response.setHeader('Cache-Control', 'public, max-age=900');
  const candidates = snapshot.candidates.filter(isVoterFacingOffice);
  response.json({
    offices: uniqueSorted(candidates.map((candidate) => candidate.office)),
    states: uniqueSorted(candidates.map((candidate) => candidate.uf)),
    parties: uniqueSorted(candidates.map((candidate) => candidate.party)),
    ideologies: IDEOLOGY_FILTERS,
    ideologyMethodology: {
      scope: 'PARTY',
      source: IDEOLOGY_SOURCE,
      broadBuckets: 'Esquerda: 0–3; centro amplo: 3,01–7; direita: 7,01–10.',
      candidateCaveat: 'A faixa descreve a posição do partido na pesquisa acadêmica e não determina a posição individual da candidatura.',
    },
  });
});

app.get('/api/v1/parties/:party/mark.svg', (request, response) => {
  response.set({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  return response.send(partyMarkSvg(request.params.party));
});

app.get('/api/v1/popular-candidates', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const query = popularQuerySchema.parse(request.query);
    const candidatesById = new Map(snapshot.candidates.filter(isVoterFacingOffice).map((candidate) => [candidate.id, candidate]));
    const aggregates = await store.getPopularCandidateViews(100);
    const data = aggregates
      .map((aggregate) => {
        const candidate = candidatesById.get(aggregate.candidateId);
        return candidate ? {
          ...candidateSummary(candidate),
          consultationCount: aggregate.viewCount,
          lastConsultedAt: aggregate.lastViewedAt,
        } : null;
      })
      .filter(Boolean)
      .slice(0, query.limit);
    response.setHeader('Cache-Control', 'no-store');
    return response.json({
      data,
      methodology: {
        label: 'Mais consultados',
        meaning: 'Ordem pelo total agregado de aberturas da ficha no VotoClaro.',
        limitation: 'Consulta não significa apoio, intenção de voto, aprovação ou recomendação.',
        privacy: 'Nenhuma identidade, localização ou conteúdo da colinha é armazenado nesta contagem.',
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/geography/states', async (request, response, next) => {
  try {
    const data = await geographyService.getStates();
    response.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=2592000');
    response.json({
      data,
      source: {
        name: 'IBGE — Malhas territoriais das UFs',
        url: 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html',
        confidence: 'OFFICIAL',
      },
      privacy: 'Este endpoint entrega somente os limites das UFs. Latitude e longitude não são recebidas pelo servidor.',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/candidates', (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const query = listQuerySchema.parse(request.query);
    const q = searchable(query.q);
    const office = searchable(query.office);
    const uf = query.uf.toUpperCase();
    const party = query.party.toUpperCase();
    const filtered = snapshot.candidates.filter(isVoterFacingOffice).filter((candidate) => {
      const ticketSearch = (candidate.runningMates || [])
        .map((item) => `${item.name} ${item.ballotName} ${item.party}`)
        .join(' ');
      if (q && !searchable(`${candidate.name} ${candidate.ballotName} ${candidate.ballotNumber} ${candidate.party} ${ticketSearch}`).includes(q)) return false;
      if (office && searchable(candidate.office) !== office) return false;
      if (uf && candidate.uf !== uf) return false;
      if (party && candidate.party !== party) return false;
      if (query.ideology && getPartyIdeology(candidate.party).bucket !== query.ideology) return false;
      if (query.status && candidate.statusGroup !== query.status) return false;
      return true;
    });
    const offset = (query.page - 1) * query.pageSize;
    response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    response.json({
      data: filtered.slice(offset, offset + query.pageSize).map(candidateSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      },
      snapshot: snapshot.meta,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/candidates/:id/view', candidateViewRateLimit, async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    if (request.get('x-votoclaro-interaction') !== 'candidate-detail') {
      return response.status(400).json({
        error: 'INVALID_VIEW_INTERACTION',
        message: 'A abertura precisa ser registrada pela ficha da candidatura.',
      });
    }
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const aggregate = await store.recordCandidateView(candidate.id);
    response.setHeader('Cache-Control', 'no-store');
    return response.json({
      data: {
        candidateId: candidate.id,
        consultationCount: aggregate.viewCount,
      },
      note: 'Contagem agregada de abertura. Não representa apoio, intenção de voto ou recomendação.',
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id/photo', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const photo = await store.getCandidatePhoto(candidate.id);
    if (!photo) {
      response.setHeader('Cache-Control', 'no-store');
      return response.status(404).json({ error: 'PHOTO_NOT_PUBLISHED', message: 'A foto não consta no cache oficial importado.' });
    }
    const etagValue = photo.sha256 || crypto.createHash('sha256').update(photo.buffer).digest('hex');
    const etag = `"${etagValue}"`;
    if (request.get('if-none-match') === etag) return response.status(304).end();
    response.set({
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      'Content-Type': photo.contentType || 'image/jpeg',
      'Content-Length': String(photo.buffer.length),
      ETag: etag,
      'X-Photo-Source': 'TSE-Dados-Abertos-2026',
    });
    return response.send(photo.buffer);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id/government-plan/status', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const plan = await governmentPlanService.get(candidate);
    response.setHeader('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
    return response.json({
      data: plan ? {
        available: true,
        url: `/api/v1/candidates/${encodeURIComponent(candidate.id)}/government-plan`,
        filename: plan.filename,
        source: plan.source,
      } : {
        available: false,
        message: 'O TSE não publicou um documento associado exatamente a esta candidatura no arquivo atual.',
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id/government-plan/summary', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const summary = await governmentPlanSummaryService.get(candidate);
    if (!summary) {
      return response.status(404).json({
        error: 'GOVERNMENT_PLAN_NOT_PUBLISHED',
        message: 'Não há documento oficial para resumir nesta candidatura.',
      });
    }
    const localAnalysisReady = summary.aiAnalysis?.status === 'READY';
    response.setHeader(
      'Cache-Control',
      localAnalysisReady
        ? 'public, max-age=86400, stale-while-revalidate=604800'
        : 'no-store',
    );
    return response.json({
      data: {
        ...summary,
        pdfUrl: `/api/v1/candidates/${encodeURIComponent(candidate.id)}/government-plan`,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id/government-plan', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const plan = await governmentPlanService.get(candidate);
    if (!plan) {
      return response.status(404).json({
        error: 'GOVERNMENT_PLAN_NOT_PUBLISHED',
        message: 'O documento não consta no arquivo oficial atual para esta candidatura.',
      });
    }
    const etag = `"${plan.sha256}"`;
    if (request.get('if-none-match') === etag) return response.status(304).end();
    const filename = plan.filename.replace(/["\r\n]/g, '');
    response.set({
      'Cache-Control': 'public, max-age=21600, stale-while-revalidate=86400',
      'Content-Type': plan.contentType,
      'Content-Length': String(plan.buffer.length),
      'Content-Disposition': `inline; filename="${filename}"`,
      ETag: etag,
      'X-Document-Source': 'TSE-Dados-Abertos-2026',
    });
    return response.send(plan.buffer);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id', (request, response) => {
  const snapshot = snapshotOrUnavailable(response);
  if (!snapshot) return;
  const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
  if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND', message: 'Candidatura não encontrada na publicação oficial atual.' });
  response.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  return response.json({
    data: {
      ...candidate,
      partyImageUrl: `/api/v1/parties/${encodeURIComponent(candidate.party || 'SEM-PARTIDO')}/mark.svg?v=2`,
      partyIdeology: getPartyIdeology(candidate.party),
    },
    snapshot: snapshot.meta,
  });
});

app.get('/api/v1/candidates/:id/legislative', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    if (!candidate.legislative) return response.status(404).json({ error: 'NO_VERIFIED_LINK', message: 'Não existe correspondência exata com um mandato parlamentar atual.' });
    const data = await legislativeService.get(candidate);
    const pendingExplanation = data?.laws?.some((law) => ['QUEUED', 'PROCESSING'].includes(law.plainLanguage?.status));
    response.setHeader('Cache-Control', pendingExplanation ? 'no-store' : 'public, max-age=900, stale-while-revalidate=3600');
    return response.json({ data, match: candidate.legislative });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/candidates/:id/integrity', async (request, response, next) => {
  try {
    const snapshot = snapshotOrUnavailable(response);
    if (!snapshot) return;
    const candidate = snapshot.candidates.find((item) => item.id === request.params.id);
    if (!candidate) return response.status(404).json({ error: 'CANDIDATE_NOT_FOUND' });
    const forceRefresh = request.query.refresh === '1';
    let legislative = null;
    let legislativeState = candidate.legislative ? 'AVAILABLE' : 'NO_VERIFIED_MANDATE';
    if (candidate.legislative) {
      try {
        legislative = await legislativeService.get(candidate);
      } catch {
        legislativeState = 'UNAVAILABLE';
      }
    }
    const data = await integrityService.get(candidate, { forceRefresh, legislative, legislativeState });
    response.setHeader('Cache-Control', forceRefresh
      ? 'no-store'
      : 'public, max-age=300, stale-while-revalidate=1800');
    return response.json({
      data,
      policy: 'Somente registros publicados por fontes oficiais e vinculados por identificador exato. Investigação, sanção e decisão final são estágios distintos.',
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/v1/changes', (request, response) => {
  const snapshot = snapshotOrUnavailable(response);
  if (!snapshot) return;
  response.setHeader('Cache-Control', 'public, max-age=300');
  response.json({ data: snapshot.changes || [], detectedAt: snapshot.meta.importedAt, source: 'TSE — Candidatos 2026' });
});

function safeSecretMatch(provided, expected) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

async function authenticatedSync(request, response, next) {
  try {
    if (!config.syncSecret) return response.status(503).json({ error: 'SYNC_NOT_CONFIGURED', message: 'Defina SYNC_SECRET ou CRON_SECRET.' });
    const authorization = request.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!safeSecretMatch(token, config.syncSecret)) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const result = await synchronizer.synchronize('authenticated-request');
    return response.json({ message: 'Sincronização oficial concluída.', snapshot: result });
  } catch (error) {
    return next(error);
  }
}
app.post('/api/v1/admin/sync', authenticatedSync);
app.get('/api/v1/admin/sync', authenticatedSync);

app.patch('/api/v1/admin/reports/:trackingCode', async (request, response, next) => {
  try {
    if (!config.syncSecret) return response.status(503).json({ error: 'ADMIN_NOT_CONFIGURED', message: 'Defina SYNC_SECRET.' });
    const authorization = request.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!safeSecretMatch(token, config.syncSecret)) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const trackingCode = String(request.params.trackingCode || '').trim().toUpperCase();
    if (!/^VC-[A-F0-9]{12}$/.test(trackingCode)) return response.status(400).json({ error: 'INVALID_TRACKING_CODE' });
    const update = analysisReportUpdateSchema.parse(request.body);
    const report = await store.updateAnalysisReport(trackingCode, update);
    if (!report) return response.status(404).json({ error: 'REPORT_NOT_FOUND' });
    response.setHeader('Cache-Control', 'no-store');
    return response.json({ data: report });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/candidates', (request, response) => response.status(410).json({
  error: 'LEGACY_API_REMOVED',
  message: 'A API antiga misturava dados reais e simulados. Use /api/v1/candidates.',
}));
app.all(['/api/auth/*', '/api/colinha'], (request, response) => response.status(410).json({
  error: 'SENSITIVE_STORAGE_REMOVED',
  message: 'Cadastro com CPF e sincronização de preferência política foram desativados. A colinha agora permanece no navegador.',
}));

app.get(['/', '/index.html'], (request, response) => {
  response.setHeader('Cache-Control', 'no-cache');
  response.sendFile(path.join(config.publicDir, 'official.html'));
});
app.use(express.static(config.publicDir, { index: false, maxAge: '1h', dotfiles: 'ignore' }));
app.get('*', (request, response) => response.sendFile(path.join(config.publicDir, 'official.html')));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'INVALID_REQUEST', message: 'Filtros inválidos.', details: error.issues });
  }
  console.error('[VotoClaro] Erro de requisição:', error.message);
  return response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' });
});

module.exports = app;
