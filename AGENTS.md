# Regras de trabalho do VotoClaro

- A pasta canônica do projeto é `F:\VotoClaro`. Não desenvolver em cópias antigas no disco C.
- Na primeira tarefa do VotoClaro em cada novo dia (fuso `America/Sao_Paulo`), antes das demais alterações, verificar se o ambiente local está disponível.
- Se necessário, iniciar o Docker Desktop e somente os contêineres conhecidos `votoclaro-db`, `votoclaro-llm` e `votoclaro-app`. Não recriar nem apagar banco, volumes ou modelos automaticamente.
- Confirmar o acesso do site em `http://localhost:3000` e informar o resultado ao usuário.
- Manter o repositório GitHub sincronizado com a versão mais completa depois de alterações aprovadas e testadas.
- Dados eleitorais, legislativos e de impacto precisam manter vínculo explícito com a fonte. Não atribuir autoria, efeito ou impacto por aproximação de nome.
