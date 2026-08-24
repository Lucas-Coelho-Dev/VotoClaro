const { sanitizeLogValue, safeErrorMessage } = require('./safe-log');

const SENSITIVE_KEYS = /(?:authorization|cpf|email|password|secret|token)/i;

function safeArgument(value) {
  if (value instanceof Error) return safeErrorMessage(value);
  if (typeof value === 'string') return sanitizeLogValue(value);
  if (value && typeof value === 'object') {
    try {
      return sanitizeLogValue(JSON.stringify(value, (key, nested) => (SENSITIVE_KEYS.test(key) ? '[REDACTED]' : nested)));
    } catch {
      return '[UNSERIALIZABLE]';
    }
  }
  return value;
}

function installSafeConsole() {
  if (globalThis.__votoClaroSafeConsoleInstalled) return;
  globalThis.__votoClaroSafeConsoleInstalled = true;
  for (const method of ['log', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...values) => original(...values.map(safeArgument));
  }
}

module.exports = { installSafeConsole, safeArgument };
