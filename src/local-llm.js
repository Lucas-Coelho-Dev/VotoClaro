const { z } = require('zod');

const LOCAL_LLM_ANALYSIS_VERSION = 'local-llm-v16';
const LOCAL_LLM_PROMPT_VERSION = 'government-plan-theme-explanation-v16';
const LEGISLATIVE_LLM_ANALYSIS_VERSION = 'legislative-plain-language-v4';
const LEGISLATIVE_LLM_PROMPT_VERSION = 'legislative-fine-print-v3';
const DOCUMENT_QA_PROMPT_VERSION = 'official-document-qa-v1';

const objectiveSchema = z.object({
  summary: z.string().trim().min(30).max(180),
  evidenceThemes: z.array(z.string().trim().min(1).max(80)).min(1).max(2),
});

const themeDigestSchema = z.object({
  summary: z.string().trim().min(90).max(420),
  potentialImpact: z.string().trim().min(140).max(520),
  conditionsAndLimits: z.string().trim().min(80).max(380),
});

const llmResponseSchema = z.object({
  objective: objectiveSchema,
  themeDigests: z.record(z.string(), themeDigestSchema),
});

const legislativeExplanationSchema = z.object({
  plainLanguage: z.string().trim().min(30).max(240),
  possibleImpact: z.string().trim().min(20).max(180),
  finePrint: z.string().trim().min(20).max(180),
});

const legislativeExplanationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['plainLanguage', 'possibleImpact', 'finePrint'],
  properties: {
    plainLanguage: { type: 'string', minLength: 30, maxLength: 240 },
    possibleImpact: { type: 'string', minLength: 20, maxLength: 180 },
    finePrint: { type: 'string', minLength: 20, maxLength: 180 },
  },
};

const documentAnswerSchema = z.object({
  answer: z.string().trim().min(30).max(900),
  citationIds: z.array(z.string().trim().min(1).max(30)).max(6),
  notFound: z.boolean(),
});

const documentAnswerJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citationIds', 'notFound'],
  properties: {
    answer: { type: 'string', minLength: 30, maxLength: 900 },
    citationIds: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 30 } },
    notFound: { type: 'boolean' },
  },
};

function responseJsonSchema(themeIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['objective', 'themeDigests'],
    properties: {
      objective: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidenceThemes'],
        properties: {
          summary: { type: 'string', minLength: 30, maxLength: 180 },
          evidenceThemes: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: { type: 'string', enum: themeIds },
          },
        },
      },
      themeDigests: {
        type: 'object',
        additionalProperties: false,
        required: themeIds,
        properties: Object.fromEntries(themeIds.map((themeId) => [themeId, {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'potentialImpact', 'conditionsAndLimits'],
          properties: {
            summary: { type: 'string', minLength: 90, maxLength: 420 },
            potentialImpact: { type: 'string', minLength: 140, maxLength: 520 },
            conditionsAndLimits: { type: 'string', minLength: 80, maxLength: 380 },
          },
        }])),
      },
    },
  };
}

function parseJsonContent(value) {
  const content = String(value || '').trim();
  if (!content) throw new Error('A LLM local retornou uma resposta vazia.');
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(content.slice(first, last + 1));
    throw new Error('A LLM local não retornou JSON válido.');
  }
}

function isPrivateOrLocalHostname(value) {
  const hostname = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', '::1'].includes(hostname) || hostname.endsWith('.localhost')) return true;
  if (!hostname.includes('.')) return /^[a-z0-9-]+$/.test(hostname);
  const octets = hostname.split('.').map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  return hostname.endsWith('.internal')
    || (hostname.includes(':') && (hostname.startsWith('fc') || hostname.startsWith('fd')));
}

function localEndpoint(baseUrl) {
  const endpoint = new URL('chat/completions', `${String(baseUrl || '').replace(/\/+$/, '')}/`);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !isPrivateOrLocalHostname(endpoint.hostname)) {
    throw new Error('A LLM deve usar somente um servidor local ou uma rede privada.');
  }
  if (endpoint.username || endpoint.password) throw new Error('A URL da LLM local não pode conter credenciais.');
  return endpoint;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericTokens(value) {
  return new Set(String(value || '').match(/\d+(?:[.,]\d+)*/g) || []);
}

function assertNoUnsupportedNumbers(result, sourceText) {
  const allowed = numericTokens(sourceText);
  const generated = numericTokens(Object.values(result || {}).join(' '));
  for (const number of generated) {
    if (!allowed.has(number)) throw new Error(`A explicação legislativa criou o número não sustentado ${number}.`);
  }
}

const LEGISLATIVE_GENERIC_TOKENS = new Set([
  'pode', 'podem', 'pratica', 'efeito', 'efeitos', 'mudanca', 'mudancas', 'juridica', 'juridicas',
  'aplicacao', 'execucao', 'resultado', 'resultados', 'social', 'sociais', 'depende', 'dependem',
  'medido', 'medidos', 'medida', 'avaliacao', 'consulta', 'fonte', 'oficial', 'norma', 'lei',
]);

function contentTokens(value) {
  const ignored = new Set(['para', 'como', 'isso', 'essa', 'esse', 'esta', 'este', 'uma', 'com', 'sem', 'que', 'dos', 'das', 'pela', 'pelo', 'aos', 'nas', 'nos', 'ser', 'ter', 'mais', 'forma']);
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z]{4,}/g)?.filter((token) => !ignored.has(token)) || [];
}

function groundedLegislativeImpact(value, sourceText, item) {
  const source = new Set(contentTokens(sourceText));
  const unsupported = contentTokens(value).filter((token) => !source.has(token) && !LEGISLATIVE_GENERIC_TOKENS.has(token));
  if (new Set(unsupported).size <= 2) return value;
  if (item?.evidence?.stage === 'PROPOSAL') {
    return 'Se for aprovado e implementado, pode produzir a mudança descrita na ementa; esta consulta não mede resultados sociais.';
  }
  return 'Pode produzir a mudança jurídica descrita na ementa; os efeitos sociais dependem da execução e ainda não foram medidos nesta consulta.';
}

function legislativeFinePrint(item) {
  if (item?.evidence?.stage === 'PROPOSAL') {
    return 'A fonte confirma somente uma proposta em tramitação. Ela ainda não produz efeito legal direto e pode ser alterada, aprovada ou arquivada.';
  }
  return 'A fonte confirma a mudança jurídica, mas esta consulta não encontrou avaliação pública vinculada que meça resultados sociais da norma.';
}

function preferredLegislativeSummary(value) {
  const text = String(value || '').trim();
  const updated = text.split(/NOVA EMENTA\s*:/iu).pop().trim();
  return updated || text;
}

function deterministicLegislativeExplanation(item, sourceText) {
  const official = preferredLegislativeSummary(item?.summary).replace(/[.!?]+$/u, '').trim();
  const lowered = official ? `${official.charAt(0).toLowerCase()}${official.slice(1)}` : 'descreve a alteração registrada na ementa';
  const result = {
    plainLanguage: `Em termos simples, o texto oficial ${lowered}.`,
    possibleImpact: groundedLegislativeImpact('', sourceText, item),
    finePrint: legislativeFinePrint(item),
    validationFallback: true,
  };
  assertNoUnsupportedNumbers(result, sourceText);
  return result;
}

function polishOfficialAnswer(value) {
  return String(value || '')
    .replace(/\bpropõe a estabelecimento\b/giu, 'propõe o estabelecimento')
    .replace(/\b(?:no|na) páginas\b/giu, 'nas páginas')
    .replace(/\bno página\b/giu, 'na página')
    .replace(/\bna páginas\b/giu, 'nas páginas')
    .replace(/\s+/g, ' ')
    .trim();
}

function finishOfficialAnswer(value) {
  const answer = polishOfficialAnswer(value);
  if (!answer || /[.!?)]$/u.test(answer)) return answer;
  const lastCompleteSentence = Math.max(
    answer.lastIndexOf('.'),
    answer.lastIndexOf('!'),
    answer.lastIndexOf('?'),
  );
  return lastCompleteSentence >= 0
    ? answer.slice(0, lastCompleteSentence + 1).trim()
    : answer;
}

async function streamedMessageContent(response) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('A LLM local não abriu o fluxo de resposta.');
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    content += event?.choices?.[0]?.delta?.content || event?.choices?.[0]?.message?.content || '';
  };
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (pending) consumeLine(pending);
  return content;
}

class LocalLlmClient {
  constructor(config, themes) {
    this.config = config;
    this.themes = themes;
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
    this.activeRequests = 0;
    this.waitingForServer = false;
    this.serverReadyAt = null;
    this.executionQueue = [];
    this.executionRunning = false;
  }

  isEnabled() {
    return Boolean(this.config.localLlmEnabled);
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      mode: !this.isEnabled() ? 'DISABLED' : this.waitingForServer ? 'WAITING_FOR_SERVER' : 'LOCAL_SERVER',
      model: this.config.localLlmModel,
      promptVersion: LOCAL_LLM_PROMPT_VERSION,
      activeRequests: this.activeRequests,
      waitingForServer: this.waitingForServer,
      serverReadyAt: this.serverReadyAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  async checkHealth() {
    if (!this.isEnabled()) return false;
    const completionEndpoint = localEndpoint(this.config.localLlmBaseUrl);
    const endpoint = new URL('/health', completionEndpoint.origin);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      this.serverReadyAt = new Date().toISOString();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async waitUntilReady() {
    const maximumWait = Number(this.config.localLlmStartupWaitMs) || 30 * 60 * 1000;
    const deadline = Date.now() + maximumWait;
    this.waitingForServer = true;
    try {
      while (Date.now() < deadline) {
        if (await this.checkHealth()) return;
        await delay(Math.min(10_000, Math.max(250, deadline - Date.now())));
      }
      const error = new Error('O servidor da IA local não ficou pronto dentro do tempo configurado.');
      error.code = 'LOCAL_LLM_NOT_READY';
      this.lastErrorAt = new Date().toISOString();
      this.lastError = error.message;
      throw error;
    } finally {
      this.waitingForServer = false;
    }
  }

  async analyzeChunk(chunk, context = {}) {
    return this.runExclusive(() => this.performPlanAnalysis(chunk, context));
  }

  async runExclusive(operation, priority = false) {
    return new Promise((resolve, reject) => {
      const job = { operation, resolve, reject };
      if (priority) this.executionQueue.unshift(job);
      else this.executionQueue.push(job);
      setImmediate(() => this.runExecutionQueue());
    });
  }

  async runExecutionQueue() {
    if (this.executionRunning) return;
    this.executionRunning = true;
    try {
      while (this.executionQueue.length) {
        const job = this.executionQueue.shift();
        try { job.resolve(await job.operation()); } catch (error) { job.reject(error); }
      }
    } finally {
      this.executionRunning = false;
    }
  }

  async performPlanAnalysis(chunk, context = {}) {
    if (!this.isEnabled()) throw new Error('A LLM local está desabilitada.');
    const allowedThemeIds = Array.isArray(chunk.themeIds) && chunk.themeIds.length
      ? chunk.themeIds
      : this.themes.map((theme) => theme.id);
    const themeList = this.themes
      .filter((theme) => allowedThemeIds.includes(theme.id))
      .map((theme) => `${theme.id}: ${theme.label}`)
      .join('\n');
    const candidateName = String(context.candidateName || 'o candidato')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    const system = [
      '/no_think',
      'Você é um explicador neutro de planos de governo oficiais brasileiros.',
      'Use exclusivamente o texto fornecido. Não use conhecimento externo e não avalie o candidato.',
      'Não trate o candidato como eleito nem como governo em exercício; escreva sempre que o plano pretende ou propõe.',
      'Explique primeiro o objetivo central que conecta as prioridades recorrentes dos trechos.',
      'Depois produza exatamente uma síntese para cada TEMA SUGERIDO presente no texto.',
      'Em themeDigests, preencha obrigatoriamente cada chave de tema fornecida; não use uma lista.',
      'Em cada síntese, reúna as ações concretas dos até três trechos daquele mesmo tema; nunca misture temas.',
      'No summary, explique em duas frases o que mudaria na estrutura, no serviço ou na política pública. Inclua pelo menos duas ações ou características concretas dos trechos. Não escreva o nome nem introduções.',
      'Não repita os trechos literalmente e não crie uma quarta proposta.',
      'Não invente números, custos, prazos, beneficiários ou resultados.',
      'Escreva para uma pessoa comum: frases curtas, concretas, enriquecedoras e sem jargão.',
      'No potentialImpact, não repita a proposta. Explique a cadeia causal completa: quem administraria, prestaria, receberia ou usaria a política; o que mudaria no serviço, na regra ou na distribuição de recursos; e como isso poderia aparecer na vida cotidiana.',
      'Use os grupos citados nos trechos. Não prometa desenvolvimento, melhoria, eficiência ou redução se a relação não estiver explicada pelas evidências.',
      'Em conditionsAndLimits, cite pelo menos três dúvidas concretas que os trechos selecionados não resolvem sobre execução, orçamento, transição, alcance, critérios ou medição. Fale dos trechos, não do documento inteiro.',
      'Cada campo pode ter duas ou três frases curtas e deve terminar com pontuação completa.',
      'Não use algarismos que não estejam nos trechos fornecidos.',
      'Não use as expressões promover desenvolvimento, gerar benefícios, melhorar a sociedade, promover eficiência ou maior eficiência.',
      'Responda apenas no JSON solicitado.',
    ].join(' ');
    const user = `NOME: ${candidateName}\n\nTEMAS DESTE BLOCO:\n${themeList}\n\nATÉ TRÊS TRECHOS POR TEMA, EXTRAÍDOS DO PDF OFICIAL E MARCADOS COM A PÁGINA:\n${chunk.text}`;
    const endpoint = localEndpoint(this.config.localLlmBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.localLlmTimeoutMs);
    this.activeRequests += 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: this.config.localLlmModel,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: this.config.localLlmTemperature,
          top_p: 0.8,
          top_k: 20,
          min_p: 0,
          presence_penalty: 1,
          seed: 2026,
          max_tokens: this.config.localLlmMaxOutputTokens,
          stream: true,
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: 'none',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'government_plan_explanation',
              strict: true,
              schema: responseJsonSchema(allowedThemeIds),
            },
          },
        }),
      });
      if (!response.ok) {
        const message = String(await response.text()).slice(0, 500);
        throw new Error(`LLM local respondeu HTTP ${response.status}: ${message}`);
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const content = contentType.includes('text/event-stream')
        ? await streamedMessageContent(response)
        : (await response.json())?.choices?.[0]?.message?.content;
      const parsed = llmResponseSchema.parse(parseJsonContent(content));
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return {
        ...parsed,
        themeDigests: Object.entries(parsed.themeDigests)
          .map(([theme, digest]) => ({ theme, ...digest })),
      };
    } catch (error) {
      const normalized = error.name === 'AbortError'
        ? new Error('Tempo limite ao consultar a LLM local.')
        : error;
      this.lastErrorAt = new Date().toISOString();
      this.lastError = normalized.message;
      throw normalized;
    } finally {
      clearTimeout(timeout);
      this.activeRequests -= 1;
    }
  }

  async analyzeLegislativeItem(item, context = {}) {
    return this.runExclusive(() => this.performLegislativeAnalysis(item, context));
  }

  async answerOfficialQuestion(question, evidences, context = {}) {
    return this.runExclusive(() => this.performOfficialQuestion(question, evidences, context), true);
  }

  async performOfficialQuestion(question, evidences, context = {}) {
    if (!this.isEnabled()) throw new Error('A LLM local está desabilitada.');
    const allowed = new Map((evidences || []).map((evidence) => [String(evidence.id), evidence]));
    if (!allowed.size) return { answer: 'Não encontrei informação suficiente nas fontes oficiais disponíveis para responder a esta pergunta.', citationIds: [], notFound: true };
    const evidenceText = [...allowed.values()].map((evidence) => [
      `[${evidence.id}]`,
      `TIPO: ${evidence.kind}`,
      `LOCAL: ${evidence.label}`,
      `TEXTO: ${evidence.text}`,
    ].join('\n')).join('\n\n');
    const system = [
      '/no_think',
      'Você responde perguntas eleitorais somente com as evidências oficiais numeradas fornecidas.',
      'Não use conhecimento externo, memória, opinião, inferência sobre caráter nem linguagem de campanha.',
      'Diferencie proposta, projeto em tramitação, norma jurídica e resultado social medido.',
      'Se a resposta não estiver sustentada, marque notFound como true e diga claramente que a fonte consultada não informa.',
      'Toda afirmação factual deve ser sustentada por citationIds existentes. Não invente páginas, números, custos ou consequências.',
      'Responda em português claro, explicando a letra miúda sem elogiar nem atacar a candidatura.',
      'Responda somente no JSON solicitado.',
    ].join(' ');
    const endpoint = localEndpoint(this.config.localLlmBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.localLlmTimeoutMs);
    this.activeRequests += 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: this.config.localLlmModel,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `CANDIDATURA: ${context.candidateName || 'não informada'}\nPERGUNTA: ${question}\n\nEVIDÊNCIAS:\n${evidenceText}` },
          ],
          temperature: 0.05,
          top_p: 0.8,
          seed: 2026,
          max_tokens: Math.min(this.config.localLlmMaxOutputTokens, 900),
          stream: true,
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: 'none',
          response_format: { type: 'json_schema', json_schema: { name: 'official_document_answer', strict: true, schema: documentAnswerJsonSchema } },
        }),
      });
      if (!response.ok) throw new Error(`LLM local respondeu HTTP ${response.status}.`);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const content = contentType.includes('text/event-stream')
        ? await streamedMessageContent(response)
        : (await response.json())?.choices?.[0]?.message?.content;
      const parsed = documentAnswerSchema.parse(parseJsonContent(content));
      const citationIds = [...new Set(parsed.citationIds)].filter((id) => allowed.has(id));
      if (!parsed.notFound && !citationIds.length) throw new Error('A resposta não apresentou uma citação oficial válida.');
      const citedText = citationIds.map((id) => {
        const evidence = allowed.get(id);
        return `${id} ${evidence.label || ''} ${evidence.page || ''} ${evidence.text}`;
      }).join(' ');
      const answer = finishOfficialAnswer(parsed.answer);
      assertNoUnsupportedNumbers({ answer }, citedText || evidenceText);
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return { ...parsed, answer, citationIds };
    } catch (error) {
      const normalized = error.name === 'AbortError' ? new Error('Tempo limite ao consultar a LLM local.') : error;
      this.lastErrorAt = new Date().toISOString();
      this.lastError = normalized.message;
      throw normalized;
    } finally {
      clearTimeout(timeout);
      this.activeRequests -= 1;
    }
  }

  async performLegislativeAnalysis(item, context = {}) {
    if (!this.isEnabled()) throw new Error('A LLM local está desabilitada.');
    const candidateName = String(context.candidateName || 'a pessoa candidata')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    const sourceText = [
      `CANDIDATURA: ${candidateName}`,
      `AUTORIA: ${item.authorship?.label || 'Autoria confirmada pela fonte oficial'}`,
      `PROPOSIÇÃO: ${item.title || ''}`,
      `NORMA: ${item.lawTitle || ''}`,
      `EMENTA OFICIAL: ${preferredLegislativeSummary(item.summary)}`,
      `SITUAÇÃO OFICIAL: ${item.status || ''}`,
      `TEMAS OFICIAIS: ${(item.themes || []).join(', ')}`,
    ].join('\n');
    const system = [
      '/no_think',
      'Você traduz a linguagem de leis brasileiras para leitores comuns, de modo neutro e verificável.',
      'Use exclusivamente os campos oficiais fornecidos. Não use conhecimento externo e não elogie nem ataque a candidatura.',
      'plainLanguage deve explicar em palavras simples o que a norma ou proposição faz, sem copiar a ementa inteira.',
      'possibleImpact deve dizer o que ela pode mudar na prática, sempre como possibilidade, nunca como impacto comprovado.',
      'No impacto, use somente substantivos e conceitos que já aparecem na ementa. Não suponha comemorações, benefícios, melhoria, equidade, transparência, economia ou comportamento.',
      'finePrint deve apenas reconhecer que a fonte não mede os resultados sociais; não invente lacunas específicas.',
      'Quando houver NOVA EMENTA, ela é o texto oficial atualizado, não uma ação de substituir um registro anterior.',
      'Não atribua autoria individual além do rótulo oficial fornecido. Coautoria não é autoria exclusiva.',
      'Não invente números, valores, prazos, beneficiários, resultados, controvérsias ou intenções.',
      'Use frases curtas e concretas. Responda somente no JSON solicitado.',
    ].join(' ');
    const endpoint = localEndpoint(this.config.localLlmBaseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.localLlmTimeoutMs);
    this.activeRequests += 1;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: this.config.localLlmModel,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: sourceText },
          ],
          temperature: this.config.localLlmTemperature,
          top_p: 0.8,
          top_k: 20,
          min_p: 0,
          seed: 2026,
          max_tokens: Math.min(this.config.localLlmMaxOutputTokens, 700),
          stream: true,
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: 'none',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'legislative_plain_language',
              strict: true,
              schema: legislativeExplanationJsonSchema,
            },
          },
        }),
      });
      if (!response.ok) {
        const message = String(await response.text()).slice(0, 500);
        throw new Error(`LLM local respondeu HTTP ${response.status}: ${message}`);
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const content = contentType.includes('text/event-stream')
        ? await streamedMessageContent(response)
        : (await response.json())?.choices?.[0]?.message?.content;
      const parsed = legislativeExplanationSchema.parse(parseJsonContent(content));
      let explanation = parsed;
      try {
        assertNoUnsupportedNumbers(parsed, sourceText);
      } catch (error) {
        if (!/número não sustentado/iu.test(error.message)) throw error;
        explanation = deterministicLegislativeExplanation(item, sourceText);
      }
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return {
        ...explanation,
        possibleImpact: explanation.validationFallback
          ? explanation.possibleImpact
          : groundedLegislativeImpact(explanation.possibleImpact, sourceText, item),
        finePrint: legislativeFinePrint(item),
      };
    } catch (error) {
      const normalized = error.name === 'AbortError'
        ? new Error('Tempo limite ao consultar a LLM local.')
        : error;
      this.lastErrorAt = new Date().toISOString();
      this.lastError = normalized.message;
      throw normalized;
    } finally {
      clearTimeout(timeout);
      this.activeRequests -= 1;
    }
  }
}

module.exports = {
  LocalLlmClient,
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
  LEGISLATIVE_LLM_ANALYSIS_VERSION,
  DOCUMENT_QA_PROMPT_VERSION,
  LEGISLATIVE_LLM_PROMPT_VERSION,
  llmResponseSchema,
  legislativeExplanationSchema,
  deterministicLegislativeExplanation,
  localEndpoint,
  finishOfficialAnswer,
  polishOfficialAnswer,
};
