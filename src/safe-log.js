function sanitizeLogValue(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/([?&](?:api_?key|authorization|cpf|key|secret|token)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[QUERY REDACTED]')
    .slice(0, 2000);
}

function safeErrorMessage(error) {
  const name = sanitizeLogValue(error?.name || 'Error');
  const message = sanitizeLogValue(error?.message || error || 'Falha sem mensagem');
  return `${name}: ${message}`;
}

module.exports = { sanitizeLogValue, safeErrorMessage };
