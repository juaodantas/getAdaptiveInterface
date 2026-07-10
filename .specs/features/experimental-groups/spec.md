# Spec — Experimento contrabalanceado com autoatribuição de participantes

## 1. Contexto

O sistema já permite configurar modos adaptativos por usuário via `userAdaptiveConfig/{userId}` no Firestore e pela tela admin do app Flutter `osi-solucoes`. Hoje essa configuração é individual e manual. Para o teste com alunos, o objetivo é simplificar a operação no dia do experimento:

1. O admin cria o experimento uma única vez antes do teste.
2. Os alunos fazem o fluxo normal: cadastro → login.
3. Antes de navegar para a Home, o app chama `autoAssignAdaptiveExperiment` com o `userId` e o token JWT retornado pela ISIS.
4. A API de adaptação valida o token ISIS e atribui automaticamente cada novo aluno a um grupo experimental usando contrabalanceamento round-robin.
4. Ao final do primeiro período, o admin clica em um botão para avançar todo o experimento para o segundo período.
5. Os alunos deslogam e logam novamente para receber o novo modo, sem listener em tempo real.

Essa abordagem mantém a experiência dos alunos simples e torna os dados mais fáceis de interpretar no artigo de mestrado.

## 2. Problem statement

- Atribuir usuários manualmente a grupos durante o teste aumenta risco operacional.
- O campo atual `testGroup` é texto livre, sem estrutura de experimento, grupo, período e condição.
- O `sessionId` atual não carrega semântica experimental.
- Trocar usuários do período 1 para o período 2 manualmente é propenso a erro.
- Não há um registro central de qual experimento estava ativo no momento do cadastro.

## 3. Goals

- **REQ-001 — Experimento ativo:** Criar uma entidade Firestore `experimentalGroups/{experimentId}` que representa o experimento completo, com `autoAssign`, `assignmentStrategy`, `assignmentIndex`, grupos e condições por período.
- **REQ-002 — Autoatribuição round-robin:** Usuários novos sem `userAdaptiveConfig` devem ser atribuídos automaticamente ao experimento ativo com `autoAssign: true`.
- **REQ-003 — Config inicial antes da Home:** Após cadastro/login, o app deve chamar `autoAssignAdaptiveExperiment(userId, isisToken)` antes de navegar para a Home, garantindo que o aluno receba `mode`, `testGroup`, `participantId`, `period` e `condition` antes da interface adaptativa carregar.
- **REQ-004 — Avançar período em lote:** A tela admin deve oferecer botão para avançar todos os participantes do experimento para o próximo período, alternando o modo conforme o grupo.
- **REQ-005 — Ajuste manual opcional:** O admin deve conseguir trocar um usuário de grupo ou corrigir sua config se necessário.
- **REQ-006 — `sessionId` experimental:** Para `INSTANT`, o `sessionId` deve conter `participantId`, condição, período e timestamp.
- **REQ-007 — Compatibilidade:** Usuários fora de experimento continuam usando o fluxo atual (`GRADUAL` default ou config individual existente).
- **REQ-008 — Dados analisáveis:** `userAdaptiveConfig` e `sessionNavigations` devem permitir cruzamento por experimento, grupo, participante, período e condição.
- **REQ-009 — `participantId` único por experimento:** O identificador do participante deve ser gerado por experimento, não por grupo, evitando duplicidade entre grupos A/B.
- **REQ-010 — Avanço de período unidirecional:** O avanço de período deve ser tratado como ação administrativa unidirecional na primeira versão; correções devem ser feitas por usuário.
- **REQ-011 — Encerramento de experimento:** Deve existir ação para marcar o experimento como `completed`, desativar `autoAssign` e bloquear novas autoatribuições.
- **REQ-012 — Validação por token ISIS:** A função pública de autoatribuição deve validar o JWT da ISIS e confirmar que `payload.id` corresponde ao `userId` solicitado, sem expor `ADMIN_KEY` no app do aluno.

## 4. Non-goals

- Não implementar listener em tempo real na Home para troca de período.
- Não exigir que o aluno clique em botão de troca de período.
- Não alterar o algoritmo de recomendação do `getAdaptiveInterface`.
- Não alterar schema do BigQuery.
- Não criar exportação CSV nesta etapa.
- Não implementar randomização complexa; a estratégia inicial é round-robin.
- Não alterar autenticação/admin key existente.

## 5. Requisitos rastreáveis

| ID | Requisito | Evidência esperada |
| --- | --- | --- |
| REQ-001 | Experimento ativo em `experimentalGroups` | Documento com `autoAssign`, `assignmentStrategy`, `assignmentIndex`, `groups` |
| REQ-002 | Autoatribuição round-robin | Usuários novos alternam entre grupos A/B automaticamente |
| REQ-003 | Config inicial antes da Home | `userAdaptiveConfig/{userId}` existe antes da chamada final da Home |
| REQ-004 | Avanço de período em lote | Botão admin atualiza todos os participantes do experimento |
| REQ-005 | Ajuste manual opcional | Admin consegue reatribuir usuário a outro grupo/condição |
| REQ-006 | `sessionId` experimental | `sessionId` contém `P001_INSTANT_P1_...` |
| REQ-007 | Compatibilidade | Usuários sem experimento continuam em fluxo atual |
| REQ-008 | Dados analisáveis | Firestore permite filtrar por `experimentId`, `testGroup`, `period`, `condition` |
| REQ-009 | `participantId` único por experimento | Não há `P001` duplicado entre grupos do mesmo experimento |
| REQ-010 | Avanço unidirecional | Não há botão simples de voltar período; ajustes são individuais |
| REQ-011 | Encerrar experimento | `status: completed`, `autoAssign: false`, `completedAt` preenchido |
| REQ-012 | Validação por token ISIS | Chamada com token inválido ou `payload.id != userId` é rejeitada |

## 6. Critérios de aceitação

- **AC-001:** Dado um experimento ativo com `autoAssign: true`, quando um usuário recém-logado chama `autoAssignAdaptiveExperiment` com token ISIS válido antes da Home, então ele é atribuído automaticamente a um grupo.
- **AC-002:** Dado dois grupos A/B com `assignmentStrategy: roundRobin`, quando quatro usuários novos entram, então a distribuição é A, B, A, B.
- **AC-003:** Dado um usuário atribuído ao grupo A no período 1, então seu `userAdaptiveConfig` contém `experimentId`, `testGroup`, `participantId`, `period: 1`, `condition` e `mode` coerentes com o grupo.
- **AC-004:** Dado usuário do modo `INSTANT`, então `sessionNavigations/{sessionId}` é criado com os metadados experimentais.
- **AC-005:** Dado o fim do período 1, quando o admin aciona “Avançar período”, então todos os participantes mudam para o período 2 e recebem o modo definido na segunda condição do seu grupo.
- **AC-006:** Dado usuário mudado para período 2, quando ele desloga e loga novamente, então a Home carrega o novo modo sem exigir listener em tempo real.
- **AC-007:** Dado necessidade de correção, o admin consegue ajustar manualmente o grupo/condição de um usuário.
- **AC-008:** Usuários sem experimento ativo não são atribuídos automaticamente e mantêm comportamento atual.
- **AC-009:** Dado um experimento com grupos A/B, os participantes recebem IDs globais sequenciais (`P001`, `P002`, `P003`) sem reiniciar a contagem por grupo.
- **AC-010:** Dado um experimento no período 2, não existe ação simples de voltar período; correções devem ocorrer via ajuste manual por usuário.
- **AC-011:** Dado um experimento encerrado, novos usuários não são autoatribuídos a ele.
- **AC-012:** Dado token ISIS inválido, ausente ou pertencente a outro usuário, a autoatribuição é negada.

## 7. Modelo de dados — Firestore

### 7.1 Collection `experimentalGroups/{experimentId}`

Apesar do nome da collection, cada documento representa um experimento completo com seus grupos internos.

```json
{
  "id": "experimento_2026",
  "name": "Experimento Contrabalanceado — Jul/2026",
  "description": "Teste STATIC vs INSTANT com alunos",
  "autoAssign": true,
  "assignmentStrategy": "roundRobin",
  "assignmentIndex": 0,
  "currentPeriod": 1,
  "maxPeriods": 2,
  "status": "active",
  "completedAt": null,
  "groups": [
    {
      "groupId": "group_a",
      "name": "Grupo A — STATIC primeiro",
      "conditions": [
        { "period": 1, "mode": "STATIC", "label": "Controle" },
        { "period": 2, "mode": "INSTANT", "label": "Experimental" }
      ]
    },
    {
      "groupId": "group_b",
      "name": "Grupo B — INSTANT primeiro",
      "conditions": [
        { "period": 1, "mode": "INSTANT", "label": "Experimental" },
        { "period": 2, "mode": "STATIC", "label": "Controle" }
      ]
    }
  ],
  "participants": [
    {
      "userId": "101",
      "participantId": "P001",
      "groupId": "group_a",
      "assignedAt": "<timestamp>"
    }
  ],
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

### 7.2 Campos em `userAdaptiveConfig/{userId}`

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `userId` | string | ID do usuário |
| `mode` | string | Modo efetivo atual (`STATIC`, `INSTANT`, `GRADUAL`) |
| `experimentId` | string | ID do experimento ativo |
| `testGroup` | string | ID do grupo interno (`group_a`, `group_b`) |
| `groupName` | string | Nome legível do grupo |
| `participantId` | string | ID experimental (`P001`) |
| `period` | number | Período atual |
| `condition` | string | Condição atual (`STATIC` ou `INSTANT`) |
| `sessionId` | string | Obrigatório para `INSTANT` |
| `createdAt` | timestamp | Criação/configuração inicial |
| `updatedAt` | timestamp | Última alteração |

### 7.3 Campos em `sessionNavigations/{sessionId}`

```json
{
  "sessionId": "P002_INSTANT_P1_20260709_093000",
  "userId": "102",
  "experimentId": "experimento_2026",
  "testGroup": "group_b",
  "participantId": "P002",
  "period": 1,
  "condition": "INSTANT",
  "status": "active",
  "startedAt": "<timestamp>"
}
```

### 7.4 Formato de `sessionId`

```
{PARTICIPANT_ID}_{CONDITION}_P{PERIOD}_{YYYYMMDD_HHMMSS}
```

Exemplo:

```
P002_INSTANT_P1_20260709_093000
```

## 8. Contrato da API — extensões ao `adminAdaptiveMode`

### 8.1 Criar/atualizar experimento

```json
POST /adminAdaptiveMode
{
  "collection": "experimentalGroups",
  "experimentId": "experimento_2026",
  "name": "Experimento Contrabalanceado — Jul/2026",
  "autoAssign": true,
  "assignmentStrategy": "roundRobin",
  "groups": [...],
  "status": "active"
}
```

### 8.2 Autoatribuir usuário

```json
callable autoAssignAdaptiveExperiment
{
  "userId": "101",
  "isisToken": "<jwt-retornado-pela-mutation-login>"
}
```

Resposta:

```json
{
  "success": true,
  "userId": "101",
  "experimentId": "experimento_2026",
  "testGroup": "group_a",
  "participantId": "P001",
  "period": 1,
  "mode": "STATIC",
  "sessionId": null
}
```

Validações obrigatórias:

- `isisToken` deve ser validado com `ISIS_JWT_SECRET`.
- `payload.id` do JWT deve corresponder a `userId`.
- A função é idempotente: se `userAdaptiveConfig/{userId}` já existir, retorna a config existente sem reatribuir grupo.
- A função não aceita operações administrativas, não cria experimento, não avança período e não troca grupo.

### 8.3 Avançar período

```json
POST /adminAdaptiveMode
{
  "action": "advanceExperimentPeriod",
  "experimentId": "experimento_2026"
}
```

### 8.4 Ajuste manual de usuário

```json
POST /adminAdaptiveMode
{
  "action": "assignParticipantToGroup",
  "userId": "101",
  "experimentId": "experimento_2026",
  "groupId": "group_b",
  "period": 1
}
```

### 8.5 Encerrar experimento

```json
POST /adminAdaptiveMode
{
  "action": "completeExperiment",
  "experimentId": "experimento_2026"
}
```

Efeito esperado:

```json
{
  "status": "completed",
  "autoAssign": false,
  "completedAt": "<timestamp>"
}
```

## 9. Fluxo operacional do teste

### Antes do teste

1. Admin abre a tela de modos adaptativos.
2. Cria `experimento_2026` com `autoAssign: true`.
3. Define grupos A/B e suas condições por período.

### Período 1

1. Aluno cadastra conta.
2. App faz login e recebe token ISIS.
3. Antes de navegar para a Home, app chama `autoAssignAdaptiveExperiment(userId, isisToken)`.
4. API valida o token ISIS.
5. Usuário recebe grupo e modo do período 1.
6. App navega para a Home.
7. Home carrega no modo correto porque `userAdaptiveConfig` já existe.

### Transição para período 2

1. Admin instrui alunos a deslogarem ao fim do período 1.
2. Admin clica “Avançar para Período 2”.
3. API atualiza todos os participantes do experimento.
4. Alunos logam novamente.
5. Home lê nova config e carrega o modo do período 2.

## 10. Validação esperada

- Criar experimento ativo no Firestore via admin API.
- Criar quatro usuários novos e confirmar distribuição A/B/A/B.
- Confirmar que usuários `INSTANT` recebem `sessionId` e documento em `sessionNavigations`.
- Confirmar que token ISIS inválido não permite autoatribuição.
- Acionar avanço de período e confirmar alternância de todos os participantes.
- Confirmar que usuário sem experimento ativo continua no fluxo atual.
- Rodar `node -c index.js` após backend.
- Rodar `flutter analyze` nos arquivos Flutter alterados.

## 11. Questões abertas

- Decidido: `participantId` é único por experimento, não por grupo.
- Decidido: avanço de período é unidirecional na primeira versão; correções são feitas manualmente por usuário.
- Decidido: deve existir ação de encerramento do experimento, marcando `status: completed`, `autoAssign: false` e `completedAt`.
