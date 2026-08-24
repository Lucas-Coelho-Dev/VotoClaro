const { z } = require('zod');

const LOCAL_LLM_ANALYSIS_VERSION = 'local-llm-v7';
const LOCAL_LLM_PROMPT_VERSION = 'government-plan-evidence-explainer-v7';

const evidenceSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000),
  quote: z.string().trim().min(20).max(420),
});

const objectiveSchema = z.object({
  summary: z.string().trim().min(30).max(360),
  evidences: z.array(evidenceSchema).min(1).max(2),
});

const proposalSchema = z.object({
  theme: z.string().trim().min(1).max(80),
  title: z.string().trim().min(4).max(100),
  summary: z.string().trim().min(20).max(320),
  evidences: z.array(evidenceSchema).min(1).max(1),
  audience: z.array(z.string().trim().min(2).max(100)).max(2).default([]),
  requirements: z.array(z.string().trim().min(2).max(140)).max(2).default([]),
  missingInformation: z.array(z.string().trim().min(2).max(120)).max(2).default([]),
  potentialImpact: z.string().trim().max(280).default(''),
});

const llmResponseSchema = z.object({
  objective: objectiveSchema,
  proposals: z.array(proposalSchema).max(3).default([]),
});

function responseJsonSchema(themeIds) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['objective', 'proposals'],
    properties: {
      objective: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'evidences'],
        properties: {
          summary: { type: 'string', minLength: 30, maxLength: 360 },
          evidences: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['page', 'quote'],
              properties: {
                page: { type: 'integer', minimum: 1, maximum: 10000 },
                quote: { type: 'string', minLength: 20, maxLength: 420 },
              },
            },
          },
        },
      },
      proposals: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'theme', 'title', 'summary', 'evidences', 'audience', 'requirements',
            'missingInformation', 'potentialImpact',
          ],
          properties: {
            theme: { type: 'string', enum: themeIds },
            title: { type: 'string', minLength: 4, maxLength: 100 },
            summary: { type: 'string', minLength: 20, maxLength: 320 },
            evidences: {
              type: 'array',
              minItems: 1,
              maxItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['page', 'quote'],
                properties: {
                  page: { type: 'integer', minimum: 1, maximum: 10000 },
                  quote: { type: 'string', minLength: 20, maxLength: 420 },
                },
              },
            },
            audience: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 100 } },
            requirements: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 140 } },
            missingInformation: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 120 } },
            potentialImpact: { type: 'string', maxLength: 280 },
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  async analyzeChunk(chunk) {
    if (!this.isEnabled()) throw new Error('A LLM local está desabilitada.');
    const themeList = this.themes.map((theme) => `${theme.id}: ${theme.label}`).join('\n');
    const system = [
      '/no_think',
      'Você é um explicador neutro de planos de governo oficiais brasileiros.',
      'Use exclusivamente o texto fornecido. Não use conhecimento externo e não avalie o candidato.',
      'Não trate o candidato como eleito nem como governo em exercício; escreva sempre que o plano pretende ou propõe.',
      'Explique primeiro o objetivo central que conecta as prioridades recorrentes do plano.',
      'Depois selecione as três propostas mais representativas do plano, no máximo uma por tema, apenas quando houver compromisso, ação, programa ou meta.',
      'Diagnósticos, críticas e intenções genéricas isoladas não são propostas.',
      'Cada proposta precisa conter ao menos uma citação literal, com a página exatamente marcada no texto.',
      'O objetivo central também precisa de citações literais que sustentem a síntese.',
      'Não invente números, custos, prazos, beneficiários ou resultados.',
      'Escreva para uma pessoa comum: frases curtas, concretas e sem jargão.',
      'O impacto em quatro anos é condicional: descreva um efeito possível, nunca uma garantia.',
      'Quando o documento não informar custo, meta, prazo ou fonte de recursos, registre isso em missingInformation.',
      'Não use algarismos no impacto condicional que não estejam nas evidências.',
      'Seja conciso para cobrir mais temas com menos texto.',
      'Responda apenas no JSON solicitado.',
    ].join(' ');
    const user = `TEMAS PERMITIDOS:\n${themeList}\n\nEVIDÊNCIAS SELECIONADAS DO PDF OFICIAL, COM MARCADORES DE PÁGINA:\n${chunk.text}`;
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
              schema: responseJsonSchema(this.themes.map((theme) => theme.id)),
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
