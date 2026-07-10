# Decisão: Nova collection `experimentalGroups` vs. estender `userAdaptiveConfig`

**Data:** 2026-07-09
**Feature:** `experimental-groups`

## Decisão

Criar uma nova collection `experimentalGroups/{experimentId}` no Firestore para representar o experimento completo, incluindo grupos internos, condições por período, autoatribuição e participantes. A estrutura do experimento não deve ficar apenas espalhada nos campos `testGroup`, `period` e `condition` de cada `userAdaptiveConfig`.

## Por quê

1. **Single source of truth:** O experimento define grupos, condições, período atual e participantes em um só lugar. Sem a collection, a estrutura do experimento fica implícita e espalhada em dezenas de documentos `userAdaptiveConfig`.

2. **Consultas para o artigo:** Com a collection, é possível listar o experimento ativo, grupos, participantes e condições com uma única query. Sem ela, seria necessário varrer todos os `userAdaptiveConfig` e agrupar por `testGroup` manualmente.

3. **Integridade referencial:** Ao encerrar/remover um experimento, os `userAdaptiveConfig` mantêm `experimentId`, `testGroup`, `participantId`, `period` e `condition` para rastreabilidade histórica.

4. **Evolução futura:** Se o experimento ganhar mais períodos, condições ou metadados, a collection centraliza a mudança.

5. **Compatibilidade:** `userAdaptiveConfig` continua com os mesmos campos; a collection é adicional, não substitutiva.

## Descartado

- **Estender apenas `userAdaptiveConfig`:** espalharia a definição do experimento, dificultando queries e interpretação para o artigo.
- **Collection separada por participante (`experimentalParticipants/{userId}`):** fragmentaria ainda mais os dados; um experimento com 30 participantes geraria 30 documentos adicionais e exigiria joins manuais.
- **Subcoleção dentro de `experimentalGroups/{id}/participants/{userId}`:** adiciona complexidade de nested queries sem benefício real para o caso de uso inicial; os participantes já têm documento próprio em `userAdaptiveConfig`.
