# Implantação do VotoClaro 2.0

## Escolha rápida

- **Teste público sem mensalidade:** siga [DEPLOY_FREE.md](DEPLOY_FREE.md). A configuração usa Oracle Cloud Always Free, disco persistente, Docker Compose e Caddy com HTTPS.
- **Produção gerenciada paga:** Render com serviço contínuo, PostgreSQL e armazenamento dimensionado para snapshots e fotos.
- **Serverless:** exige banco externo e um sincronizador contínuo; a importação nacional não deve depender do sistema de arquivos temporário da função.

O plano gratuito do Render não é indicado para o VotoClaro: o serviço suspende por inatividade, o sistema de arquivos local não é persistente e o PostgreSQL gratuito tem prazo limitado. O `render.yaml` existente descreve deliberadamente recursos pagos.

## Requisitos de produção

- Node.js 20 ou Docker;
- armazenamento persistente com backup, em PostgreSQL ou `DATA_DIR`;
- espaço para snapshots e fotos oficiais;
- HTTPS, necessário também para localização em celulares;
- segredo de sincronização com alta entropia;
- sincronizador contínuo capaz de atualizar a base oficial várias vezes ao dia;
- monitoramento de `/api/v1/health`;
- CPU e memória suficientes para importar arquivos nacionais e ler PDFs.

Não use `database.json`. A versão 2 não armazena usuários nem colinhas no servidor.

## Render pago

O `render.yaml` descreve um serviço Node e um PostgreSQL pagos. Ao criar o Blueprint:

1. conecte o repositório;
2. confirme serviço e banco persistentes;
3. defina `PUBLIC_BASE_URL` com o domínio final;
4. cadastre `PORTAL_TRANSPARENCIA_TOKEN` somente como segredo, se quiser habilitar CEIS, CNEP e CEAF;
5. publique e confirme `/api/v1/health`;
6. dimensione o banco considerando fotos e snapshots retidos.

## Vercel

O `vercel.json` contém a função Express e o agendamento, mas PostgreSQL externo é obrigatório. Configure `DATABASE_URL`, `DATABASE_SSL=true`, `CRON_SECRET`, `SYNC_ON_START=false`, `SYNC_PHOTOS=true`, `PUBLIC_BASE_URL` e `NODE_ENV=production`.

Antes de usar Vercel, confirme que duração e volume da importação nacional cabem no plano. O caminho mais seguro é manter o frontend serverless e executar a sincronização em um worker contínuo.

## Checklist antes de lançar

1. Execute `npm ci`, `npm run check` e `npm test`.
2. Execute a primeira sincronização e confirme candidatos e fotos em `/api/v1/health`.
3. Teste busca, filtro de UF combinado com faixa partidária, detalhe, comparação e colinha.
4. Confirme fotos e identificações partidárias em UFs e partidos diferentes.
5. Teste localização em um celular usando o domínio HTTPS.
6. Abra planos de governo, projetos e integridade e confira todos os links oficiais.
7. Preencha responsável e canal de privacidade em `public/privacy.html`.
8. Confirme que segredos, tokens e identificadores pessoais não aparecem no frontend, logs ou repositório.
9. Configure backup e monitore idade, checksum e contagens de `/api/v1/health`.

## Cache e rollback

Force HTTPS e HSTS, não coloque segredos no frontend e mantenha respostas públicas com o cache previsto pela aplicação. Em falha de fonte, o VotoClaro conserva o último snapshot válido. Um rollback de código não deve apagar snapshots, execuções, fotos nem contagens agregadas.

## Serviços separados na Oracle

O `compose.free.yml` mantém seis responsabilidades isoladas: `app` serve o site e a API; `db` mantém o PostgreSQL; `llm` executa o modelo; `ai-worker` prepara resumos e explicações; `sync-worker` atualiza as fontes oficiais; e `caddy` termina HTTPS e encaminha o tráfego. O site continua respondendo enquanto a IA ou a importação usam CPU intensivamente.

O sincronizador publica uma nova versão somente depois de concluir e validar o conjunto principal de candidaturas. Se bens, fotos ou prestações de contas falharem, mantém-se o último conjunto válido daquela fonte e o painel público registra o alerta, a tentativa e o último sucesso.
