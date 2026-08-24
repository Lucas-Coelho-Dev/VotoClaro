# Publicar o VotoClaro sem mensalidade

## Caminho recomendado

Para testes públicos com dados, fotos e atualizações persistentes, a opção de menor custo é uma VM **Always Free Ampere A1 da Oracle Cloud**, com Docker Compose, PostgreSQL e Caddy. O VotoClaro, seu banco de dados e o HTTPS ficam na mesma máquina.

O caminho usa:

- Oracle Cloud Always Free para computação e disco persistente;
- Docker Compose para executar a aplicação;
- PostgreSQL para guardar snapshots, fotos, análises e contagens sem baixar tudo a cada abertura;
- Qwen3 1.7B quantizado com `llama.cpp` para analisar os PDFs dentro da própria máquina;
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
npm run production:prepare -- --host=voto.seudominio.com.br --email=voce@example.com
sudo chown -R 1000:1000 data-production backups-production
```

## 3. Definir endereço e segredos

No registrador do domínio, crie um registro `A` apontando `voto.seudominio.com.br` para o IP público fixo da VM. Depois confirme no `.env.free`:

```dotenv
SITE_HOST=voto.seudominio.com.br
ACME_EMAIL=voce@example.com
```

Para testar antes de comprar um domínio, `votoclaro.203-0-113-10.sslip.io` continua válido como `SITE_HOST`, trocando o IP do exemplo pelo da VM.

`production:prepare` cria senhas diferentes em `secrets/` com permissão restrita. O Docker concede cada segredo somente aos serviços autorizados. Não copie essas chaves para JavaScript, HTML, `.env.free` ou GitHub. Para habilitar o Portal da Transparência, grave a chave apenas em `secrets/portal_transparencia_token.txt`.

O Caddy obtém e renova o certificado HTTPS automaticamente quando o nome resolve para a VM e as portas 80 e 443 estão acessíveis. HTTPS é necessário para a localização funcionar nos celulares.

## 4. Iniciar

```bash
docker compose --env-file .env.free -f compose.production.yml up -d --build
docker compose --env-file .env.free -f compose.production.yml logs -f app
```

Na primeira inicialização, o serviço `llm` baixa o modelo Qwen3 1.7B quantizado para o volume persistente `llm_models`. Esse download não se repete em reinicializações normais. O portal e o resumo extrativo abrem enquanto a fila aguarda o teste de saúde do modelo ficar pronto em segundo plano. Para acompanhar:

```bash
docker compose --env-file .env.free -f compose.production.yml logs -f llm
```

Somente a primeira inicialização de um banco vazio faz a importação nacional e o download de fotos. O PostgreSQL preserva essa base; reinícios e novos acessos não repetem o download. Antes de divulgar o endereço, aguarde essa carga inicial e abra:

```text
https://SEU_SITE/api/v1/health
```

O campo `status` deve chegar a `OK`, e `candidateCount` e `photoCount` devem ser maiores que zero. Em `localPlanAnalysis`, confirme `enabled: true`; o modo pode aparecer como `WAITING_FOR_SERVER` no primeiro download e `lastSuccessAt` será preenchido depois da primeira análise concluída. O portal abre normalmente enquanto a fila trabalha.

## 5. Atualizar, monitorar e recuperar

Para publicar uma nova versão:

```bash
git pull --ff-only
docker compose --env-file .env.free -f compose.production.yml up -d --build
```

Use `compose.production.yml` no comando acima. O serviço `backup-worker` cria diariamente um `pg_dump` consistente e uma cópia compactada dos resumos prontos em `backups-production`, mantém 14 dias e valida o arquivo. A cada sete dias ele restaura integralmente o último backup em um banco temporário, confere a tabela principal e remove o banco de teste. O resultado fica em `backups-production/latest-restore-test.ok`.

Para executar uma cópia ou uma restauração de teste imediatamente:

```bash
docker compose --env-file .env.free -f compose.production.yml exec backup-worker /opt/votoclaro/backup-now.sh
docker compose --env-file .env.free -f compose.production.yml exec backup-worker /opt/votoclaro/restore-test.sh
```

O `monitor-worker` consulta a saúde a cada cinco minutos, alerta com 80% de disco usado, considera o backup vencido após 30 horas e grava o último estado em seu volume. Acompanhe com:

```bash
docker compose --env-file .env.free -f compose.production.yml logs --tail=50 monitor-worker backup-worker
```

O diretório `backups-production` fica fora dos contêineres para facilitar cópia para outro local. Configure também uma cópia diária para OCI Object Storage ou outra máquina: um backup no mesmo disco não protege contra perda total da VM.

No painel da Oracle, crie um HTTP Health Check para `https://SEU_DOMINIO/api/v1/health`, com intervalo superior a 10 segundos, e alarmes para indisponibilidade. Habilite também o plugin de monitoramento da instância e alarmes de CPU, memória e disco.

## Limites e próximos passos

- O Always Free depende de capacidade disponível na região e das regras vigentes da Oracle.
- Instâncias ociosas podem ser recuperadas pela Oracle; mantenha backups fora da VM.
- `sslip.io` é ótimo para teste, mas um domínio próprio transmite mais confiança no lançamento.
- Se o acesso crescer, monitore disco, memória, tempo de sincronização e `/api/v1/health` antes de contratar recursos.
- A análise local usa CPU intensivamente, mas roda com concorrência de um documento e não é executada durante cada acesso do visitante.
- Nunca envie `.env.free`, chaves SSH ou tokens para o GitHub.

Fontes: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Render Free](https://render.com/docs/free), [HTTPS automático do Caddy](https://caddyserver.com/docs/automatic-https) e [sslip.io](https://sslip.io/).
