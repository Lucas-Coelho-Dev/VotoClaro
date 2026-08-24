const { z } = require('zod');

const LOCAL_LLM_ANALYSIS_VERSION = 'local-llm-v14';
const LOCAL_LLM_PROMPT_VERSION = 'government-plan-theme-digest-v14';

const objectiveSchema = z.object({
  summary: z.string().trim().min(30).max(180),
  evidenceThemes: z.array(z.string().trim().min(1).max(80)).min(1).max(2),
});

const themeDigestSchema = z.object({
  summary: z.string().trim().min(30).max(140),
  potentialImpact: z.string().trim().min(15).max(80),
});

const llmResponseSchema = z.object({
  objective: objectiveSchema,
  themeDigests: z.record(z.string(), themeDigestSchema),
});

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
          required: ['summary', 'potentialImpact'],
          properties: {
            summary: { type: 'string', minLength: 30, maxLength: 140 },
            potentialImpact: { type: 'string', minLength: 15, maxLength: 80 },
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

  async analyzeChunk(chunk, context = {}) {
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
      'No summary, não escreva o nome nem introduções; comece diretamente com um verbo no infinitivo que resuma as ações.',
      'Não repita os trechos literalmente e não crie uma quarta proposta.',
      'Não invente números, custos, prazos, beneficiários ou resultados.',
      'Escreva para uma pessoa comum: frases curtas, concretas, enriquecedoras e sem jargão.',
      'Cada summary deve ter no máximo 110 caracteres e terminar com ponto final.',
      'No potentialImpact, não repita a proposta nem o nome; comece com um verbo no infinitivo e descreva somente o efeito possível.',
      'Cada potentialImpact deve ter no máximo 60 caracteres e terminar com ponto final.',
      'Não use algarismos que não estejam nos trechos fornecidos.',
      'Seja conciso para cobrir todos os temas com pouco texto.',
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
}

module.exports = {
  LocalLlmClient,
  LOCAL_LLM_ANALYSIS_VERSION,
  LOCAL_LLM_PROMPT_VERSION,
  llmResponseSchema,
  localEndpoint,
};
