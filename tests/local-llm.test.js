const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalLlmClient, localEndpoint } = require('../src/local-llm');
const { THEMES } = require('../src/plan-summary');

test('consulta somente o servidor local e exige resposta estruturada', async (context) => {
  let received;
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              objective: {
                summary: 'O plano busca ampliar serviços públicos de educação com foco no atendimento da rede.',
                evidenceThemes: ['educacao'],
              },
              themeDigests: { educacao: {
                summary: 'Segundo o plano de governo, o candidato propõe ampliar o ensino em tempo integral na rede pública.',
                potentialImpact: 'A ampliação pode aumentar o tempo diário de atendimento dos estudantes e alterar a rotina das famílias que hoje organizam trabalho e cuidado conforme o horário escolar, se houver execução, profissionais e recursos.',
                conditionsAndLimits: 'Os trechos não informam o orçamento, a quantidade de escolas alcançadas nem o cronograma de implantação.',
              } },
            }),
          },
        }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const client = new LocalLlmClient({
    localLlmEnabled: true,
    localLlmBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    localLlmModel: 'qwen3-1.7b-local',
    localLlmTimeoutMs: 5000,
    localLlmStartupWaitMs: 5000,
    localLlmMaxOutputTokens: 800,
    localLlmTemperature: 0.1,
  }, THEMES);
  await client.waitUntilReady();
  const result = await client.analyzeChunk({
    text: '<<<PÁGINA 3>>>\nVamos ampliar o ensino em tempo integral para estudantes da rede pública.',
    pages: [3],
  });
  assert.equal(result.themeDigests.length, 1);
  assert.match(result.objective.summary, /ampliar serviços públicos/i);
  assert.equal(result.themeDigests[0].theme, 'educacao');
  assert.equal(received.model, 'qwen3-1.7b-local');
  assert.equal(received.response_format.type, 'json_schema');
  assert.equal(
    received.response_format.json_schema.schema.properties.themeDigests.properties.educacao.required.includes('potentialImpact'),
    true,
  );
  assert.equal(
    received.response_format.json_schema.schema.properties.themeDigests.properties.educacao.required.includes('conditionsAndLimits'),
    true,
  );
  assert.equal(
    received.response_format.json_schema.schema.properties.themeDigests.properties.educacao.required.includes('fourYearScenario'),
    false,
  );
  assert.equal(received.chat_template_kwargs.enable_thinking, false);
  assert.equal(received.reasoning_effort, 'none');
  assert.equal(received.seed, 2026);
  assert.equal(received.stream, true);
  assert.match(received.messages[0].content, /não avalie o candidato/i);
  assert.equal(client.getStatus().serverReadyAt !== null, true);
  assert.equal(client.getStatus().lastSuccessAt !== null, true);
});

test('mantém respostas longas vivas por transmissão contínua', async (context) => {
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    request.resume();
    request.on('end', () => {
      const content = JSON.stringify({
        objective: {
          summary: 'O plano busca ampliar a educação pública com atendimento mais próximo da população.',
          evidenceThemes: ['educacao'],
        },
        themeDigests: { educacao: {
          summary: 'Segundo o plano de governo, o candidato propõe ampliar escolas e fortalecer a educação pública.',
          potentialImpact: 'A ampliação das escolas pode aproximar o atendimento educacional das famílias e mudar a rotina de estudantes e responsáveis, desde que a medida seja implementada com profissionais, estrutura e recursos.',
          conditionsAndLimits: 'Os trechos selecionados não detalham as regiões atendidas, o custo nem como o resultado educacional será medido.',
        } },
      });
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const part of [content.slice(0, 37), content.slice(37)]) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const client = new LocalLlmClient({
    localLlmEnabled: true,
    localLlmBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    localLlmModel: 'qwen3-1.7b-local',
    localLlmTimeoutMs: 5000,
    localLlmStartupWaitMs: 5000,
    localLlmMaxOutputTokens: 800,
    localLlmTemperature: 0.1,
  }, THEMES);
  const result = await client.analyzeChunk({
    text: '<<<PÁGINA 5>>>\nO programa pretende ampliar escolas e fortalecer a educação pública.',
    pages: [5],
  });
  assert.equal(result.themeDigests.length, 1);
  assert.match(result.objective.summary, /educação pública/i);
});

test('bloqueia envio do plano para um endereço público', () => {
  assert.throws(
    () => localEndpoint('https://api.externa.example/v1'),
    /somente um servidor local ou uma rede privada/i,
  );
  assert.equal(localEndpoint('http://llm:8080/v1').hostname, 'llm');
  assert.equal(localEndpoint('http://192.168.1.10:8080/v1').hostname, '192.168.1.10');
});

test('traduz a ementa legislativa em três blocos sem abandonar as ressalvas', async (context) => {
  let received;
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        plainLanguage: 'A norma organiza o atendimento prioritário descrito na ementa oficial.',
        possibleImpact: 'Pode facilitar o acesso do público alcançado, se houver execução adequada.',
        finePrint: 'A ementa não informa como a implementação será fiscalizada nem mede resultados sociais.',
      }) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const client = new LocalLlmClient({
    localLlmEnabled: true,
    localLlmBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    localLlmModel: 'qwen3-1.7b-local',
    localLlmTimeoutMs: 5000,
    localLlmMaxOutputTokens: 800,
    localLlmTemperature: 0.1,
  }, THEMES);
  const result = await client.analyzeLegislativeItem({
    title: 'PL 10/2026',
    lawTitle: 'Lei 20/2026',
    summary: 'Organiza o atendimento prioritário ao público alcançado.',
    status: 'Transformado em norma jurídica',
    authorship: { label: 'Coautoria / assinatura' },
  }, { candidateName: 'CANDIDATO TESTE' });
  assert.match(result.plainLanguage, /atendimento prioritário/i);
  assert.match(result.possibleImpact, /pode/i);
  assert.match(result.finePrint, /não encontrou avaliação pública/i);
  assert.doesNotMatch(result.possibleImpact, /facilitar o acesso/i);
  assert.equal(received.response_format.json_schema.name, 'legislative_plain_language');
  assert.match(received.messages[0].content, /Coautoria não é autoria exclusiva/i);
  const pending = await client.analyzeLegislativeItem({
    title: 'PEC sem número',
    summary: 'Propõe alterar regras administrativas.',
    status: 'Aguardando análise',
    evidence: { stage: 'PROPOSAL' },
  }, { candidateName: 'CANDIDATO TESTE' });
  assert.match(pending.possibleImpact, /Se for aprovado e implementado/i);
  assert.match(pending.finePrint, /ainda não produz efeito legal direto/i);
});
