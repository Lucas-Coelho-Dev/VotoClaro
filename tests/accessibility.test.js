const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'official.html'), 'utf8');
const errorHtml = fs.readFileSync(path.join(publicDir, 'error.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'official.css'), 'utf8');

test('página principal mantém estrutura mínima para leitor de tela e celulares', () => {
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(html, /class="skip-link" href="#conteudo"/);
  assert.match(html, /<main id="conteudo">/);
  assert.match(html, /<dialog[^>]+aria-label="Detalhes da candidatura"/);
  assert.match(html, /aria-live="polite"/);
});

test('CSS oferece foco visível, redução de movimento, áreas de toque e safe area', () => {
  assert.match(css, /:focus-visible\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /font-size:\s*16px/);
});

test('página de erro é responsiva, acessível e não usa script embutido', () => {
  assert.match(errorHtml, /<html lang="pt-BR">/);
  assert.match(errorHtml, /aria-labelledby="errorTitle"/);
  assert.match(errorHtml, /href="\/"/);
  assert.doesNotMatch(errorHtml, /onclick=|<script/i);
});
