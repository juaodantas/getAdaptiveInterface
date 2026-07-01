# Spec — Modo INSTANT Aprimorado da Cloud Function `getAdaptiveInterface`

## 1. Contexto

Esta spec detalha a evolução do modo `INSTANT` no repositório `getAdaptiveInterface/`, seguindo a spec guarda-chuva:

`/home/joao/Documentos/personal/mestras/.specs/features/perceptible-adaptive-mode/spec.md`

O experimento compara:

- `STATIC`: grupo controle.
- `INSTANT`: grupo experimental aprimorado.

Não deve ser criado um quarto modo e não deve ser usada flag `perceptible`. O comportamento aprimorado fica embutido no modo `INSTANT`.

Nesta primeira versão, a Firebase Function não deve consultar a ISIS diretamente. O app Flutter enviará um `operationalContext` compacto derivado de `homeDashboard`, stores locais e navegação da sessão.

## 2. Problem statement

O modo `INSTANT` atual usa navegações da sessão e Gemini, mas produz adaptações pouco perceptíveis, de baixa confiança visual e sem contexto operacional da conta. Para o teste moderado, o `INSTANT` precisa:

1. receber contexto operacional compacto;
2. usar Gemini com regras de domínio explícitas;
3. validar a saída pós-Gemini;
4. retornar instruções de UI mais ricas;
5. preservar e ampliar métricas para documentação do experimento.

Sem isso, o `INSTANT` tende a se parecer com o `STATIC`, comprometendo a comparação experimental.

## 3. Goals

- Aprimorar o modo `INSTANT` como modo experimental.
- Manter `STATIC` como controle.
- Não criar flag `perceptible`.
- Não criar quarto modo.
- Receber `sessionId`, dados de navegação, `operationalContext` e `clientCapabilities`.
- Aceitar `sessionId` tanto em `data.sessionId` quanto em `data.session.sessionId` durante a transição de contrato, exigindo ao menos um deles para `INSTANT`.
- Manter Gemini com prompt restrito por regras de domínio.
- Validar e normalizar a resposta pós-Gemini.
- Elevar `visualPriority` do `INSTANT` para `moderate` quando houver recomendação válida.
- Retornar `nextStepPrediction`, `sectionAdaptations`, `focus`, `uiTreatment`, `reason`, `reasonDetails`, `rulesApplied`, `shortcuts` e `fallback`.
- Preservar métricas existentes.
- Suportar novos eventos do modo `INSTANT` aprimorado.
- Evitar crescimento adicional relevante de `index.js` por meio de decomposição.
- Preservar campos legados da response usados pelo Flutter atual.

## 4. Non-goals

- Não alterar a ISIS nesta fase.
- Não implementar componentes Flutter nesta spec.
- Não criar novo modo além de `STATIC`, `INSTANT` e modos legados já existentes.
- Não usar barra de progresso, stepper, checklist visual ou componente equivalente.
- Não substituir Gemini por outro provedor.
- Não logar dados sensíveis ou PII.
- Não remover métricas existentes.

## 5. Requisitos rastreáveis

| ID | Requisito |
| --- | --- |
| API-REQ-001 | A Function deve tratar `STATIC` como controle. |
| API-REQ-002 | A Function deve tratar `INSTANT` como modo experimental aprimorado. |
| API-REQ-003 | A Function não deve ler, exigir ou retornar flag `perceptible`. |
| API-REQ-004 | A Function não deve criar quarto modo. |
| API-REQ-005 | `sessionId` deve ser obrigatório para `INSTANT`. |
| API-REQ-006 | A request deve aceitar `navigationContext`. |
| API-REQ-007 | A request deve aceitar `operationalContext`. |
| API-REQ-008 | A request deve aceitar `clientCapabilities`. |
| API-REQ-009 | O prompt Gemini deve incluir regras de domínio para o roteiro do teste moderado. |
| API-REQ-010 | A resposta do Gemini deve passar por normalização e validação pós-modelo. |
| API-REQ-011 | Recomendações inválidas devem cair para fallback determinístico. |
| API-REQ-012 | Recomendação válida em `INSTANT` deve retornar `visualPriority: "moderate"`. |
| API-REQ-013 | A response deve conter `nextStepPrediction`. |
| API-REQ-014 | A response deve conter `sectionAdaptations`. |
| API-REQ-015 | A response deve conter `focus`. |
| API-REQ-016 | A response deve conter `uiTreatment`. |
| API-REQ-017 | A response deve conter `reason`. |
| API-REQ-018 | A response deve conter `rulesApplied`. |
| API-REQ-019 | A response deve conter `shortcuts`. |
| API-REQ-020 | A response deve conter `fallback`. |
| API-REQ-021 | A Function não deve retornar barra de progresso ou equivalente. |
| API-REQ-022 | Métricas existentes devem continuar funcionando. |
| API-REQ-023 | Novos eventos do `INSTANT` aprimorado devem ser suportados. |
| API-REQ-024 | A Function deve aceitar `sessionId` legado em `data.sessionId` e novo em `data.session.sessionId`, exigindo ao menos um para `INSTANT`. |
| API-REQ-025 | A response deve preservar os campos legados `dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority` e `reason`. |
| API-REQ-026 | `GRADUAL` deve permanecer como modo legado existente, sem criação de novo modo. |
| API-REQ-027 | `resourceName` e qualquer texto livre identificável não devem ser enviados ao Gemini no fluxo novo. |
| API-REQ-028 | Rotas permitidas devem ser centralizadas em allowlist hardcoded na Function nesta fase; o Flutter não deve enviar `allowedRoutes`. |
| API-REQ-029 | `reason` deve preservar o contrato legado como `string|null`; explicação estruturada deve ser retornada em `reasonDetails` como campo novo aditivo. |

## 6. Contrato de request

Durante a transição, o identificador de sessão pode chegar em dois formatos:

- legado: `data.sessionId`;
- novo: `data.session.sessionId`.

Para `INSTANT`, a Function deve resolver `sessionId` por prioridade `data.session.sessionId ?? data.sessionId`. Se ambos estiverem ausentes, vazios ou inválidos, a Function deve rejeitar a chamada com erro Cloud Functions `invalid-argument`, sem chamar Gemini e sem gravar métricas que dependam de `session_id` válido. `STATIC` e `GRADUAL` mantêm comportamento legado e não passam a exigir sessão por causa desta spec.

O Flutter não envia `allowedRoutes`; a Function deve aplicar uma allowlist centralizada e hardcoded conforme a seção 9.6.

```json
{
  "contextVersion": "1.0",
  "mode": "INSTANT",
  "userId": "123",
  "hour": 14,
  "session": {
    "sessionId": "moderated-session-001",
    "locale": "pt-BR",
    "timestamp": "2026-06-30T14:00:00.000Z"
  },
  "navigationContext": {
    "currentRoute": "/homePage",
    "previousRoute": "/agendaPage",
    "recentRoutes": ["/lotePage", "/agendaPage", "/homePage"],
    "sessionClickCount": 6
  },
  "operationalContext": {
    "generatedAt": "2026-06-30T14:00:00.000Z",
    "dashboardState": {
      "hasActiveLots": true,
      "activeLotsCount": 1,
      "finishedLotsCount": 0,
      "hasProtocolLinkedToLatestLot": true,
      "hasUpcomingHarvests": false
    },
    "agendaState": {
      "hasGeneratedActivities": true,
      "pendingActivitiesTodayCount": 3,
      "overdueActivitiesCount": 0,
      "completedActivitiesTodayCount": 0,
      "nextActivity": {
        "type": "nutritional_adjustment",
        "status": "pending",
        "dueLabel": "Hoje"
      }
    },
    "fieldNotebookState": {
      "hasRecentNutritionAdjustmentRecord": false,
      "latestRecordType": null
    },
    "productionState": {
      "hasProductionData": false,
      "harvestedPlantsLast30d": 0,
      "producedPackagesLast30d": 0
    },
    "alertState": {
      "hasCriticalAlerts": false,
      "criticalCount": 0,
      "highestSeverity": null,
      "types": []
    },
    "testSequenceSignals": {
      "lotWithProtocolCreated": true,
      "generatedActivitiesSeen": false,
      "nutritionAdjustmentExecuted": false,
      "fieldNotebookChecked": false,
      "agendaActivitiesCompleted": false,
      "finalHomeChecked": false
    }
  },
  "clientCapabilities": {
    "supportedComponents": [
      "NextStepCard",
      "ContextualOnboardingCard",
      "ActivityFeedCard",
      "AdaptiveFocusBanner",
      "AdaptiveReasonChip",
      "AdaptiveHighlightFrame",
      "EmptySectionWithAction",
      "AdaptiveRecommendedActionTile"
    ],
    "supportsInfoIconExplanation": true,
    "supportsHighlightFrame": true,
    "maxShortcuts": 4,
    "maxSectionAdaptations": 4,
    "forbiddenComponents": ["WorkflowProgressBar", "TestProgressBar", "ProgressStepper"]
  }
}
```

## 7. Contrato de response

A response do `INSTANT` aprimorado é aditiva. Ela deve preservar os campos legados consumidos atualmente pelo cliente: `dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority` e `reason`. Campos novos não podem remover nem alterar o tipo desses campos legados.

O campo legado `reason` deve permanecer `string|null`. A explicação estruturada para UI deve ser retornada no novo campo aditivo `reasonDetails`, sem alterar o contrato legado.

```json
{
  "responseVersion": "1.0",
  "mode": "INSTANT",
  "source": "adaptive",
  "dashboard": "Tarefas Pendentes",
  "dashboardId": "TAREFAS_PENDENTES",
  "cardType": "tarefas",
  "confidence": 0.84,
  "visualPriority": "moderate",
  "nextStepPrediction": {
    "stepId": "check_generated_agenda_activities",
    "confidence": 0.84,
    "title": "Verifique as atividades geradas na Agenda",
    "description": "O lote com protocolo já foi criado. Agora confira as atividades geradas para continuar o fluxo.",
    "targetRoute": "/agendaPage",
    "actionLabel": "Abrir Agenda"
  },
  "sectionAdaptations": [
    {
      "sectionId": "recommended_actions",
      "component": "NextStepCard",
      "priority": "high",
      "treatment": "prominent",
      "title": "Verifique as atividades geradas na Agenda",
      "description": "Há atividades pendentes criadas pelo protocolo do lote."
    }
  ],
  "shortcuts": [
    {
      "route": "/agendaPage",
      "confidence": 0.84,
      "label": "Abrir Agenda",
      "reason": "Há atividades geradas pelo protocolo do lote."
    }
  ],
  "focus": {
    "component": "AdaptiveFocusBanner",
    "message": "Próximo foco: conferir as atividades geradas na Agenda.",
    "targetSectionId": "recommended_actions",
    "priority": "high"
  },
  "uiTreatment": {
    "density": "comfortable",
    "emphasis": "moderate",
    "animation": "subtle",
    "explanationVisibility": "low",
    "showProgressBar": false
  },
  "reason": "A recomendação foi feita porque já existe um lote com protocolo e há atividades pendentes na Agenda.",
  "reasonDetails": {
    "summary": "A recomendação foi feita porque já existe um lote com protocolo e há atividades pendentes na Agenda.",
    "details": ["lotWithProtocolCreated=true", "pendingActivitiesTodayCount=3"],
    "display": "info_icon"
  },
  "rulesApplied": [
    "RULE_NO_PROGRESS_BAR",
    "RULE_AGENDA_AFTER_LOT_WITH_PROTOCOL",
    "RULE_USE_OPERATIONAL_CONTEXT_ONLY",
    "RULE_LIMIT_TO_CLIENT_CAPABILITIES"
  ],
  "fallback": {
    "used": false,
    "reason": null
  }
}
```

## 8. Regras de domínio para o roteiro

| ID | Condição | Recomendação |
| --- | --- | --- |
| RULE-001 | Não há lote com protocolo | Recomendar cadastro de lote com protocolo. |
| RULE-002 | Lote com protocolo criado e atividades geradas não conferidas | Recomendar Agenda. |
| RULE-003 | Próxima atividade é ajuste nutricional e ainda não foi executada | Recomendar execução do ajuste. |
| RULE-004 | Ajuste executado e registro recente existe | Recomendar Caderno de Campo. |
| RULE-005 | Caderno conferido e ainda há pendências | Recomendar conclusão na Agenda. |
| RULE-006 | Atividades concluídas | Recomendar conferência final na Home. |
| RULE-007 | Há tarefas atrasadas | Priorizar Agenda/tarefas sobre produção. |
| RULE-008 | Há alertas críticos | Priorizar atenção operacional. |
| RULE-009 | Não há dados de produção | Sugerir substituição por contexto/onboarding, não destacar produção vazia. |
| RULE-010 | Componente de progresso solicitado | Rejeitar e aplicar fallback/normalização. |

## 9. Design técnico

### 9.1 Fluxo do `INSTANT`

1. Validar request.
2. Resolver modo efetivo.
3. Buscar navegações da sessão no Firestore, quando aplicável.
4. Normalizar `operationalContext`.
5. Aplicar regras determinísticas para gerar sinais iniciais.
6. Construir prompt Gemini com navegação + contexto + regras + schema.
7. Chamar Gemini.
8. Parsear JSON.
9. Normalizar resposta.
10. Validar resposta pós-Gemini contra contexto e capacidades do cliente.
11. Aplicar fallback se necessário.
12. Retornar `visualPriority: "moderate"` em recomendação válida.

### 9.2 Validação de entrada

- `sessionId` obrigatório para `INSTANT`, aceitando `data.session.sessionId` e `data.sessionId`.
- Ausência de `sessionId` válido em `INSTANT` deve retornar erro Cloud Functions `invalid-argument` antes de qualquer chamada ao Gemini.
- `operationalContext`, se enviado, deve ser objeto.
- `clientCapabilities.maxShortcuts` deve ser inteiro positivo com limite máximo seguro.
- `recentRoutes` deve ser array de strings.
- `allowedRoutes` enviado pelo cliente, se existir, deve ser ignorado.
- Campos desconhecidos devem ser ignorados.

### 9.3 Prompt Gemini

O prompt deve conter:

- papel do modelo como recomendador conservador;
- navegações da sessão;
- contexto operacional compacto;
- lista de componentes suportados;
- rotas permitidas;
- regras de domínio;
- proibição de barra de progresso, stepper e checklist;
- schema JSON obrigatório.

O prompt não deve conter `resourceName`, nomes de lotes, nomes de tarefas, nomes de usuários ou outros textos livres identificáveis. Quando navegações legadas contiverem `resourceName`, esse campo deve ser removido antes da montagem do prompt. O Gemini deve receber somente rotas, tipos técnicos, IDs técnicos quando estritamente necessários, contagens, flags e categorias permitidas.

### 9.4 Normalização e validação pós-Gemini

Rejeitar respostas que:

- referenciem componentes não suportados;
- referenciem rotas excluídas;
- inventem entidades/pedidos não presentes;
- usem progress bar/stepper/checklist;
- excedam limites de atalhos/seções;
- não possuam campos mínimos.

### 9.5 Rotas permitidas

As rotas permitidas devem ficar centralizadas em uma allowlist hardcoded na Function nesta fase, derivada da spec guarda-chuva e do contrato atual. O Flutter não envia `allowedRoutes`.

Allowlist inicial:

- `/areaCultivoPage`
- `/setorPage`
- `/lotePage`
- `/reservatoriosPage`
- `/solucaoPage`
- `/agendaPage`
- `/cadernoCampoPage`
- `/gerenciarEquipePage`
- `/relatoriosPage`
- `/historicoPage`
- `/ajustesPage`
- `/protocoloPage`

Rotas fora dessa lista devem ser rejeitadas na validação pós-Gemini e substituídas por fallback seguro quando necessário.

### 9.6 Fallback

Fallback determinístico do `INSTANT`:

1. Se falta lote com protocolo, recomendar lote/protocolo.
2. Se há lote com protocolo e atividades não vistas, recomendar Agenda.
3. Se há ajuste pendente, recomendar Ajuste/Solução.
4. Se há ajuste executado e registro, recomendar Caderno de Campo.
5. Se há pendências após caderno, recomendar Agenda.
6. Se concluído, recomendar Home final.

## 10. Métricas

### 10.1 Manter eventos existentes

- `session_start`
- `adaptive_session_start`
- `shortcuts_shown`
- `shortcut_clicked`
- `dashboard_shown`
- `dashboard_changed`
- `first_productive_navigation`

### 10.2 Suportar novos eventos

| Evento | Parâmetros mínimos |
| --- | --- |
| `instant_adaptation_applied` | `mode`, `session_id`, `response_time_ms`, `fallback_used`, `section_adaptations_count` |
| `next_step_shown` | `mode`, `session_id`, `step_id`, `target_route`, `source` |
| `next_step_clicked` | `mode`, `session_id`, `step_id`, `target_route` |
| `section_highlight_shown` | `mode`, `session_id`, `section_id`, `component`, `treatment` |
| `section_highlight_clicked` | `mode`, `session_id`, `section_id`, `route` |
| `info_icon_opened` | `mode`, `session_id`, `section_id`, `component` |
| `contextual_onboarding_shown` | `mode`, `session_id`, `section_id`, `component` |
| `contextual_onboarding_clicked` | `mode`, `session_id`, `section_id`, `target_route` |

Não registrar nomes de lotes, tarefas, usuários ou texto livre.

`session_start` é o evento legado observado no código atual; `adaptive_session_start` deve ser suportado para compatibilidade com a spec guarda-chuva e análises futuras. A implementação não deve quebrar consultas ou agregações existentes baseadas em `session_start`.

## 11. Arquivos alvo e decomposição

`index.js` já é grande e não deve receber toda a nova lógica.

Arquivos/módulos prováveis:

```text
src/adaptiveModes.js
src/operationalContextValidator.js
src/instantDomainRules.js
src/instantPromptBuilder.js
src/geminiClient.js
src/instantResponseNormalizer.js
src/instantResponseValidator.js
src/instantFallbackBuilder.js
src/adaptiveMetrics.js
src/adaptiveContract.js
```

Responsabilidades:

- `index.js`: orquestração e boundary da Cloud Function; não deve concentrar prompt, regras, validação, fallback ou allowlist.
- `operationalContextValidator.js`: validação defensiva.
- `instantDomainRules.js`: regras do roteiro e contexto.
- `instantPromptBuilder.js`: montagem do prompt.
- `instantResponseNormalizer.js`: normalização JSON.
- `instantResponseValidator.js`: validação pós-Gemini.
- `instantFallbackBuilder.js`: respostas seguras.
- `adaptiveMetrics.js`: suporte a eventos.
- `adaptiveContract.js`: resolução de `sessionId`, preservação de campos legados e constantes de contrato, incluindo modos e rotas permitidas.

## 12. Critérios de aceitação

- [ ] `STATIC` continua controle.
- [ ] `INSTANT` usa contexto operacional quando enviado.
- [ ] Nenhuma flag `perceptible` é usada.
- [ ] Nenhum quarto modo é criado.
- [ ] `GRADUAL` continua existindo como modo legado e não é substituído por novo modo.
- [ ] `sessionId` é obrigatório para `INSTANT`.
- [ ] Request `INSTANT` com `data.session.sessionId` válido é aceita.
- [ ] Request `INSTANT` com apenas `data.sessionId` legado válido é aceita.
- [ ] Request `INSTANT` sem `data.session.sessionId` e sem `data.sessionId` retorna erro `invalid-argument`, sem chamada ao Gemini.
- [ ] Gemini recebe regras do roteiro.
- [ ] Gemini não recebe `resourceName`, nomes de lotes, nomes de tarefas, nomes de usuários nem texto livre identificável.
- [ ] Resposta Gemini inválida vira fallback.
- [ ] Recomendação válida retorna `visualPriority: "moderate"`.
- [ ] Response preserva os campos legados `dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority` e `reason`.
- [ ] `reason` preserva o tipo legado `string|null` em todos os caminhos de resposta, incluindo fallback.
- [ ] Response inclui `nextStepPrediction`, `sectionAdaptations`, `focus`, `uiTreatment`, `reason`, `reasonDetails`, `rulesApplied`, `shortcuts`, `fallback`.
- [ ] `reasonDetails`, quando presente, contém explicação estruturada com `summary`, `details` e `display`, sem substituir `reason`.
- [ ] Componentes proibidos de progresso são rejeitados.
- [ ] Rotas retornadas por Gemini são aceitas somente se estiverem na allowlist hardcoded centralizada da Function.
- [ ] Métricas existentes continuam funcionando.
- [ ] `session_start` legado e `adaptive_session_start` são suportados sem quebrar agregações existentes.
- [ ] Novos eventos são suportados sem PII.
- [ ] `index.js` não concentra prompt, regras, validação e fallback.

## 13. Estratégia de testes

Usar Jest conforme estrutura atual.

Testes recomendados:

- contrato `STATIC`;
- contrato `INSTANT` com contexto válido;
- request `INSTANT` sem `sessionId`;
- request `INSTANT` com `data.sessionId` legado;
- request `INSTANT` com `data.session.sessionId` novo;
- prompt contém regras e proibições;
- normalizer trata JSON inválido;
- validator rejeita rota/componente proibido;
- fallback por falha Gemini;
- fallback por contexto insuficiente;
- `visualPriority` moderate em recomendação válida;
- preservação de `reason` como `string|null` e retorno de explicação estruturada em `reasonDetails`;
- payloads de métricas sem PII;
- manutenção de `session_start` e suporte a `adaptive_session_start`.

Não chamar Gemini real em testes unitários; usar mock.

## 14. Riscos

| Risco | Mitigação |
| --- | --- |
| Gemini sugerir ação inválida | Prompt restrito + validação pós-Gemini. |
| `INSTANT` não ser perceptível | `visualPriority: moderate` + campos de UI ricos. |
| `INSTANT` ficar intrusivo | Limite em `moderate`, sem progress bar/checklist. |
| Quebra de compatibilidade | Campos novos aditivos e preservação de métricas. |
| `index.js` crescer demais | Decomposição obrigatória em módulos. |
| PII em logs/métricas | Sanitização e payload mínimo. |
| PII no Gemini via navegação legada | Remover `resourceName` e textos livres antes do prompt. |

## 15. Tasks de alto nível

1. Mapear contrato atual da Function.
2. Criar módulo de validação de `operationalContext`.
3. Criar regras de domínio do INSTANT.
4. Criar prompt builder.
5. Isolar cliente Gemini, se ainda não estiver isolado.
6. Criar normalizer e validator de response.
7. Criar fallback builder.
8. Integrar fluxo no modo `INSTANT`.
9. Ajustar `visualPriority` para `moderate` em recomendação válida.
10. Preservar métricas existentes.
11. Adicionar suporte aos novos eventos.
12. Escrever testes Jest de contrato, regras, fallback e validação.

## 16. Questões resolvidas

1. O contrato atual deve preservar os campos legados `dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority` e `reason`.
2. A lista de rotas permitidas ficará hardcoded e centralizada na Function nesta fase; o Flutter não enviará `allowedRoutes`.
3. `sessionId` é obrigatório para `INSTANT`, mas a Function aceita os formatos `data.sessionId` e `data.session.sessionId` por compatibilidade. Sem nenhum dos dois, retorna `invalid-argument`.
4. `reason` preserva o tipo legado `string|null`; a explicação estruturada fica no novo campo aditivo `reasonDetails`.

## 17. Open questions

Nenhuma questão bloqueante conhecida para implementação segura desta spec.

## 18. Decisões herdadas da spec guarda-chuva

- Timeout recomendado para a chamada adaptativa/Gemini: 5 segundos.
- Eventos novos devem ser suportados preservando os eventos atuais e sem registrar PII.
- O Flutter será o principal responsável por registrar eventos de exposição/interação de UI; a Function deve retornar metadados suficientes para correlação por `sessionId` e pode registrar métricas técnicas de processamento quando apropriado.
