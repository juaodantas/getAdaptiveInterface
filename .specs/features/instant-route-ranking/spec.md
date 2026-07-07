# Spec — Ranking centralizado de rotas no modo INSTANT

## Contexto

O modo `INSTANT` atualmente gera 3 superfícies de recomendação com fontes de rota independentes:

- `nextStepPrediction.targetRoute` ← `deriveInstantSignals().targetRoute`
- `infoRecommendation.ctaRoute` ← `INFO_BY_RULE[ruleId].ctaRoute`
- `shortcuts[].route` ← `STEP_SHORTCUTS[stepId][].route`

Como as 3 derivam do mesmo step, suas rotas colidem frequentemente. A abordagem anterior de pós-processamento (swap de rotas) gerava label-route mismatch e não cobria todas as colisões.

## Solução: ranking centralizado

O backend define um **ranking fixo de N rotas** para cada step. Cada superfície consome uma posição diferente:

```
rank[0] → nextStepPrediction
rank[1] → infoRecommendation
rank[2..5] → shortcuts
```

**Zero duplicatas por construção** — nenhuma rota aparece em mais de um slot.

Gemini não escolhe rotas — ele só **enriquece** labels, descrições e razões das rotas que o backend já definiu.

## Goals

- Eliminar colisões de rota entre superfícies de recomendação
- Eliminar todo o código de pós-processamento/deduplicação
- Gemini personaliza textos, não define rotas
- Cobertura de todas as rotas disponíveis no app
- Fallback determinístico sem depender de Gemini

## Non-goals

- Não alterar o contrato de response (shape dos campos)
- Não alterar `STATIC` ou `GRADUAL`
- Não alterar `adaptiveContract.js`, `sessionContext.js`, `clientCapabilitiesValidator.js`, `operationalContextValidator.js`

## Ranking por step

Cada step define uma lista ordenada de 6 rotas. Posições 0, 1 e 2 são garantidamente diferentes.

```js
// instantDomainRules.js
const STEP_ROUTE_RANKING = {
  create_lot_with_protocol: [
    '/protocoloPage',
    '/lotePage',
    '/areaCultivoPage',
    '/agendaPage',
    '/solucaoPage',
    '/relatoriosPage',
  ],
  check_generated_activities: [
    '/agendaPage',
    '/lotePage',
    '/protocoloPage',
    '/cadernoCampoPage',
    '/relatoriosPage',
    '/solucaoPage',
  ],
  record_caderno_adjustment: [
    '/cadernoCampoPage',
    '/solucaoPage',
    '/agendaPage',
    '/relatoriosPage',
    '/protocoloPage',
    '/historicoPage',
  ],
  finish_agenda_activities: [
    '/agendaPage',
    '/cadernoCampoPage',
    '/relatoriosPage',
    '/solucaoPage',
    '/gerenciarEquipePage',
    '/historicoPage',
  ],
  review_final_home: [
    '/relatoriosPage',
    '/agendaPage',
    '/solucaoPage',
    '/historicoPage',
    '/gerenciarEquipePage',
    '/cadernoCampoPage',
  ],
  test_complete: [
    '/relatoriosPage',
    '/agendaPage',
    '/protocoloPage',
    '/historicoPage',
    '/gerenciarEquipePage',
    '/cadernoCampoPage',
  ],
  resolve_overdue_tasks: [
    '/agendaPage',
    '/gerenciarEquipePage',
    '/relatoriosPage',
    '/cadernoCampoPage',
    '/historicoPage',
    '/solucaoPage',
  ],
  review_critical_alerts: [
    '/agendaPage',
    '/gerenciarEquipePage',
    '/relatoriosPage',
    '/historicoPage',
    '/cadernoCampoPage',
    '/solucaoPage',
  ],
};
```

## Mapa rota → info metadata

Substitui `INFO_BY_RULE`. A rota da posição 1 determina os metadados do `infoRecommendation`.

```js
const ROUTE_TO_INFO_META = {
  '/agendaPage':          { type: 'day_progress',       category: 'agenda',       source: 'isis',     priority: 'high' },
  '/cadernoCampoPage':    { type: 'field_notes_summary', category: 'caderno_campo', source: 'isis',  priority: 'high' },
  '/protocoloPage':       { type: 'basic_tip',          category: 'protocolo',    source: 'local_tip', priority: 'high' },
  '/lotePage':            { type: 'basic_tip',          category: 'lote',         source: 'local_tip', priority: 'medium' },
  '/relatoriosPage':      { type: 'day_progress',       category: 'geral',        source: 'local_tip', priority: 'low' },
  '/solucaoPage':         { type: 'today_cultivation',   category: 'solucao',      source: 'isis',     priority: 'medium' },
  '/areaCultivoPage':     { type: 'today_cultivation',   category: 'cultivo',      source: 'local_tip', priority: 'low' },
  '/reservatoriosPage':   { type: 'reservoir_report',    category: 'reservatorio', source: 'isis',     priority: 'medium' },
  '/gerenciarEquipePage': { type: 'basic_tip',          category: 'geral',        source: 'local_tip', priority: 'low' },
  '/historicoPage':       { type: 'day_progress',       category: 'geral',        source: 'local_tip', priority: 'low' },
  '/ajustesPage':         { type: 'basic_tip',          category: 'geral',        source: 'local_tip', priority: 'low' },
};
```

## Labels default por rota

Usado como fallback quando Gemini não enriquece a posição.

```js
const ROUTE_DEFAULT_LABELS = {
  '/areaCultivoPage':       { title: 'Área de Cultivo',       description: 'Gerencie as áreas de cultivo.',            actionLabel: 'Abrir Cultivo' },
  '/reservatoriosPage':     { title: 'Reservatórios',         description: 'Acompanhe o nível dos reservatórios.',     actionLabel: 'Ver Reservatórios' },
  '/cadernoCampoPage':      { title: 'Caderno de Campo',      description: 'Registre e acompanhe o caderno de campo.',  actionLabel: 'Abrir Caderno' },
  '/solucaoPage':           { title: 'Solução',               description: 'Consulte a solução aplicada ao cultivo.',   actionLabel: 'Ver Solução' },
  '/protocoloPage':         { title: 'Protocolo',             description: 'Cadastre e gerencie protocolos.',           actionLabel: 'Abrir Protocolos' },
  '/agendaPage':            { title: 'Agenda',                description: 'Consulte suas atividades e tarefas.',       actionLabel: 'Abrir Agenda' },
  '/relatoriosPage':        { title: 'Relatórios',            description: 'Veja relatórios e resumos operacionais.',   actionLabel: 'Ver Relatórios' },
  '/ajustesPage':           { title: 'Ajustes',               description: 'Configure preferências do sistema.',        actionLabel: 'Abrir Ajustes' },
  '/gerenciarEquipePage':   { title: 'Equipe',                description: 'Gerencie a alocação da equipe.',            actionLabel: 'Gerenciar Equipe' },
  '/historicoPage':         { title: 'Histórico',             description: 'Consulte o histórico de atividades.',       actionLabel: 'Ver Histórico' },
  '/lotePage':              { title: 'Lotes',                 description: 'Consulte os lotes em produção.',            actionLabel: 'Ver Lotes' },
};
```

## Novo prompt Gemini

O backend envia as rotas já definidas. Gemini só preenche `title`, `description`, `actionLabel`, `reason`.

```json
{
  "routeRanking": [
    {"route": "/cadernoCampoPage", "label": "Registrar Ajuste", "description": "Registre a execução do ajuste no caderno de campo"},
    {"route": "/solucaoPage", "label": "Ver Solução", "description": "Acesse a solução aplicada ao cultivo"},
    {"route": "/agendaPage", "label": "Agenda", "description": "Consulte a programação de atividades"}
  ],
  "schema": {
    "response": {
      "enrichedRoutes": [
        {"title": "string", "description": "string", "actionLabel": "string", "reason": "string | null"}
      ]
    }
  }
}
```

Resposta Gemini esperada:

```json
{
  "enrichedRoutes": [
    {"title": "Registre o ajuste no Caderno de Campo", "description": "As atividades foram verificadas. Registre a execução do ajuste.", "actionLabel": "Abrir Caderno", "reason": "Há um ajuste pendente."},
    {"title": "Revise a solução do cultivo", "description": "Confira a solução aplicada.", "actionLabel": "Ver Solução", "reason": "Há solução disponível."},
    {"title": "Verifique a Agenda", "description": "Consulte as atividades programadas.", "actionLabel": "Abrir Agenda", "reason": null}
  ]
}
```

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/instantDomainRules.js` | Adicionar `STEP_ROUTE_RANKING`; remover `STEP_SHORTCUTS`; `deriveInstantSignals` retorna `ranking` em vez de `shortcuts` |
| `src/instantRouteDistributor.js` | **NOVO** — `distributeFromRanking()`, `ROUTE_TO_INFO_META`, `ROUTE_DEFAULT_LABELS` |
| `src/instantInfoRecommendationBuilder.js` | Remover `ALTERNATIVE_CTA_BY_TARGET`, `buildDeduplicatedCtaRoute`, `deduplicateShortcutRoutes`; manter `INFO_TEMPLATES`, `buildInfoRecommendationFallback`, funções de validação |
| `src/instantPromptBuilder.js` | Enviar `routeRanking` em vez de schemas separados |
| `src/instantResponseNormalizer.js` | Normalizar `enrichedRoutes[]` do Gemini |
| `src/instantFallbackBuilder.js` | Usar `distributeFromRanking` em vez de `STEP_COPY` + `STEP_SHORTCUTS` |
| `src/instantResponseValidator.js` | `finalizeValidInstantResponse` usa `distributeFromRanking`, remove dedup |
| `src/enhancedInstantMode.js` | Fluxo passa ranking para prompt → normalizador → distribuidor |

## Critérios de aceitação

- AC-001: Dado step `record_caderno_adjustment`, `nextStepPrediction.targetRoute` = `/cadernoCampoPage`, `infoRecommendation.ctaRoute` = `/solucaoPage`, shortcuts = [`/agendaPage`, `/relatoriosPage`, `/protocoloPage`, `/historicoPage`]
- AC-002: Dado Gemini sem enriquecimento, fallback usa `ROUTE_DEFAULT_LABELS`
- AC-003: Nenhuma rota se repete entre as 3 superfícies em nenhum step
- AC-004: `ROUTE_TO_INFO_META` cobre todas as rotas presentes em `STEP_ROUTE_RANKING`
- AC-005: `ROUTE_DEFAULT_LABELS` cobre todas as rotas em `STEP_ROUTE_RANKING`
- AC-006: `distributeFromRanking` respeita `clientCapabilities.maxShortcuts`
- AC-007: `deriveInstantSignals` não retorna mais `shortcuts` (retorna `ranking`)
- AC-008: Testes unitários existentes continuam passando
- AC-009: `INFO_BY_RULE` é removido e substituído por `ROUTE_TO_INFO_META`

## Risco e mitigação

| Risco | Mitigação |
|---|---|
| Gemini enriquece com PII | Validação pós-Gemini existente já rejeita texto com PII |
| Ranking não atende cenário imprevisto | Ranking é estático e ajustável por step; adicionar novo step requer atualizar o mapa |
| Quebra de contrato com frontend | Shape dos campos `nextStepPrediction`, `infoRecommendation`, `shortcuts` permanece idêntico |
