# Decisão: autoatribuição round-robin no experimento ativo

**Data:** 2026-07-09  
**Feature:** `experimental-groups`

## Decisão

O experimento deve ser criado uma única vez antes do teste, com `autoAssign: true` e `assignmentStrategy: "roundRobin"`. Usuários novos que ainda não possuem `userAdaptiveConfig` serão atribuídos automaticamente ao próximo grupo quando entrarem na Home pela primeira vez.

Ao final do primeiro período, o admin avançará o experimento inteiro para o próximo período com um botão administrativo. Os alunos serão orientados a deslogar e logar novamente para carregar a nova config. Não será implementado listener em tempo real para troca de período.

## Por quê

- Reduz trabalho manual do admin durante a sessão de teste.
- Evita esquecer alunos sem grupo.
- Mantém o fluxo do aluno natural: cadastro → login → Home.
- Garante contrabalanceamento simples e auditável: A/B/A/B.
- Evita complexidade de listener em tempo real na Home.
- Facilita análise do artigo, porque todo usuário ganha `experimentId`, `testGroup`, `participantId`, `period` e `condition` desde o início.

## O que foi descartado

- **Atribuição manual por aluno:** mais propensa a erro e lenta no dia do teste.
- **Bulk assign manual na criação do grupo:** útil, mas ainda exige saber todos os participantes antes do cadastro.
- **Listener Firestore para troca de período:** mais complexo e desnecessário, já que o procedimento do teste pode instruir logout/login.
- **Polling periódico da config:** adiciona consumo e complexidade sem necessidade operacional.

## Consequências

- A autoatribuição precisa ser atômica para evitar dois usuários recebendo o mesmo índice/grupo em cadastros simultâneos.
- O app do aluno não deve usar `ADMIN_KEY`; a autoatribuição deve ficar em função segura dedicada ou caminho público autenticado.
- O avanço de período deve ser uma ação administrativa com confirmação forte.
