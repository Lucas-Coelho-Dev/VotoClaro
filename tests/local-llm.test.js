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
              proposals: [{
                theme: 'educacao',
                title: 'Ensino em tempo integral',
                summary: 'Ampliação do ensino em tempo integral conforme o documento oficial.',
                evidences: [{ page: 3, quote: 'Vamos ampliar o ensino em tempo integral para estudantes da rede pública.' }],
                audience: ['estudantes'],
                requirements: ['infraestrutura'],
                risks: ['capacidade de execução'],
                indicators: ['matrículas'],
                missingInformation: ['custo'],
                fourYearScenario: {
                  firstYear: 'Planejamento da execução.',
                  yearsTwoAndThree: 'Implementação condicionada aos recursos.',
                  fourthYear: 'Consolidação condicionada à continuidade.',
                  potentialImpact: 'Possível ampliação do atendimento.',
                },
              }],
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
    localLlmModel: 'qwen3-4b-local',
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
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].theme, 'educacao');
  assert.equal(received.model, 'qwen3-4b-local');
  assert.equal(received.response_format.type, 'json_schema');
  assert.equal(received.chat_template_kwargs.enable_thinking, false);
  assert.equal(received.reasoning_effort, 'none');
  assert.equal(received.seed, 2026);
  assert.match(received.messages[0].content, /não avalie o candidato/i);
  assert.equal(client.getStatus().serverReadyAt !== null, true);
  assert.equal(client.getStatus().lastSuccessAt !== null, true);
});

test('bloqueia envio do plano para um endereço público', () => {
  assert.throws(
    () => localEndpoint('https://api.externa.example/v1'),
    /somente um servidor local ou uma rede privada/i,
  );
  assert.equal(localEndpoint('http://llm:8080/v1').hostname, 'llm');
  assert.equal(localEndpoint('http://192.168.1.10:8080/v1').hostname, '192.168.1.10');
});
