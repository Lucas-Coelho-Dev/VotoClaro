function auditElement(name, text) {
  const element = document.createElement(name);
  element.textContent = text;
  return element;
}

function appendList(host, title, values) {
  host.append(auditElement('h2', title));
  const list = document.createElement('ul');
  list.className = 'principle-list';
  values.forEach((value) => list.append(auditElement('li', value)));
  host.append(list);
}

function analysisBlock(host, title, analysis) {
  host.append(auditElement('h2', title));
  const list = document.createElement('ul');
  list.className = 'principle-list';
  [
    `Versão da análise: ${analysis.analysisVersion}`,
    `Versão do prompt: ${analysis.promptVersion}`,
    `Documentos usados: ${analysis.documents.join('; ')}`,
  ].forEach((value) => list.append(auditElement('li', value)));
  host.append(list);
}

async function loadAudit() {
  const host = document.getElementById('aiAudit');
  try {
    const response = await fetch('/api/v1/ai/methodology', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Falha ao consultar a auditoria');
    const data = await response.json();
    host.replaceChildren();
    host.append(auditElement('h2', 'Modelo em uso'));
    host.append(auditElement('p', `${data.model} · configuração consultada em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(data.generatedAt))}.`));
    analysisBlock(host, 'Planos de governo', data.analyses.governmentPlans);
    analysisBlock(host, 'Leis e projetos', data.analyses.legislativeItems);
    appendList(host, 'Validações aplicadas', data.validations);
    appendList(host, 'Limitações conhecidas', data.limitations);
    host.append(auditElement('h2', 'Histórico de correções'));
    const history = document.createElement('ul');
    history.className = 'principle-list';
    data.correctionHistory.forEach((entry) => history.append(auditElement('li', `${entry.date} · ${entry.version}: ${entry.change}`)));
    host.append(history);
    const stats = data.statistics || {};
    host.append(auditElement('h2', 'Registros de execução e revisão'));
    const openReports = (stats.correctionReports || []).reduce((total, item) => total + Number(item.count || 0), 0);
    host.append(auditElement('p', `${openReports} relato(s) de correção registrado(s). Os dados individuais dos relatos não são publicados nesta página.`));
  } catch {
    host.replaceChildren(auditElement('p', 'A configuração da IA não pôde ser carregada agora. Tente novamente em instantes.'));
  }
}

loadAudit();
