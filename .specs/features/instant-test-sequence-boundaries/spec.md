# Spec — Priorização da sequência experimental de teste no modo INSTANT

## 1. Contexto

O modo `INSTANT` da Cloud Function `getAdaptiveInterface` hoje usa `deriveInstantSignals` em `src/instantDomainRules.js` para decidir o próximo passo. As regras atuais priorizam alertas críticos, tarefas atrasadas e outros sinais operacionais antes dos passos do roteiro experimental.

Para o teste controlado com alunos, o aplicativo funcionará exclusivamente no cenário experimental. O roteiro é fechado e conhecido:

1. cadastrar lote com protocolo;
2. ir para Home;
3. verificar atividades na Agenda;
4. ir para Home;
5. cadastrar Pulverização Enraizador no Caderno de Campo;
6. ir para Home;
7. marcar atividades como concluídas na Agenda;
8. ir para Home;
9. logout.

As recomendações adaptativas devem seguir rigorosamente esse roteiro, com limites prescritivos para o Gemini, que apenas estrutura e formata textualmente a decisão já tomada pelas regras.

A spec complementar `.specs/features/instant-shared-recommendation-cache/spec.md` define o cache compartilhado de recomendações INSTANT, mas depende de `stepId` e `contextProfile` estáveis — exatamente o que esta especificação fornece.

## 2. Problem statement

- As regras atuais de `deriveInstantSignals` colocam alertas críticos e tarefas atrasadas acima dos passos do roteiro de teste, fazendo o sistema recomendar algo não alinhado.
- O Gemini recebe `stepContext` genérico e pode escolher rotas, shortcuts e InfoCards fora do esperado para cada etapa do teste.
- A validação final (`validateInstantResponse`) exige `sectionAdaptations`, `focus` e `uiTreatment`, mas o schema pedido no prompt não os inclui, causando queda desnecessária para fallback.
- A regra atual de rotas obrigatoriamente diferentes entre `targetRoute`, `ctaRoute` e shortcuts conflita com a sequência desejada, onde a primeira ação recomendada deve repetir o destino principal.

## 3. Goals

- **ITS-REQ-001 — Prioridade zero para roteiro de teste:** A sequência experimental deve ser a primeira camada de decisão em `deriveInstantSignals`, superando alertas críticos e demais heurísticas operacionais enquanto o experimento estiver ativo.
- **ITS-REQ-002 — StepId estável durante o teste:** Cada Home do roteiro deve produzir um `stepId` determinístico e previsível.
- **ITS-REQ-003 — StepContext prescritivo para Gemini:** Enviar ao Gemini `focusMessage`, `expectedInfoType`, `requiredShortcutRoutes` e `forbiddenRoutes` como parte do contexto, para que ele formate mas não decida o caminho.
- **ITS-REQ-004 — Opção B (primeiro shortcut repete targetRoute):** O primeiro shortcut pode repetir `nextStepPrediction.targetRoute` quando representa a ação principal da etapa. Os demais shortcuts e `infoRecommendation.ctaRoute` devem evitar duplicidade.
- **ITS-REQ-005 — Alinhamento prompt-validação:** O schema obrigatório no prompt deve incluir `sectionAdaptations`, `focus` e `uiTreatment` para corresponder ao que o validador final exige.
- **ITS-REQ-006 — InfoCard correto por etapa:** O `infoRecommendation.type` deve seguir o tipo esperado de cada Home do roteiro.
- **ITS-REQ-007 — Cache compartilhável:** A sequência priorizada gera poucas chaves de cache estáveis por `stepId`/`contextProfile`, maximizando reaproveitamento.
- **ITS-REQ-008 — Compatibilidade:** Fora do experimento (sem testSequenceSignals com experimentId), as regras operacionais atuais continuam valendo com a hierarquia original.

## 4. Non-goals

- Não alterar o cache compartilhado definido na spec complementar.
- Não criar novo modo adaptativo.
- Não alterar campos existentes do contrato `INSTANT` (novos campos podem ser adicionados via spec complementar).
- Não alterar o app Flutter além do necessário para reportar sinais.
- Não remover o Gemini do fluxo.

## 5. Sequência do roteiro de teste

### 5.1 Sinais de sequência

Os seguintes sinais são emitidos pelo app e enviados via `operationalContext.testSequenceSignals`:

| Sinal | Origem (app) |
| --- | --- |
| `lotWithProtocolCreated` | Após sucesso real de cadastro/alteração de lote com protocolo |
| `generatedActivitiesSeen` | Após carregar Agenda com atividades do dia e lote com protocolo existir |
| `adjustmentRecorded` | Após sucesso real de criar registro "Pulverização Enraizador" no Caderno de Campo |
| `agendaActivitiesCompleted` | Após sucesso real de marcar atividades como concluídas na Agenda |
| `finalHomeChecked` | Ao carregar Home após todas as etapas anteriores concluídas |

### 5.2 Prioridade em deriveInstantSignals

```text
1. [NOVO] Test sequence detection (se experimento ativo)
   └─ stepId determinístico baseado nos sinais de sequência
2. [ATUAL] Critical alerts (mantido para segurança, mas após sequência)
3. [ATUAL] Overdue tasks
4. [ATUAL] Field notebook / caderno
5. [ATUAL] Today tasks
6. [ATUAL] Demais sinais operacionais
```

**Importante:** Se `testSequenceSignals` indicar experimento ativo, a sequência de teste é a única fonte de `stepId` até que o fluxo se complete (`finalHomeChecked`). Fora disso, as regras operacionais normais são usadas para compatibilidade.

### 5.3 Mapeamento por etapa

#### Etapa 1 — Home inicial

Estado esperado:

```json
{
  "lotWithProtocolCreated": false,
  "generatedActivitiesSeen": false,
  "adjustmentRecorded": false,
  "agendaActivitiesCompleted": false,
  "finalHomeChecked": false
}
```

Regra:

```js
stepId: "test_create_lot_with_protocol"
targetRoute: "/lotePage"
focusMessage: "Comece criando seu primeiro lote"
requiredShortcutRoutes: ["/lotePage", "/protocoloPage", "/areaCultivoPage"]
expectedInfoType: "basic_tip"
```

> **Nota:** O card de onboarding dedicado (`OperationalOnboardingCard`) agora é servido via campo top-level `operationalOnboarding` na resposta INSTANT. Ver spec complementar `.specs/features/instant-operational-onboarding/spec.md`.

---

#### Etapa 2 — Após cadastrar lote com protocolo

Estado esperado:

```json
{
  "lotWithProtocolCreated": true,
  "generatedActivitiesSeen": false,
  "adjustmentRecorded": false,
  "agendaActivitiesCompleted": false,
  "finalHomeChecked": false
}
```

Regra:

```js
stepId: "test_check_generated_activities"
targetRoute: "/agendaPage"
focusMessage: "Confira a Agenda antes de seguir."
requiredShortcutRoutes: ["/agendaPage", "/lotePage", "/cadernoCampoPage"]
expectedInfoType: "today_cultivation"
```

---

#### Etapa 3 — Após verificar atividades na Agenda

Estado esperado:

```json
{
  "lotWithProtocolCreated": true,
  "generatedActivitiesSeen": true,
  "adjustmentRecorded": false,
  "agendaActivitiesCompleted": false,
  "finalHomeChecked": false
}
```

Regra:

```js
stepId: "test_record_adjustment"
targetRoute: "/cadernoCampoPage"
focusMessage: "Caderno de campo - Registrar atividade"
requiredShortcutRoutes: ["/cadernoCampoPage", "/agendaPage", "/lotePage"]
expectedInfoType: "today_cultivation"
```

---

#### Etapa 4 — Após cadastrar Pulverização Enraizador no Caderno de Campo

Estado esperado:

```json
{
  "lotWithProtocolCreated": true,
  "generatedActivitiesSeen": true,
  "adjustmentRecorded": true,
  "agendaActivitiesCompleted": false,
  "finalHomeChecked": false
}
```

Regra:

```js
stepId: "test_finish_agenda"
targetRoute: "/agendaPage"
focusMessage: "Concluir na Agenda"
requiredShortcutRoutes: ["/agendaPage", "/cadernoCampoPage", "/lotePage"]
expectedInfoType: "field_notes_summary"
```

---

#### Etapa 5 — Após marcar atividades como concluídas na Agenda

Estado esperado:

```json
{
  "lotWithProtocolCreated": true,
  "generatedActivitiesSeen": true,
  "adjustmentRecorded": true,
  "agendaActivitiesCompleted": true,
  "finalHomeChecked": false
}
```

Regra:

```js
stepId: "test_review_final_home"
targetRoute: "/lotePage"
focusMessage: "Revisar Agenda - lote segue em acompanhamento"
requiredShortcutRoutes: ["/lotePage", "/cadernoCampoPage", "/agendaPage"]
expectedInfoType: "basic_tip"
```

---

#### Etapa terminal — Fluxo concluído

Estado esperado:

```json
{
  "lotWithProtocolCreated": true,
  "generatedActivitiesSeen": true,
  "adjustmentRecorded": true,
  "agendaActivitiesCompleted": true,
  "finalHomeChecked": true
}
```

Regra:

```js
stepId: "test_complete"
targetRoute: "/relatoriosPage"
focusMessage: "Roteiro de teste concluído"
requiredShortcutRoutes: ["/relatoriosPage", "/agendaPage", "/lotePage"]
expectedInfoType: "basic_tip"
```

## 6. Regra de shortcuts — Opção B

A regra atual "targetRoute, ctaRoute e cada shortcut.route devem ser TODOS DIFERENTES" é substituída no contexto do roteiro de teste por:

| Regra | Descrição |
| --- | --- |
| **Opção B** | O primeiro shortcut pode repetir `nextStepPrediction.targetRoute` quando representa a ação principal da etapa atual. |
| | Os demais shortcuts (segundo em diante) devem ter rotas diferentes entre si e diferentes de `targetRoute`. |
| | `infoRecommendation.ctaRoute` deve ser diferente de `targetRoute` e do primeiro shortcut. |
| | Se não houver rota alternativa disponível, `infoRecommendation.ctaRoute` pode omitir ou usar fallback. |

Essa regra se aplica apenas quando o experimento estiver ativo. Fora dele, a regra original de rotas todas diferentes permanece.

## 7. StepContext prescritivo para Gemini

O prompt deve incluir no payload:

```js
stepContext: {
  stepId,
  targetRoute,
  focusMessage,
  expectedInfoType,
  requiredShortcutRoutes,
  forbiddenRoutes,
  priority: "mandatory_test_sequence"
}
```

E no texto do prompt, a instrução:

```text
Quando stepContext.priority = "mandatory_test_sequence":
- Use obrigatoriamente stepContext.targetRoute em nextStepPrediction.targetRoute.
- O primeiro shortcut pode repetir stepContext.targetRoute.
- Os shortcuts seguintes devem respeitar stepContext.requiredShortcutRoutes na ordem informada.
- Use stepContext.focusMessage como base para o FocusBanner.
- Use stepContext.expectedInfoType para infoRecommendation.type.
- Não recomende rotas fora de requiredShortcutRoutes.
- Se expectedInfoType não for suportado pelo clientCapabilities, use o fallback mais próximo.
```

## 8. Alinhamento schema do prompt com validação final

O schema obrigatório pedido ao Gemini no prompt deve ser atualizado para corresponder ao que `validateInstantResponse` exige:

```json
{
  "responseVersion": "1.0",
  "confidence": 0.0,
  "nextStepPrediction": {
    "stepId": "id do passo",
    "targetRoute": "/rota",
    "title": "texto curto",
    "description": "texto curto",
    "actionLabel": "texto curto"
  },
  "infoRecommendation": {
    "type": "...",
    "source": "...",
    "priority": "...",
    "title": "texto curto",
    "reason": "texto curto",
    "ctaRoute": "/rota",
    "category": "..."
  },
  "shortcuts": [
    {
      "route": "/rota",
      "confidence": 0.0,
      "label": "texto curto",
      "reason": "texto curto"
    }
  ],
  "reason": "texto curto ou null",
  "reasonDetails": {
    "summary": "texto curto",
    "details": ["sinais técnicos"],
    "display": "info_icon"
  },
  "rulesApplied": ["RULE-010"],
  "sectionAdaptations": [
    {
      "sectionId": "recommended_actions",
      "component": "NextStepCard",
      "priority": "high",
      "treatment": "prominent",
      "title": "texto curto",
      "description": "texto curto"
    }
  ],
  "focus": {
    "component": "AdaptiveFocusBanner",
    "message": "texto curto",
    "targetSectionId": "recommended_actions",
    "priority": "high"
  },
  "uiTreatment": {
    "density": "comfortable",
    "emphasis": "moderate",
    "animation": "subtle",
    "explanationVisibility": "low",
    "showProgressBar": false
  }
}
```

## 9. Integração com cache compartilhado

A spec complementar `.specs/features/instant-shared-recommendation-cache/spec.md` define cache por `promptVersion + mode + stepId + contextProfile`.

Com a sequência priorizada, as chaves de cache esperadas são:

| Etapa | Chave de cache esperada |
| --- | --- |
| Home inicial | `instant-v1_INSTANT_test_create_lot_with_protocol_test_sequence_initial` |
| Home após lote | `instant-v1_INSTANT_test_check_generated_activities_test_sequence_lot_protocol` |
| Home após ver Agenda | `instant-v1_INSTANT_test_record_adjustment_test_sequence_activities_checked` |
| Home após caderno | `instant-v1_INSTANT_test_finish_agenda_test_sequence_adjustment_recorded` |
| Home após concluir | `instant-v1_INSTANT_test_review_final_home_test_sequence_agenda_completed` |
| Home terminal | `instant-v1_INSTANT_test_complete_test_sequence_finished` |

Isso significa que 15 usuários simultâneos no mesmo passo do roteiro geram **6 chamadas Gemini no total** (uma por etapa, na primeira vez que cada etapa for alcançada) e o restante usa cache.

## 10. Requisitos rastreáveis

| ID | Requisito | Evidência esperada |
| --- | --- | --- |
| ITS-REQ-001 | Sequência de teste tem prioridade máxima em `deriveInstantSignals` | Teste unitário confirma que estado com `lotWithProtocolCreated=true` retorna `stepId: test_check_generated_activities` mesmo com alertas críticos |
| ITS-REQ-002 | Cada Home do roteiro produz `stepId` determinístico | Teste para cada combinação de sinais retorna o `stepId` esperado |
| ITS-REQ-003 | StepContext inclui `focusMessage`, `expectedInfoType`, `requiredShortcutRoutes`, `forbiddenRoutes` e `priority` | Teste do prompt verifica payload gerado |
| ITS-REQ-004 | Primeiro shortcut pode repetir `targetRoute`; demais devem ser diferentes | Teste de validação com shortcut[0].route == targetRoute passa; shortcut[1] igual ao targetRoute falha |
| ITS-REQ-005 | Schema do prompt inclui `sectionAdaptations`, `focus` e `uiTreatment` | Teste verifica que prompt contém campos no schema obrigatório |
| ITS-REQ-006 | InfoCard segue `expectedInfoType` da etapa | Fallback usa `buildInfoRecommendationFallback` com `expectedInfoType` como preferência |
| ITS-REQ-007 | Cache compartilhável por stepId/contextProfile estável | Teste de geração de chave: contextos equivalentes geram mesma chave |
| ITS-REQ-008 | Fora do experimento, regras operacionais originais continuam | Teste com `testSequenceSignals` vazio retorna regras originais |

## 11. Critérios de aceitação

- AC-001: Dado um usuário em experimento ativo sem `lotWithProtocolCreated`, o sistema retorna `stepId: test_create_lot_with_protocol`, `targetRoute: /lotePage`, shortcuts [/lotePage, /protocoloPage, /areaCultivoPage].
- AC-002: Dado `lotWithProtocolCreated=true` e `generatedActivitiesSeen=false`, o sistema retorna `stepId: test_check_generated_activities`, `targetRoute: /agendaPage`, shortcuts [/agendaPage, /lotePage, /cadernoCampoPage].
- AC-003: Dado `generatedActivitiesSeen=true` e `adjustmentRecorded=false`, o sistema retorna `stepId: test_record_adjustment`, `targetRoute: /cadernoCampoPage`, shortcuts [/cadernoCampoPage, /agendaPage, /lotePage].
- AC-004: Dado `adjustmentRecorded=true` e `agendaActivitiesCompleted=false`, o sistema retorna `stepId: test_finish_agenda`, `targetRoute: /agendaPage`, shortcuts [/agendaPage, /cadernoCampoPage, /lotePage].
- AC-005: Dado `agendaActivitiesCompleted=true` e `finalHomeChecked=false`, o sistema retorna `stepId: test_review_final_home`, `targetRoute: /lotePage`, shortcuts [/lotePage, /cadernoCampoPage, /agendaPage].
- AC-006: Dado `finalHomeChecked=true`, o sistema retorna `stepId: test_complete`, `targetRoute: /relatoriosPage`.
- AC-007: Dado shortcut[0].route igual a targetRoute, a validação não rejeita.
- AC-008: Dado shortcut[1].route igual a targetRoute, a validação rejeita (exceto default).
- AC-009: Dados dois usuários no mesmo passo do roteiro com mesmas capabilities, a chave de cache gerada é igual e não contém userId/sessionId.
- AC-010: Dado usuário fora do experimento (`testSequenceSignals` vazio), as regras operacionais originais continuam.
- AC-011: Dado prompt enviado, o schema obrigatório contém `sectionAdaptations`, `focus` e `uiTreatment`.
- AC-012: Dado `expectedInfoType` no stepContext, o Gemini recebe instrução para usá-lo em `infoRecommendation.type`.
- AC-013: O `infoRecommendation.type` na resposta esperada de cada etapa corresponde ao `expectedInfoType` definido.

## 12. Riscos e mitigações

| Risco | Mitigação |
| --- | --- |
| ~~`OperationalOnboardingCard` não existe no contrato/clientCapabilities~~ | **RESOLVIDO**: Campo top-level `operationalOnboarding` criado na spec `.specs/features/instant-operational-onboarding/spec.md`. O card tem contrato próprio, independente de `infoRecommendation`. |
| Sinal `adjustmentRecorded` disparar cedo (apenas ao abrir caderno, não ao criar registro) | Garantir que o app dispare apenas após sucesso real da criação da Pulverização Enraizador |
| Sequência de teste ignorar alerta crítico real | Decisão consciente para o experimento. Alerta crítico ainda é visível no dashboard, mas não altera recomendação |
| Gemini escolher rotas fora do roteiro mesmo com boundaries | Validação final em `validateInstantResponse` rejeita rotas não permitidas; fallback garante roteiro |
| Usuário pular etapa (ex: marcar atividade sem ter verificado antes) | Sinais são independentes; o estado combinado determina a etapa atual. Se pular, o step avança |
| Cache compartilhado armazenar resposta de Gemini que contém PII residual | Manter sanitização atual e validação de segurança antes de gravar cache |

## 13. Observabilidade

Métricas/eventos adicionais:

| Evento | Quando emitir |
| --- | --- |
| `test_sequence_step_detected` | Quando `deriveInstantSignals` identifica que está em roteiro de teste |
| `test_sequence_step_id` | stepId da etapa atual |
| `test_sequence_gemini_replaced_by_cache` | Cache hit evitou chamada Gemini durante sequência de teste |
| `test_sequence_step_targetRoute` | Rota principal da etapa |
| `test_sequence_expected_info_type` | InfoCard esperado |

## 14. Plano de validação

- Testar `deriveInstantSignals` para cada combinação de sinais do roteiro.
- Testar que alerta crítico **não** altera stepId durante experimento ativo.
- Testar que sem experimento, alerta crítico tem prioridade original.
- Testar a Opção B: shortcut[0] repetindo targetRoute passa validação.
- Testar a Opção B: shortcut[1] repetindo targetRoute falha validação.
- Testar que o prompt gerado contém `focusMessage`, `expectedInfoType`, `requiredShortcutRoutes` e `priority`.
- Testar que o schema obrigatório no prompt inclui `sectionAdaptations`, `focus` e `uiTreatment`.
- Testar geração de chave de cache para cada etapa.
- Testar que `operationalOnboarding` é populado no top-level quando stepId = `test_create_lot_with_protocol` (ver spec complementar).

## 15. Referências

- Spec complementar: `.specs/features/instant-shared-recommendation-cache/spec.md`
- Spec complementar: `.specs/features/instant-operational-onboarding/spec.md`
- Módulo principal de regras: `src/instantDomainRules.js`
- Orquestrador INSTANT: `src/enhancedInstantMode.js`
- Builder do prompt: `src/instantPromptBuilder.js`
- Validador de resposta: `src/instantResponseValidator.js`
- Builder de fallback: `src/instantFallbackBuilder.js`
- Mapeador de contexto do app: `instant_operational_context_mapper.dart`
- Store de sinais do app: `instant_sequence_signals_store.dart`
