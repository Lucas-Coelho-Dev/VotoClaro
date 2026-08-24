const statusLabels = {
  OPEN: 'Recebido',
  REVIEWING: 'Em revisão',
  RESOLVED: 'Corrigido',
  DISMISSED: 'Encerrado sem alteração',
};

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function lookup(code) {
  const host = document.getElementById('reportStatus');
  const normalized = String(code || '').trim().toUpperCase();
  host.textContent = 'Consultando…';
  try {
    const response = await fetch(`/api/v1/reports/${encodeURIComponent(normalized)}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Relato não encontrado.');
    const report = payload.data;
    host.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = `${statusLabels[report.status] || report.status} · ${report.trackingCode}`;
    const details = document.createElement('p');
    details.textContent = `Enviado em ${formatDate(report.createdAt)} · última atualização em ${formatDate(report.updatedAt)}.`;
    host.append(title, details);
    if (report.resolutionNote) {
      const note = document.createElement('p');
      note.textContent = report.resolutionNote;
      host.append(note);
    }
  } catch (error) {
    host.textContent = error.message;
  }
}

const form = document.getElementById('reportLookup');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  lookup(form.trackingCode.value);
});
const initialCode = new URLSearchParams(window.location.search).get('code');
if (initialCode) {
  form.trackingCode.value = initialCode;
  lookup(initialCode);
}
