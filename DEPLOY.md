# Implantação do VotoClaro 2.0

## Requisitos de produção

- Node.js 20+
- PostgreSQL com backup
- HTTPS
- segredo de sincronização com alta entropia
- processo contínuo ou agendador capaz de executar a importação a cada duas horas
- monitoramento de `/api/v1/health`
- espaço para as fotos oficiais: PostgreSQL ou diretório persistente em `DATA_DIR`
- CPU e memória suficientes para a primeira extração de cada PDF; os resumos seguintes usam cache por checksum
- saída HTTPS obrigatória para que navegadores móveis autorizem a localização

Não use `database.json`. A versão 2 não armazena usuários nem colinhas no servidor.

## Opção recomendada: Render

O arquivo `render.yaml` descreve um serviço Node e um PostgreSQL. No Render:

1. conecte o repositório;
2. crie um Blueprint a partir de `render.yaml`;
3. confirme a criação do banco;
4. defina `PUBLIC_BASE_URL` com o domínio final;
5. solicite a chave gratuita do Portal da Transparência e cadastre-a somente como segredo `PORTAL_TRANSPARENCIA_TOKEN` para habilitar CEIS, CNEP e CEAF;
6. publique;
7. abra `/api/v1/health` e confirme `status: OK`.

O processo executa uma sincronização ao iniciar e depois a cada 120 minutos. O PostgreSQL guarda as últimas versões e os registros de execução.
As fotos oficiais são importadas por UF e armazenadas na tabela `candidate_photos`. Dimensione o banco com folga para os retratos e snapshots retidos.

## Vercel

O `vercel.json` contém a função Express, arquivos estáticos e um cron a cada duas horas. Configure:

- `DATABASE_URL`
- `DATABASE_SSL=true`
- `CRON_SECRET`
- `SYNC_ON_START=false`
- `SYNC_PHOTOS=true`
- `PUBLIC_BASE_URL=https://seu-dominio`
- `NODE_ENV=production`
- `INTEGRITY_TIMEOUT_MS=30000`
- `INTEGRITY_RETRY_COUNT=1`
- `INTEGRITY_ERROR_CACHE_TTL_SECONDS=300`
- `PORTAL_TRANSPARENCIA_TOKEN=<segredo opcional>`

O cron da Vercel acessa `/api/v1/admin/sync` com `CRON_SECRET`. O PostgreSQL é obrigatório porque o sistema de arquivos serverless não persiste snapshots.

Antes de usar Vercel em produção, verifique se o tamanho e a duração da importação nacional, incluindo os arquivos de fotos por UF, cabem nos limites do plano. A opção mais segura é manter o frontend na Vercel e executar o sincronizador em um worker contínuo.

## Migração do banco

A aplicação cria as tabelas automaticamente ao iniciar. Também é possível validar a conexão:

```bash
npm run db:migrate
```

O SQL equivalente está em `migrations/001_public_data.sql`.

## Primeira publicação

1. Configure as variáveis de ambiente.
2. Execute `npm ci`.
3. Execute `npm run check` e `npm test`.
4. Execute `npm run sync`.
5. Inicie com `npm start`.
6. Confirme página, busca, detalhe, fontes, alterações e colinha local.
7. Confirme que `/api/v1/health` informa `photoCount` e abra fotos de candidaturas de UFs diferentes.
8. Verifique que `/api/candidates`, `/api/auth/*` e `/api/colinha` não expõem a API antiga.
9. Revise `privacy.html` com responsável e contato reais.
10. Em um celular no domínio HTTPS, autorize a localização e confirme que apenas a UF foi aplicada ao filtro.
11. Abra um plano de governo e uma comparação legislativa; confirme os links oficiais e as mensagens de indisponibilidade.
12. Confirme que o resumo mostra nove temas, trechos, seções/páginas de origem e o aviso de que não avalia viabilidade.
13. Abra uma ficha e confirme que a área de integridade mostra TCU, valores do TSE e o estado do Portal da Transparência, sem CPF, nota ou presunção de culpa.
14. Inspecione as respostas, snapshots e logs e confirme que o CPF oficial usado no vínculo não foi persistido ou retornado.

## Domínio e cache

- force HTTPS e HSTS;
- mantenha a API atrás de CDN sem armazenar respostas privadas — atualmente não há rotas privadas;
- respostas de candidatura têm cache curto e `stale-while-revalidate`;
- nunca coloque `SYNC_SECRET`, `CRON_SECRET` ou `DATABASE_URL` no frontend.
- nunca coloque `PORTAL_TRANSPARENCIA_TOKEN` no frontend; o navegador acessa somente a rota intermediada pelo VotoClaro.

## Voltar uma versão

Os snapshots são imutáveis no PostgreSQL. Em uma falha de fonte, a aplicação conserva o último snapshot válido. Um rollback de código não deve apagar `data_snapshots` ou `sync_runs`.
