# Operação e resposta a incidentes

## Indicadores mínimos

Monitore a cada cinco minutos:

- HTTP de `/api/v1/health`;
- `status` (`OK`, `STALE` ou `INITIALIZING`);
- `ageHours` da última importação;
- contagem de candidaturas;
- `photoCount` e estado da fonte `tse-photos-2026`;
- checksum;
- falhas consecutivas por fonte;
- disponibilidade sob demanda das malhas do IBGE e dos pacotes de propostas de governo do TSE;
- falhas de extração textual e tempo da primeira geração dos resumos de PDF;
- duração e memória da sincronização.
- fila, última conclusão e última falha de `localPlanAnalysis` em `/api/v1/health`;
- uso de memória e CPU do serviço `llm`, mantendo apenas uma análise simultânea.

O portal considera os dados vencidos após 36 horas sem snapshot novo. Uma fonte vencida deve permanecer visível, com o horário real da última atualização.

## Alertas

- **Crítico:** portal indisponível, banco indisponível ou ausência total de snapshot.
- **Alto:** TSE sem sincronizar por mais de 36 horas.
- **Médio:** arquivo opcional de receitas/despesas indisponível.
- **Médio:** uma ou mais UFs sem atualização das fotos; preserve o último cache válido.
- **Revisão:** queda ou crescimento inesperado superior a 20% na contagem de candidaturas.

## Falha da fonte

1. Não substitua o TSE por dados simulados.
2. Preserve o último snapshot válido.
3. Mostre “última atualização” e indisponibilidade.
4. Consulte o arquivo diretamente no Portal de Dados Abertos.
5. Registre a causa e o horário da recuperação.

## Fotos oficiais

- A sincronização baixa os arquivos diários por UF e nunca associa imagens por nome ou reconhecimento facial.
- O vínculo usa somente o identificador oficial `SQ_CANDIDATO` presente no nome do JPEG.
- Em desenvolvimento, os JPEGs ficam em `data/photos`; com PostgreSQL, ficam em `candidate_photos`.
- A rota de imagem usa ETag e cache público. Se uma foto ainda não tiver sido publicada, a interface mostra as iniciais.
- Para recuperar somente essa fonte, execute `npm run sync:photos`.

## Localização e propostas

- O servidor nunca deve receber parâmetros de latitude ou longitude; `/api/v1/geography/states` entrega somente a malha das UFs.
- A permissão de localização deve ocorrer apenas após clique e requer HTTPS fora de `localhost`.
- PDFs de plano de governo ficam em cache técnico e são vinculados somente pelo `SQ_CANDIDATO`.
- Resumos extrativos ficam em `data/government-plan-summaries`; análises concluídas da IA local também ficam no PostgreSQL. Uma mudança no PDF gera outro checksum e outra análise.
- A IA local processa todas as páginas com texto em blocos, preserva página e citação, consolida por tema e trabalha em fila. Ela não deve receber porta pública.
- Cenários de quatro anos são sempre condicionais. Um número que não esteja nas evidências do PDF não pode ser publicado.
- Se a IA local falhar ou estiver carregando, preserve e publique o classificador extrativo atual sem interromper o portal.
- Se a cobertura de texto for insuficiente, mantenha o PDF e não tente preencher os pontos manualmente como se fossem extraídos da fonte.
- Projetos legislativos são consultados sob demanda. Em falha da Câmara ou do Senado, preserve a candidatura e mostre a indisponibilidade sem criar conteúdo substituto.

## Incidente de integridade

Se o checksum ou a contagem fugir do esperado:

1. interrompa a publicação automática da nova versão;
2. conserve o pacote bruto e o snapshot anterior;
3. compare cabeçalhos e layout do CSV;
4. atualize o normalizador e os testes;
5. publique a correção como nova versão, nunca editando a antiga silenciosamente.

## Incidente de privacidade

A versão 2 não recebe colinhas nem cadastro. Se dados pessoais aparecerem em logs ou snapshots:

1. restrinja imediatamente o acesso;
2. identifique origem, alcance e período;
3. remova o campo do normalizador;
4. rotacione segredos potencialmente expostos;
5. avalie as obrigações de comunicação conforme a LGPD e orientação jurídica.

## Dia da eleição

O feed de resultados deve ser um módulo isolado e testado antes de 4 de outubro. Só publique totais recebidos da infraestrutura oficial do TSE, preserve boletins/arquivos de origem e exiba horário e percentual de seções totalizadas. Nunca some resultados parciais de fontes jornalísticas como se fossem o total oficial.
