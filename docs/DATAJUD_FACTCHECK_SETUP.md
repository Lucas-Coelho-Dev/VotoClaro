# Como ativar DataJud e Google Fact Check

Os dois conectores são opcionais. Quando uma chave não estiver configurada, o VotoClaro informa que a fonte está desativada e mantém os demais dados disponíveis.

## Antes de começar

Você precisará de:

- acesso aos arquivos da instalação do VotoClaro na Oracle;
- o IP público de saída da máquina da Oracle, para restringir a chave do Google;
- a chave pública vigente da API DataJud;
- uma chave de API criada no seu projeto do Google Cloud.

Nunca envie essas chaves para o navegador, para o GitHub ou para arquivos `.env` versionados. Na implantação oficial, elas ficam somente em arquivos da pasta `secrets`, que não é publicada.

## 1. Ativar o DataJud

1. Abra a página oficial [Acesso à API Pública do DataJud](https://datajud-wiki.cnj.jus.br/api-publica/acesso/).
2. Localize a chave pública vigente exibida pelo CNJ. Ela pode mudar; se o serviço começar a responder `401`, confira a página novamente.
3. Na máquina da Oracle, abra o arquivo `secrets/datajud_api_key.txt` dentro do projeto.
4. Cole somente o valor da chave, sem aspas. O VotoClaro também tolera o prefixo `APIKey`, mas guardar apenas o valor reduz erros.
5. Salve o arquivo e recrie somente o site/API:

   ```bash
   docker compose -f compose.production.yml up -d --build app
   ```

6. Abra `https://SEU-DOMINIO/api/v1/sources` e confirme que o DataJud não aparece mais como “Aguardando chave”.
7. Abra a ficha de uma candidatura que possua número de processo de registro publicado pelo TSE. A seção DataJud deve informar o tribunal consultado, classe, assuntos e movimentação mais recente disponíveis.

### O que o VotoClaro consulta no DataJud

O sistema pesquisa exclusivamente o número exato de 20 dígitos do processo de registro publicado pelo TSE, nos índices do TRE correspondente e do TSE. Ele não pesquisa processos pelo nome do candidato e não apresenta o resultado como “histórico judicial” da pessoa. Essa limitação evita associar processos de homônimos.

## 2. Criar e ativar a chave do Google Fact Check

1. Entre no [Google Cloud Console](https://console.cloud.google.com/) com sua conta Google.
2. Crie um projeto ou selecione um projeto exclusivo para o VotoClaro.
3. Abra **APIs e serviços > Biblioteca**.
4. Pesquise por **Fact Check Tools API** e clique em **Ativar**.
5. Abra **APIs e serviços > Credenciais**.
6. Clique em **Criar credenciais > Chave de API**.
7. Edite a chave e aplique duas restrições:
   - em **Restrições do aplicativo**, escolha **Endereços IP** e informe o IP público de saída da Oracle;
   - em **Restrições de API**, permita somente **Fact Check Tools API**.
8. Na Oracle, cole a chave no arquivo `secrets/google_fact_check_api_key.txt`, sem aspas e sem espaços extras.
9. Recrie somente o site/API:

   ```bash
   docker compose -f compose.production.yml up -d --build app
   ```

10. Abra `https://SEU-DOMINIO/api/v1/sources` e confirme que o Google Fact Check não aparece mais como “Aguardando chave”.
11. Abra uma ficha. As checagens encontradas devem exibir alegação, organização verificadora, classificação, data e link para a publicação original.

O VotoClaro usa somente a pesquisa `claims.search`. O resultado é uma busca textual secundária e não é atribuído automaticamente ao candidato: nome citado, contexto e autoria precisam ser conferidos na checagem original.

## 3. Conferir cota e cobrança

Antes de lançar:

1. No Google Cloud, abra **APIs e serviços > Fact Check Tools API > Cotas e limites do sistema**.
2. Confira a cota disponível e configure alertas de uso, se a sua conta oferecer essa opção.
3. Confira **Faturamento** no próprio console. Não presuma gratuidade ou ausência de exigência de conta de faturamento, pois essas condições podem mudar.
4. Crie uma chave diferente para testes locais e apague-a ao terminar. Não reutilize a chave de produção no computador pessoal.

## 4. Diagnóstico rápido

- **Aguardando chave:** o arquivo está vazio, ausente ou não foi montado no contêiner.
- **401/403 no DataJud:** confira a chave vigente no site do CNJ e reinicie o app.
- **403 no Fact Check:** verifique se a API foi ativada e se o IP da Oracle está permitido.
- **Nenhum resultado no Fact Check:** isso pode significar somente que a busca não localizou checagens; não comprova que uma alegação seja verdadeira ou falsa.
- **Nenhum processo no DataJud:** confira se a candidatura tem número de registro oficial e se o índice do tribunal já recebeu os dados.

## Links oficiais

- [API Pública DataJud — visão geral](https://www.cnj.jus.br/sistemas/datajud/api-publica/)
- [DataJud — acesso e chave vigente](https://datajud-wiki.cnj.jus.br/api-publica/acesso/)
- [DataJud — endpoints dos tribunais](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/)
- [Google Fact Check Tools API — primeiros passos](https://developers.google.com/fact-check/tools/api)
- [Google Fact Check — claims.search](https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search?hl=pt-br)
- [Google Cloud — criar e restringir chaves](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys)
