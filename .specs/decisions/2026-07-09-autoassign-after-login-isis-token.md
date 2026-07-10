# Decisão: autoatribuir após login usando token ISIS

**Data:** 2026-07-09  
**Feature:** `experimental-groups`

## Decisão

Sem alterar a ISIS, a autoatribuição experimental será chamada pelo app logo após `createUserAccount → login` e antes de navegar para a Home. O app enviará para a Cloud Function `autoAssignAdaptiveExperiment` o `userId` e o JWT retornado pela mutation `login` da ISIS.

A API de adaptação validará o JWT usando `ISIS_JWT_SECRET` e só permitirá autoatribuição quando `payload.id` corresponder ao `userId` enviado.

## Por quê

- Evita alterar o backend ISIS.
- Garante que a Home já encontra `userAdaptiveConfig` pronto.
- Evita listener em tempo real e evita autoatribuição tardia dentro da Home.
- Evita expor `ADMIN_KEY` no fluxo do aluno.
- A chamada é idempotente: se a config já existir, retorna sem reatribuir grupo.

## Descartado

- Autoatribuir dentro da Home quando `userAdaptiveConfig` não existe.
- Fazer a ISIS escrever diretamente no Firestore da API de adaptação.
- Usar `AdaptiveAdminService` no app do aluno.
- Aceitar apenas `userId` sem validar token.

## Consequências

- A Cloud Function precisa receber nova variável de ambiente `ISIS_JWT_SECRET`.
- O app precisa chamar novo serviço após login pós-cadastro.
- A falha de autoatribuição não deve quebrar usuários fora de experimento; se não houver experimento ativo, o cadastro/login segue normalmente.
