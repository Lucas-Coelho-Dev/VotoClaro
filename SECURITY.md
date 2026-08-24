# Segurança

## Dados que o servidor não deve receber

- CPF, título de eleitor ou endereço de usuário;
- colinha ou preferência eleitoral;
- senhas de usuários finais;
- dados de processos sigilosos;
- chaves de API no navegador.

## Controles implementados

- Helmet e política de conteúdo restritiva;
- limite de requisições;
- limite separado para consultas pesadas e tentativas administrativas;
- corpo JSON limitado;
- rota de sincronização protegida por segredo e comparação resistente a timing;
- normalização que descarta CPF, e-mail e título eleitoral dos arquivos do TSE;
- colinha em armazenamento local;
- snapshots públicos versionados por checksum;
- banco PostgreSQL sem tabelas de usuários ou votos.
- segredos montados como arquivos somente nos contêineres autorizados;
- administração somente por método mutável explícito e Bearer token, sem segredo na URL;
- access log HTTP desativado para não registrar IP nem termos de busca eleitoral;
- páginas públicas continuam disponíveis com erro amigável quando o banco estiver indisponível.

## Antes do lançamento

- rotacione todos os segredos históricos;
- use um banco novo e vazio;
- habilite backup e proteção contra exclusão;
- configure logs sem query strings sensíveis;
- execute `npm audit` e trate vulnerabilidades aplicáveis;
- faça teste de carga e revisão independente;
- publique um canal de segurança e privacidade.

## Relato de vulnerabilidade

Inclua aqui, antes do lançamento, um e-mail de segurança válido. Não publique detalhes de uma vulnerabilidade antes de ela ser corrigida.
