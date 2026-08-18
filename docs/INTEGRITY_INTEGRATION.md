# Integração de fiscalização e integridade

O VotoClaro consulta fontes oficiais por identificador exato para evitar associações por homônimos. O recurso não produz nota, ranking, recomendação eleitoral ou rótulo de “escândalo”.

## Fontes ativas

- TCU — contas julgadas irregulares com decisão transitada em julgado;
- TCU — contas irregulares com possível implicação eleitoral;
- TCU — responsáveis inabilitados;
- TCU — licitantes inidôneos;
- Portal da Transparência — CEIS, CNEP e CEAF, quando a chave oficial estiver configurada;
- TSE — receitas, despesas e bens declarados;
- Câmara ou Senado — despesas do mandato atual somente após vínculo exato entre fontes oficiais.

## Regra de identidade e privacidade

O `NR_CPF_CANDIDATO` do arquivo oficial do TSE é carregado em um cofre volátil, separado do modelo público. O valor:

- nunca é incluído no objeto da candidatura;
- não é salvo em snapshot, PostgreSQL ou cache de resposta;
- não é enviado ao navegador nem retornado pela API;
- não é incluído em logs ou métricas;
- só é usado para consultas oficiais exatas;
- é descartado quando o processo do servidor termina.

Respostas externas que não devolvam o mesmo identificador são descartadas antes da criação do objeto público. Os registros retornados usam uma lista explícita de campos permitidos, sem CPF ou CNPJ.

## Configuração

O TCU funciona sem credencial. CEIS, CNEP e CEAF exigem a chave gratuita do Portal da Transparência:

```env
PORTAL_TRANSPARENCIA_TOKEN=
INTEGRITY_TIMEOUT_MS=30000
INTEGRITY_RETRY_COUNT=1
INTEGRITY_RETRY_DELAY_MS=500
INTEGRITY_CACHE_TTL_MINUTES=360
INTEGRITY_ERROR_CACHE_TTL_SECONDS=300
INTEGRITY_MAX_RESPONSE_BYTES=1048576
```

Guarde `PORTAL_TRANSPARENCIA_TOKEN` somente no ambiente do servidor. O frontend chama apenas `/api/v1/candidates/:id/integrity`.

## Interpretação jurídica

Os estágios não são equivalentes. Uma sanção administrativa, decisão do TCU, investigação, acusação e condenação judicial têm naturezas diferentes. O TCU também esclarece que a lista para fins eleitorais não declara inelegibilidade; essa análise compete à Justiça Eleitoral.

Ausência de resultado não é certidão de idoneidade. A fonte pode estar fora do escopo, sem atualização ou temporariamente indisponível. Em consultas parciais, a interface não afirma ausência de registros.

## Testes mínimos antes de publicar

1. confirmar que CPF não aparece em `/api/v1/candidates/:id`, `/integrity`, logs ou snapshots;
2. simular homônimo com CPF diferente e confirmar o descarte;
3. simular indisponibilidade de uma fonte e confirmar a mensagem de consulta parcial;
4. abrir os links de processo na fonte oficial;
5. confirmar a diferença visual entre decisão final do TCU e sanção administrativa;
6. verificar a ficha e a comparação em celular.
