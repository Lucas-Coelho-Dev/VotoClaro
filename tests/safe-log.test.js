const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLogValue, safeErrorMessage } = require('../src/safe-log');

test('remove credenciais, CPF, e-mail e parâmetros de URLs dos logs', () => {
  const clean = sanitizeLogValue('Bearer segredo.123 CPF 123.456.789-00 lucas@example.com https://fonte.test/item?token=abc&q=nome');
  assert.doesNotMatch(clean, /segredo|123\.456|lucas@example|token=abc|q=nome/);
  assert.match(clean, /REDACTED/);
});

test('mensagem segura não serializa pilha nem propriedades do erro', () => {
  const error = new Error('falhou para https://api.test/recurso?key=privada');
  error.privatePayload = { cpf: '12345678900' };
  const clean = safeErrorMessage(error);
  assert.doesNotMatch(clean, /privada|privatePayload|12345678900/);
});
