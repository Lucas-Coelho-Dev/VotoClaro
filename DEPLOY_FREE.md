# Publicar o VotoClaro sem mensalidade

## Caminho recomendado

Para testes públicos com dados, fotos e atualizações persistentes, a opção de menor custo é uma VM **Always Free Ampere A1 da Oracle Cloud**, com Docker Compose, PostgreSQL e Caddy. O VotoClaro, seu banco de dados e o HTTPS ficam na mesma máquina.

O caminho usa:

- Oracle Cloud Always Free para computação e disco persistente;
- Docker Compose para executar a aplicação;
- PostgreSQL para guardar snapshots, fotos, análises e contagens sem baixar tudo a cada abertura;
- Qwen3 4B quantizado com `llama.cpp` para analisar os PDFs dentro da própria máquina;
- Caddy para HTTPS automático;
- `sslip.io` para um endereço gratuito imediato, ou DuckDNS para um nome estável.

Não há mensalidade enquanto os recursos permanecerem dentro da franquia Always Free. A Oracle informa que instâncias consideradas ociosas podem ser recuperadas; portanto, faça backup e acompanhe o painel da conta.

## Por que não usar Render Free para este portal

O serviço web gratuito do Render entra em suspensão após inatividade e perde o sistema de arquivos local ao suspender, reiniciar ou publicar uma nova versão. Disco persistente não está disponível no plano gratuito, e o PostgreSQL gratuito expira após 30 dias. Isso não combina com os snapshots, fotos oficiais e a sincronização nacional do VotoClaro.

## 1. Criar a máquina gratuita

1. Crie uma conta na Oracle Cloud e escolha uma região principal com capacidade Ampere disponível.
2. Crie uma VM Ubuntu Ampere A1 marcada como **Always Free eligible**. Para executar também a IA local, use 2 OCPUs e 12 GB de memória, respeitando a franquia Always Free mostrada na sua conta.
3. Reserve um IP público.
4. Nas regras de entrada da rede, libere TCP 80 e 443 para a internet. Restrinja a porta 22 ao seu IP sempre que possível.
5. Guarde a chave SSH e confirme que consegue entrar na VM.

Referência oficial: [recursos Always Free da Oracle Cloud](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

## 2. Instalar Docker e baixar o projeto

Na VM, instale Docker Engine e o plugin Docker Compose conforme o [guia oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Depois, clone o repositório:

```bash
git clone https://github.com/Lucas-Coelho-Dev/VotoClaro.git
cd VotoClaro
cp .env.free.example .env.free
mkdir -p data-production
sudo chown -R 1000:1000 data-production
```

## 3. Definir endereço e segredos

Descubra o IP público. Se ele for `203.0.113.10`, use no arquivo `.env.free`:

```dotenv
SITE_HOST=votoclaro.203-0-113-10.sslip.io
POSTGRES_PASSWORD=uma-senha-longa-e-exclusiva-para-o-banco
SYNC_SECRET=um-valor-longo-unico-e-aleatorio
CRON_SECRET=outro-valor-longo-unico-e-aleatorio
```

O `sslip.io` direciona gratuitamente nomes contendo o IP para esse IP. Para um endereço que continue igual se o IP mudar, crie um subdomínio no [DuckDNS](https://www.duckdns.org/) e coloque esse domínio em `SITE_HOST`.

O Caddy obtém e renova o certificado HTTPS automaticamente quando o nome resolve para a VM e as portas 80 e 443 estão acessíveis. HTTPS é necessário para a localização funcionar nos celulares.

## 4. Iniciar

```bash
docker compose --env-file .env.free -f compose.free.yml up -d --build
docker compose --env-file .env.free -f compose.free.yml logs -f app
```

Na primeira inicialização, o serviço `llm` também baixa aproximadamente 2,5 GB do modelo Qwen3 4B para o volume persistente `llm_models`. Esse download não se repete em reinicializações normais. O aplicativo espera o teste de saúde do modelo ficar pronto antes de iniciar a fila de análises. Para acompanhar:

```bash
docker compose --env-file .env.free -f compose.free.yml logs -f llm
```

Somente a primeira inicialização de um banco vazio faz a importação nacional e o download de fotos. O PostgreSQL preserva essa base; reinícios e novos acessos não repetem o download. Antes de divulgar o endereço, aguarde essa carga inicial e abra:

```text
https://SEU_SITE/api/v1/health
```

O campo `status` deve chegar a `OK`, e `candidateCount` e `photoCount` devem ser maiores que zero. Em `localPlanAnalysis`, confirme `enabled: true`; `lastSuccessAt` será preenchido depois da primeira análise concluída. Depois que os serviços estiverem prontos, o portal abre normalmente enquanto a fila trabalha.

## 5. Atualizar e fazer backup

Para publicar uma nova versão:

```bash
git pull --ff-only
docker compose --env-file .env.free -f compose.free.yml up -d --build
```

O volume `postgres_data` contém snapshots, fotos, análises de planos e contagens agregadas. O volume `llm_models` guarda o modelo, e o diretório `data-production` mantém os caches auxiliares. Faça backup periódico do banco e dos caches; o modelo pode ser baixado novamente. Para o banco, use `pg_dump`, que preserva a consistência sem precisar desligar o site.

## Limites e próximos passos

- O Always Free depende de capacidade disponível na região e das regras vigentes da Oracle.
- Instâncias ociosas podem ser recuperadas pela Oracle; mantenha backups fora da VM.
- `sslip.io` é ótimo para teste, mas um domínio próprio transmite mais confiança no lançamento.
- Se o acesso crescer, monitore disco, memória, tempo de sincronização e `/api/v1/health` antes de contratar recursos.
- A análise local usa CPU intensivamente, mas roda com concorrência de um documento e não é executada durante cada acesso do visitante.
- Nunca envie `.env.free`, chaves SSH ou tokens para o GitHub.

Fontes: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Render Free](https://render.com/docs/free), [HTTPS automático do Caddy](https://caddyserver.com/docs/automatic-https) e [sslip.io](https://sslip.io/).
