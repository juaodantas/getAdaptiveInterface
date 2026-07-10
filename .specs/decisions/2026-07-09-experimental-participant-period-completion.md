# Decisão: participantId, avanço de período e encerramento do experimento

**Data:** 2026-07-09  
**Feature:** `experimental-groups`

## Decisão

1. `participantId` é único por experimento, não por grupo.
2. O avanço de período é unidirecional na primeira versão; não haverá botão simples para voltar período.
3. Deve existir ação administrativa para encerrar o experimento, marcando `status: completed`, `autoAssign: false` e `completedAt`.

## Por quê

### `participantId` único por experimento

Usar IDs globais (`P001`, `P002`, `P003`) evita ambiguidade na análise. Se cada grupo reiniciasse em `P001`, haveria dois participantes com o mesmo identificador dentro do mesmo experimento, exigindo sempre a composição `groupId + participantId` para interpretação.

### Avanço unidirecional

Voltar período pode corromper a interpretação das sessões já coletadas, especialmente quando há `sessionNavigations` do modo `INSTANT`. Para a primeira versão, erros devem ser corrigidos individualmente via ajuste manual de usuário/grupo/condição.

### Encerramento do experimento

Sem encerramento explícito, usuários cadastrados depois do teste poderiam continuar sendo autoatribuídos ao experimento. O status `completed` preserva dados históricos e bloqueia novas autoatribuições.

## Descartado

- Reiniciar `participantId` por grupo (`group_a/P001`, `group_b/P001`).
- Botão simples de “voltar período”.
- Deixar experimento ativo indefinidamente e depender de remoção manual.

## Consequências

- A autoatribuição deve usar `assignmentIndex` global do experimento.
- A UI admin deve oferecer ajuste manual por usuário, mas não voltar período como ação comum.
- A UI/admin API deve incluir `completeExperiment`.
