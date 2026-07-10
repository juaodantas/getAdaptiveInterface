Agent: architect
Rules: AGENTS.md

# Tasks — Experimento contrabalanceado com autoatribuição

## Contexto

O fluxo final definido é:

1. Admin cria experimento ativo antes do teste.
2. Alunos se cadastram e logam normalmente.
3. Após login pós-cadastro, app chama `autoAssignAdaptiveExperiment(userId, isisToken)`.
4. API valida token ISIS e autoatribui usuários novos em round-robin.
5. Admin pode ajustar usuário manualmente.
6. Admin avança todos para o segundo período com botão único.
7. Alunos deslogam/logam para carregar novo modo.

## Objetivos

- Autoatribuição sem intervenção manual por aluno.
- Round-robin atômico.
- Avanço de período em lote.
- Encerramento do experimento para bloquear novas autoatribuições.
- Ajuste manual pelo admin.
- Dados claros para análise do mestrado.

## Não objetivos

- Listener em tempo real na Home.
- Exportação CSV.
- Mudança no algoritmo de recomendação.
- Mudança em BigQuery.
- Botão simples de voltar período.

---

## Tarefa 1 — Modelar experimento ativo no backend admin

- **Tipo:** backend
- **Arquivo:** `getAdaptiveInterface/index.js`
- **Requisitos:** REQ-001
- **Ação:** Estender `adminAdaptiveMode` para criar/listar/remover `experimentalGroups/{experimentId}` com campos: `autoAssign`, `assignmentStrategy`, `assignmentIndex`, `currentPeriod`, `maxPeriods`, `groups`, `participants`, `status`.
- **Detalhes:**
  - `GET ?collection=experimentalGroups` lista experimentos.
  - `GET ?collection=experimentalGroups&id=...` busca um experimento.
  - `POST { collection: "experimentalGroups", experimentId, ... }` cria/atualiza.
  - `DELETE ?collection=experimentalGroups&id=...` remove documento sem apagar configs históricas.
- **Verificação:** CRUD manual via HTTP e Firestore.

## Tarefa 2 — Implementar autoatribuição round-robin atômica

- **Tipo:** backend
- **Arquivo:** `getAdaptiveInterface/index.js` ou novo módulo se extrair lógica
- **Requisitos:** REQ-002, REQ-003, REQ-006, REQ-008
- **Ação:** Implementar ação `autoAssignParticipant`.
- **Detalhes:**
  - Entrada: `userId`.
  - Se `userAdaptiveConfig/{userId}` já existe, retornar config existente.
  - Buscar experimento `status: active` + `autoAssign: true`.
  - Usar `db.runTransaction` para ler/incrementar `assignmentIndex`.
  - Distribuir em round-robin: `groupIndex = assignmentIndex % groups.length`.
  - Gerar `participantId` único por experimento: `P001`, `P002`, ...; a contagem não reinicia por grupo.
  - Selecionar condição do `currentPeriod`.
  - Criar `userAdaptiveConfig/{userId}`.
  - Atualizar `participants` do experimento.
  - Se condição for `INSTANT`, criar `sessionNavigations/{sessionId}`.
- **Verificação:** quatro chamadas consecutivas geram A/B/A/B e participantes P001-P004.

## Tarefa 3 — Criar função segura para autoatribuição chamada após login

- **Tipo:** backend
- **Arquivo:** `getAdaptiveInterface/index.js`
- **Requisitos:** REQ-002, REQ-003, REQ-007, REQ-012
- **Ação:** Criar callable `autoAssignAdaptiveExperiment` sem expor `ADMIN_KEY` no app do aluno.
- **Detalhes:**
  - Entrada: `userId`, `isisToken`.
  - Validar `isisToken` com `ISIS_JWT_SECRET`.
  - Rejeitar se `ISIS_JWT_SECRET` ausente.
  - Rejeitar se `jwt.verify` falhar.
  - Rejeitar se `String(payload.id) !== String(userId)`.
  - Deve chamar a mesma lógica de `autoAssignParticipant`.
  - Não deve permitir criar/editar/remover experimento.
  - Deve ser idempotente.
- **Verificação:** app consegue autoatribuir usuário sem usar `AdaptiveAdminService._apiKey`; token inválido ou de outro usuário é rejeitado.

## Tarefa 4 — Integrar autoatribuição no cadastro/login do app

- **Tipo:** frontend
- **Arquivos prováveis:**
  - `osi-solucoes/lib/features/presenter/viewmodels/cadastro_store.dart`
  - novo serviço se necessário: `osi-solucoes/lib/core/services/adaptive_experiment_service.dart`
- **Requisitos:** REQ-003, REQ-007, REQ-012
- **Ação:** Em `CadastroStore.cadastraUser()`, após `loginRepository.login(...)` retornar `Authentication(usuario, token)` válido e antes de retornar `sucesso`, chamar `AdaptiveExperimentService.autoAssign(userId, token)`.
- **Detalhes:**
  - Não adicionar listener.
  - Não exigir clique do aluno.
  - Não usar `AdaptiveAdminService`.
  - Se não houver experimento ativo, manter fluxo atual.
  - Se autoatribuição falhar, usar fallback atual sem quebrar Home.
- **Verificação:** usuário recém-cadastrado entra na Home já com modo experimental quando há experimento ativo; se não houver experimento, cadastro/login continua funcionando.

## Tarefa 5 — Implementar avanço de período em lote

- **Tipo:** backend
- **Arquivo:** `getAdaptiveInterface/index.js`
- **Requisitos:** REQ-004, REQ-006, REQ-008
- **Ação:** Implementar ação `advanceExperimentPeriod`.
- **Detalhes:**
  - Entrada: `experimentId`.
  - Validar `currentPeriod < maxPeriods`.
  - Atualizar todos os participantes registrados.
  - Para cada usuário, selecionar condição do próximo período no grupo dele.
  - Atualizar `userAdaptiveConfig` com `period`, `condition`, `mode`, `updatedAt`.
  - Criar novo `sessionId` e `sessionNavigations` se novo modo for `INSTANT`.
  - Remover/limpar `sessionId` se novo modo for `STATIC`.
  - Atualizar `experimentalGroups/{experimentId}.currentPeriod`.
- **Verificação:** Grupo A muda STATIC→INSTANT, Grupo B muda INSTANT→STATIC.

## Tarefa 6 — Permitir ajuste manual de grupo/condição por usuário

- **Tipo:** backend + frontend admin
- **Arquivos prováveis:**
  - `getAdaptiveInterface/index.js`
  - `osi-solucoes/lib/core/services/adaptive_admin_service.dart`
  - `osi-solucoes/lib/features/presenter/views/adaptive_admin/adaptive_admin_page.dart`
- **Requisitos:** REQ-005
- **Ação:** Implementar ação `assignParticipantToGroup` no backend e UI administrativa para trocar usuário de grupo.
- **Detalhes:**
  - Entrada: `userId`, `experimentId`, `groupId`, `period`.
  - Atualizar `testGroup`, `groupName`, `period`, `condition`, `mode`.
  - Atualizar array `participants` do experimento removendo duplicidade/entrada antiga.
- **Verificação:** Admin troca usuário de group_a para group_b e o Firestore reflete a mudança.

## Tarefa 7 — Implementar encerramento de experimento

- **Tipo:** backend
- **Arquivo:** `getAdaptiveInterface/index.js`
- **Requisitos:** REQ-011
- **Ação:** Implementar ação `completeExperiment`.
- **Detalhes:**
  - Entrada: `experimentId`.
  - Atualizar `experimentalGroups/{experimentId}` com:
    - `status: 'completed'`
    - `autoAssign: false`
    - `completedAt: serverTimestamp()`
    - `updatedAt: serverTimestamp()`
  - Não apagar participantes, configs ou sessões.
  - Autoatribuição deve ignorar experimentos `completed`.
- **Verificação:** Após encerrar experimento, usuário novo sem config não é autoatribuído a ele.

## Tarefa 8 — Expandir `AdaptiveAdminService`

- **Tipo:** frontend
- **Arquivo:** `osi-solucoes/lib/core/services/adaptive_admin_service.dart`
- **Requisitos:** REQ-001, REQ-004, REQ-005
- **Ação:** Adicionar métodos administrativos:
  - `listExperiments()`
  - `createExperiment(...)`
  - `deleteExperiment(experimentId)`
  - `advanceExperimentPeriod(experimentId)`
  - `completeExperiment(experimentId)`
  - `assignParticipantToGroup(...)`
- **Observação:** Não usar esse service no fluxo do aluno para autoatribuição, pois ele contém `ADMIN_KEY` hardcoded.
- **Verificação:** `flutter analyze` no arquivo.

## Tarefa 9 — Atualizar tela admin para Experimentos

- **Tipo:** frontend
- **Arquivo provável:** `osi-solucoes/lib/features/presenter/views/adaptive_admin/adaptive_admin_page.dart`
- **Requisitos:** REQ-001, REQ-004, REQ-005
- **Ação:** Adicionar visão/seção de experimentos na tela admin.
- **Detalhes:**
  - Cards de experimentos ativos.
  - Mostrar `currentPeriod`, grupos, condições, total de participantes.
  - Botão `Criar experimento`.
  - Botão `Avançar período` com confirmação.
  - Botão `Encerrar experimento` com confirmação forte.
  - Ação de ajuste manual por usuário.
  - Se o arquivo crescer demais, extrair componentes.
- **Verificação:** Admin cria experimento e avança período pela UI.

## Tarefa 10 — Atualizar listagem de usuários com metadados experimentais

- **Tipo:** frontend
- **Arquivo provável:** `adaptive_admin_page.dart`
- **Requisitos:** REQ-005, REQ-008
- **Ação:** Exibir `experimentId`, `testGroup`, `participantId`, `period`, `condition` nos usuários configurados.
- **Detalhes:**
  - Adicionar filtro por experimento/grupo.
  - Deixar claro o modo atual efetivo.
- **Verificação:** Lista mostra participantes do experimento e permite filtrar grupo A/B.

## Tarefa 11 — Validação integrada

- **Tipo:** validação
- **Requisitos:** todos
- **Ação:** Validar fluxo completo.
- **Comandos:**
  - Backend: `node -c index.js`
  - Frontend: `flutter analyze` nos arquivos alterados
- **Teste manual:**
  1. Criar experimento ativo.
  2. Criar/logar quatro usuários novos pelo fluxo de cadastro.
  3. Confirmar A/B/A/B.
  4. Confirmar sessions apenas para INSTANT.
  5. Avançar período.
  6. Deslogar/logar e confirmar modo novo na Home.
  7. Encerrar experimento e confirmar que novo usuário não entra nele.

## Paralelismo

| Tarefa | Dependências | Pode rodar em paralelo |
| --- | --- | --- |
| T1 | nenhuma | T8 parcialmente |
| T2 | T1 | — |
| T3 | T2 | — |
| T4 | T3 | T9/T10 depois do contrato definido |
| T5 | T1 | T8/T9 |
| T6 | T1 | T9/T10 |
| T7 | T1 | T8/T9 |
| T8 | contrato de T1/T5/T6/T7 | T9 |
| T9 | T8 | T10 |
| T10 | T8 | T9 |
| T11 | todas | — |

## Sequência recomendada

1. T1 — CRUD do experimento.
2. T2 — autoatribuição round-robin.
3. T3 — função segura com token ISIS.
4. T4 — cadastro/login autoatribui usuário novo.
5. T5 — avanço de período.
6. T7 — encerramento do experimento.
7. T8/T9/T10 — UI admin.
8. T6 — ajuste manual.
9. T11 — validação integrada.
