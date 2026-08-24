# VotoClaro 2.0 — Eleições 2026 com fonte

Portal de transparência eleitoral que importa publicações oficiais, preserva a procedência de cada registro e mostra indisponibilidade em vez de estimar informações ausentes.

## Compromissos

- Candidaturas, fotos, bens e redes sociais vêm do conjunto oficial **Candidatos 2026** do TSE.
- Fotos são importadas dos arquivos JPEG diários por UF e associadas somente pelo `SQ_CANDIDATO`; a silhueta genérica da URL individual não é publicada como retrato.
- Cada versão recebe horário de origem, horário de importação e checksum SHA-256.
- Mudanças entre versões são registradas.
- Dados simulados, números aleatórios, processos fictícios e notas automáticas não são publicados.
- A colinha eleitoral fica somente no navegador e não exige cadastro.
- A busca publica somente os seis tipos de escolha direta da urna: deputado federal, deputado estadual/distrital, duas vagas de senador, governador e presidente. Vice e suplentes ficam dentro da chapa do titular.
- O vínculo da chapa exige coincidência exata de eleição, unidade eleitoral, número e cargo relacionado; pesquisar o nome de um vice ou suplente retorna o titular correspondente.
- O ícone partidário da interface é uma identificação visual formada pela sigla, número e cores de referência de cada legenda, sem se apresentar como reprodução do logotipo oficial.
- Cada cartão usa essa identificação como uma imagem SVG pequena, legível e consistente, inclusive em celular.
- O filtro de faixa ideológica usa uma pesquisa acadêmica com especialistas e classifica o partido — nunca a pessoa candidata. A opção “centro” é uma faixa ampla que reúne centro-esquerda, centro e centro-direita; partidos sem nota própria ficam sem classificação.
- A interface é responsiva para celulares a partir de 320 px, com navegação inferior, áreas de toque ampliadas e tabelas roláveis.
- A localização é opcional, identifica a UF no navegador com a malha oficial do IBGE e não envia nem armazena latitude ou longitude.
- Planos de governo do TSE e até cinco projetos legislativos oficiais podem ser comparados sem notas ou recomendações automáticas.
- A área de fiscalização consulta TCU e, com credencial oficial, CEIS/CNEP/CEAF por identificador exato; exibe o estágio publicado e nunca cria nota, ranking ou presunção de culpa.
- PDFs de plano de governo recebem leitura automática em nove temas fixos — incluindo segurança pública e combate ao crime organizado. A leitura determinística percorre o documento, seleciona trechos representativos e a IA local explica o objetivo central e até três prioridades, sempre com página e citação validadas. Os demais trechos continuam visíveis sem reescrita.
- A página inicial mostra até seis candidaturas mais consultadas por contagem agregada, sem tratar popularidade como apoio ou recomendação; a faixa some ao iniciar uma busca.
- CPF do visitante, endereço e preferência eleitoral não são armazenados no servidor. O CPF público da candidatura é usado somente em memória para consultas oficiais exatas e nunca entra no snapshot, banco público, logs ou navegador.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm ci
npm start
```

Abra `http://localhost:3000`. Na primeira inicialização, o servidor baixa os arquivos oficiais do TSE. Enquanto a sincronização ocorre, a interface mostra que os dados ainda não estão prontos.

Para disponibilizar uma versão temporária de teste usando somente o GitHub,
consulte [CODESPACES.md](CODESPACES.md). O Codespace instala o projeto, prepara
a base pública inicial e encaminha a porta 3000 automaticamente.

Para sincronizar manualmente:

```bash
npm run sync
```

Para atualizar somente as fotos oficiais, mantendo o snapshot eleitoral atual:

```bash
npm run sync:photos
```

Sem `DATABASE_URL`, somente dados públicos são armazenados em `data/latest.json`. Essa opção é apropriada para desenvolvimento. Em produção, configure PostgreSQL.

### IA local para planos de governo

A IA é opcional no desenvolvimento e habilitada pelo `compose.free.yml` na hospedagem recomendada. O modelo Qwen3 4B quantizado é executado pelo `llama.cpp` dentro da própria VM; nenhum texto do PDF é enviado para uma API externa e não há cobrança por chamada. O processamento ocorre em fila, uma análise por vez, com resposta transmitida continuamente para evitar quedas em gerações longas. O resultado fica no PostgreSQL e no cache persistente pelo checksum do documento.

O sistema extrativo continua sendo o fallback imediato. A IA recebe somente um conjunto curto de evidências selecionadas nos nove temas, produz um objetivo central e explica até três prioridades em linguagem simples. Possíveis impactos em quatro anos são qualitativos, condicionais e separados do conteúdo oficial. Citações precisam existir na página indicada, a classificação temática precisa coincidir com a leitura documental e números gerados que não constem nas evidências são descartados. A interface acompanha o processamento e atualiza o resultado automaticamente.

## Rotas públicas

| Rota | Finalidade |
|---|---|
| `GET /api/v1/health` | Saúde, idade e checksum da base |
| `GET /api/v1/sources` | Fontes, conectores e execuções |
| `GET /api/v1/filters` | Cargos, UFs, partidos e faixas ideológicas disponíveis |
| `GET /api/v1/parties/:party/mark.svg` | Identificação visual neutra do partido em SVG |
| `GET /api/v1/popular-candidates` | Ranking agregado e metodologia dos mais consultados |
| `GET /api/v1/geography/states` | Malhas oficiais das UFs, sem receber coordenadas |
| `GET /api/v1/candidates` | Busca paginada de candidaturas |
| `GET /api/v1/candidates/:id` | Registro completo com proveniência |
| `POST /api/v1/candidates/:id/view` | Soma uma abertura agregada da ficha, com limite contra abuso |
| `GET /api/v1/candidates/:id/photo` | Foto JPEG oficial com cache e ETag |
| `GET /api/v1/candidates/:id/government-plan/status` | Disponibilidade do plano oficial associado pelo identificador |
| `GET /api/v1/candidates/:id/government-plan` | PDF oficial de proposta de governo |
| `GET /api/v1/candidates/:id/government-plan/summary` | Propostas por tema, evidências, análise local e cenário condicional quando disponível |
| `GET /api/v1/candidates/:id/legislative` | Até cinco projetos recentes do mandato atual verificado |
| `GET /api/v1/candidates/:id/integrity` | TCU, sanções administrativas, valores eleitorais e despesas parlamentares por vínculo exato |
| `GET /api/v1/changes` | Alterações detectadas entre versões |
| `GET/POST /api/v1/admin/sync` | Sincronização protegida por segredo |

Filtros de candidaturas: `q`, `office`, `uf`, `party`, `ideology`, `status`, `page` e `pageSize`. `ideology` aceita `ESQUERDA`, `CENTRO`, `DIREITA` e `NAO_CLASSIFICADO`. Consulte a [metodologia da classificação partidária](public/methodology.html#ideologia-partidaria).

## Fontes ativas

- TSE — Candidatos 2026
- TSE — Bens de candidatos 2026
- TSE — Redes sociais declaradas 2026
- TSE — Fotos oficiais de candidatos 2026, publicadas por UF
- TSE — Propostas de governo 2026 para presidente e governador
- TSE — Receitas e despesas 2026, quando os arquivos estiverem publicados
- Câmara dos Deputados — parlamentares em exercício e atividade consultada sob demanda
- Senado Federal — senadores em exercício e perfil consultado sob demanda
- IBGE — malhas territoriais estaduais usadas localmente para identificar a UF
- TCU — contas irregulares, possível implicação eleitoral, inabilitação e inidoneidade
- Portal da Transparência — CEIS, CNEP e CEAF quando `PORTAL_TRANSPARENCIA_TOKEN` estiver configurado

Vínculos legislativos só são publicados quando nome de urna, UF e partido coincidem exatamente entre as fontes oficiais. TCU e Portal da Transparência são consultados pelo CPF oficial completo mantido apenas na memória do servidor; respostas sem o mesmo identificador são descartadas. CNJ e Google Fact Check permanecem planejados até existir integração que preserve identificação inequívoca, estágio processual e revisão compatível.

## Estrutura

```text
api/                  entrada serverless
data/                 cache local ignorado pelo Git
migrations/           esquema PostgreSQL
public/               portal, metodologia e privacidade
scripts/              sincronização e migração
src/
  app.js              API e segurança HTTP
  parties.js          números, imagem SVG e classificação acadêmica dos partidos
  config.js           configuração por ambiente
  normalize.js        transformação sem dados pessoais
  geography.js        malhas oficiais e validação das 27 UFs
  government-plans.js planos do TSE associados por SQ_CANDIDATO
  plan-summary.js      extração do PDF e classificação neutra em nove temas fixos
  local-llm.js         cliente privado do servidor llama.cpp e resposta estruturada
  plan-llm-analysis.js seleção de evidências, validação temática e impactos condicionais
  legislative.js      projetos oficiais e evidência de situação legal
  integrity.js         consultas oficiais exatas, cache, estágios e remoção de identificadores
  official-sync.js    importação dos pacotes oficiais
  photo-sync.js       fotos oficiais por UF e vínculo por SQ_CANDIDATO
  persistence.js      PostgreSQL ou cache local
  sources.js          catálogo e política das fontes
tests/                 testes de normalização e privacidade
```

Os arquivos antigos `server.js` e `public/index.html` foram removidos: continham o protótipo com dados simulados e uma integração secundária que não atendia à política atual de identificação exata.

## Verificações

```bash
npm run check
npm test
npm audit
```

## Produção

Para testar publicamente sem mensalidade, consulte [DEPLOY_FREE.md](DEPLOY_FREE.md): Oracle Cloud Always Free, armazenamento persistente, Docker Compose e HTTPS automático. As alternativas pagas e os cuidados de produção ficam em [DEPLOY.md](DEPLOY.md) e [OPERATIONS.md](OPERATIONS.md). Antes do lançamento, preencha o responsável e o canal de privacidade em `public/privacy.html`.

## Licença e atribuição

Os dados e retratos do TSE são publicados sob Creative Commons Attribution. A interface deve manter atribuição e links para a publicação original. O VotoClaro é independente e não representa a Justiça Eleitoral, partidos ou candidaturas.

Consulte [docs/INTEGRITY_INTEGRATION.md](docs/INTEGRITY_INTEGRATION.md) antes de habilitar o Portal da Transparência ou alterar as regras de correspondência e publicação.
