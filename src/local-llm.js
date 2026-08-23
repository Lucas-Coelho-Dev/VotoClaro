const { z } = require('zod');

const LOCAL_LLM_ANALYSIS_VERSION = 'local-llm-v1';
const LOCAL_LLM_PROMPT_VERSION = 'government-plan-grounded-v1';

const evidenceSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000),
  quote: z.string().trim().min(20).max(700),
});

const proposalSchema = z.object({
  theme: z.string().trim().min(1).max(80),
  title: z.string().trim().min(4).max(140),
  summary: z.string().trim().min(20).max(700),
  evidences: z.array(evidenceSchema).min(1).max(6),
  audience: z.array(z.string().trim().min(2).max(120)).max(6).default([]),
  requirements: z.array(z.string().trim().min(2).max(180)).max(6).default([]),
  risks: z.array(z.string().trim().min(2).max(180)).max(6).default([]),
  indicators: z.array(z.string().trim().min(2).max(160)).max(6).default([]),
  missingInformation: z.array(z.string().trim().min(2).max(160)).max(6).default([]),
  fourYearScenario: z.object({
    firstYear: z.string().trim().max(420).default(''),
    yearsTwoAndThree: z.string().trim().max(420).default(''),
    fourthYear: z.string().trim().max(420).default(''),
    potentialImpact: z.string().trim().max(520).default(''),
  }).default({}),
});

const llmResponseSchema = z.object({
  proposals: z.array(proposalSchema).max(18).default([]),
});

function responseJsonSchema(themeIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['proposals'],
    properties: {
      proposals: {
        type: 'array',
        maxItems: 18,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'theme', 'title', 'summary', 'evidences', 'audience', 'requirements',
            'risks', 'indicators', 'missingInformation', 'fourYearScenario',
          ],
          properties: {
            theme: { type: 'string', enum: themeIds },
            title: { type: 'string', minLength: 4, maxLength: 140 },
            summary: { type: 'string', minLength: 20, maxLength: 700 },
            evidences: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['page', 'quote'],
                properties: {
                  page: { type: 'integer', minimum: 1, maximum: 10000 },
                  quote: { type: 'string', minLength: 20, maxLength: 700 },
                },
              },
            },
            audience: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 120 } },
            requirements: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 } },
            risks: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 180 } },
            indicators: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 160 } },
            missingInformation: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 160 } },
            fourYearScenario: {
              type: 'object',
              additionalProperties: false,
              required: ['firstYear', 'yearsTwoAndThree', 'fourthYear', 'potentialImpact'],
              properties: {
                firstYear: { type: 'string', maxLength: 420 },
                yearsTwoAndThree: { type: 'string', maxLength: 420 },
                fourthYear: { type: 'string', maxLength: 420 },
                potentialImpact: { type: 'string', maxLength: 520 },
              },
            },
          },
        },
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

class LocalLlmClient {
  constructor(config, themes) {
    this.config = config;
    this.themes = themes;
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
    this.activeRequests = 0;
  }

  isEnabled() {
    return Boolean(this.config.localLlmEnabled);
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      mode: this.isEnabled() ? 'LOCAL_SERVER' : 'DISABLED',
      model: this.config.localLlmModel,
      promptVersion: LOCAL_LLM_PROMPT_VERSION,
      activeRequests: this.activeRequests,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  async analyzeChunk(chunk) {
    if (!this.isEnabled()) throw new Error('A LLM local está desabilitada.');
    const themeList = this.themes.map((theme) => `${theme.id}: ${theme.label}`).join('\n');
    const system = [
      '/no_think',
      'Você é um extrator neutro de propostas em planos de governo oficiais brasileiros.',
      'Use exclusivamente o texto fornecido. Não use conhecimento externo e não avalie o candidato.',
      'Identifique somente compromissos, ações, programas ou metas; diagnósticos isolados não são propostas.',
      'Cada proposta precisa conter ao menos uma citação literal, com a página exatamente marcada no texto.',
      'Não invente números, custos, prazos, beneficiários ou resultados.',
      'O cenário de quatro anos é condicional: descreva etapas e efeitos possíveis, nunca garantias.',
      'Quando o documento não informar custo, meta, prazo ou fonte de recursos, registre isso em missingInformation.',
      'Não use algarismos no cenário condicional que não estejam nas evidências.',
      'Responda apenas no JSON solicitado.',
    ].join(' ');
    const user = `TEMAS PERMITIDOS:\n${themeList}\n\nTEXTO OFICIAL COM MARCADORES DE PÁGINA:\n${chunk.text}`;
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
          chat_template_kwargs: { enable_thinking: false },
          reasoning_effort: 'none',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'government_plan_proposals',
              strict: true,
              schema: responseJsonSchema(this.themes.map((theme) => theme.id)),
            },
          },
        }),
      });
      if (!response.ok) {
        const message = String(await response.text()).slice(0, 500);
        throw new Error(`LLM local respondeu HTTP ${response.status}: ${message}`);
      }
      const payload = await response.json();
      const parsed = llmResponseSchema.parse(parseJsonContent(payload?.choices?.[0]?.message?.content));
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return parsed;
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
  llmResponseSchema,
  localEndpoint,
};
