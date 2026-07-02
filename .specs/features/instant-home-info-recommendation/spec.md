# Spec — Recomendação contextual de Info da Home no modo INSTANT

## Contexto

O projeto Node.js/Firebase Functions `getAdaptiveInterface` já possui um modo `INSTANT` aprimorado que usa contexto operacional sanitizado, regras determinísticas e Gemini para retornar recomendações adaptativas ao app `osi-solucoes`. A Home do app passará a ter uma seção de Info contextual, renderizada localmente pelo frontend/ISIS, mas orientada pela API por meio de um novo campo `infoRecommendation`.

A feature existe para permitir que o `INSTANT` recomende qual card de Info deve aparecer na Home sem expor PII ao Gemini e sem acoplar a Cloud Function aos detalhes visuais ou textuais do app Flutter. A API deve escolher `type` e `category`; o frontend deve resolver detalhes locais/ISIS a partir desses valores e da rota CTA allowlisted.

## Goals

- Adicionar `infoRecommendation` às respostas finais do modo `INSTANT`.
- Manter compatibilidade com campos legados já retornados pelo `INSTANT` (`dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority`, `reason`, `reasonDetails`, `rulesApplied`, `fallback`).
- Usar abordagem híbrida/resiliente: Gemini pode retornar `infoRecommendation`, mas normalização/validação devem aplicar fallback determinístico baseado em `deriveInstantSignals` quando o campo vier ausente ou inválido.
- Garantir que `infoRecommendation` seja obrigatório nas respostas finais de `INSTANT`, inclusive fallback.
- Garantir que o payload enviado ao Gemini seja normalizado para flags, contagens, enums, categorias e rotas allowlisted.
- Impedir envio ao Gemini de nomes de usuários/lotes, descrições de anotações, textos livres ou dados identificáveis.
- Adicionar suporte a `supportedInfoTypes` em `clientCapabilities`, quando enviado pelo cliente.
- Adicionar suporte de métricas para `info_card_shown` e `info_card_clicked`.
- Preservar foco da implementação em `INSTANT` e métricas, evitando lógica nova em `index.js` salvo necessidade mínima.

## Non-goals

- Não implementar UI Flutter, renderização da seção de Info ou integração ISIS no frontend.
- Não retornar nomes de lotes, nomes de usuários, descrições livres de anotações ou textos identificáveis em `infoRecommendation`.
- Não fazer a Cloud Function consultar ISIS diretamente.
- Não remover ou renomear campos legados da resposta.
- Não criar novo modo adaptativo além dos modos existentes.
- Não expandir comportamento `STATIC` além de permitir, futuramente e de forma opcional, `basic_tip`; esta feature deve focar `INSTANT`.
- Não criar nova infraestrutura de testes além dos unitários esperados.

## Requisitos rastreáveis

| ID | Requisito |
| --- | --- |
| IHIR-REQ-001 | A resposta final do modo `INSTANT` deve conter `infoRecommendation`. |
| IHIR-REQ-002 | `infoRecommendation` deve seguir o shape `{ type, source, priority, title, reason, ctaRoute, category }`. |
| IHIR-REQ-003 | `type` deve ser um de `today_cultivation`, `reservoir_report`, `day_progress`, `field_notes_summary`, `basic_tip`. |
| IHIR-REQ-004 | `source` deve ser um de `isis`, `local_tip`, `fallback`. |
| IHIR-REQ-005 | `priority` deve ser um de `low`, `medium`, `high`. |
| IHIR-REQ-006 | `category` deve ser uma de `geral`, `agenda`, `lote`, `protocolo`, `solucao`, `reservatorio`, `caderno_campo`, `cultivo`. |
| IHIR-REQ-007 | `ctaRoute` deve estar na allowlist específica da Info Home. |
| IHIR-REQ-008 | O prompt Gemini deve conter o schema de `infoRecommendation`. |
| IHIR-REQ-009 | O prompt Gemini não deve conter nomes de usuários/lotes, descrições de anotações, textos livres ou dados identificáveis. |
| IHIR-REQ-010 | Gemini pode retornar `infoRecommendation` quando cumprir o schema. |
| IHIR-REQ-011 | Resposta Gemini ausente ou inválida para Info deve receber fallback determinístico sem depender do Gemini. |
| IHIR-REQ-012 | O fallback determinístico deve usar sinais derivados de `deriveInstantSignals`. |
| IHIR-REQ-013 | `normalizeInstantResponse` deve aceitar `infoRecommendation` válido. |
| IHIR-REQ-014 | `validateInstantResponse` deve rejeitar `type` inválido. |
| IHIR-REQ-015 | `validateInstantResponse` deve rejeitar `ctaRoute` fora da allowlist da Info Home. |
| IHIR-REQ-016 | `buildEnhancedInstantFallback` deve sempre retornar `infoRecommendation`. |
| IHIR-REQ-017 | Campos legados devem ser preservados. |
| IHIR-REQ-018 | `supportedInfoTypes` deve limitar os tipos aceitos quando enviado pelo cliente. |
| IHIR-REQ-019 | Métricas suportadas devem incluir `info_card_shown` e `info_card_clicked`. |
| IHIR-REQ-020 | Aliases legados de `testSequenceSignals` devem ser normalizados se forem aceitos. |
| IHIR-REQ-021 | A API escolhe `type` e `category`; o frontend renderiza detalhes locais/ISIS. |
| IHIR-REQ-022 | A implementação deve isolar copy/templates e fallback/normalização de Info preferencialmente em `src/instantInfoRecommendationBuilder.js`. |

## Contrato de request

### Campos existentes preservados

O contrato atual de `INSTANT` continua aceitando `operationalContext`, `clientCapabilities`, contexto de navegação e sessão conforme a spec existente de `instant-enhanced-mode`.

### Extensão de `clientCapabilities`

```json
{
  "clientCapabilities": {
    "supportedComponents": ["NextStepCard", "AdaptiveFocusBanner"],
    "supportsInfoIconExplanation": true,
    "supportsHighlightFrame": true,
    "maxShortcuts": 4,
    "maxSectionAdaptations": 4,
    "supportedInfoTypes": [
      "today_cultivation",
      "reservoir_report",
      "day_progress",
      "field_notes_summary",
      "basic_tip"
    ]
  }
}
```

Regras:

- `supportedInfoTypes` é opcional.
- Quando ausente ou vazio, a API deve assumir todos os tipos permitidos.
- Quando presente, deve ser normalizado para valores válidos e únicos.
- Tipos inválidos devem ser descartados na boundary de `clientCapabilities`.

### `operationalContext` sanitizado

O `operationalContext` deve continuar restrito a flags, contagens, enums e timestamps normalizados. Se aliases legados de `testSequenceSignals` forem aceitos, eles devem ser convertidos para os nomes canônicos antes de `deriveInstantSignals` e antes do prompt.

## Contrato de response

### Response INSTANT final

```json
{
  "responseVersion": "1.0",
  "mode": "INSTANT",
  "source": "adaptive",
  "dashboard": "Tarefas Pendentes",
  "dashboardId": "TAREFAS_PENDENTES",
  "cardType": "tarefas",
  "confidence": 0.72,
  "visualPriority": "moderate",
  "nextStepPrediction": {
    "stepId": "check_generated_agenda_activities",
    "confidence": 0.72,
    "title": "Verifique as atividades geradas na Agenda",
    "description": "Texto curto não identificável",
    "targetRoute": "/agendaPage",
    "actionLabel": "Abrir Agenda"
  },
  "sectionAdaptations": [],
  "shortcuts": [],
  "focus": {},
  "uiTreatment": {
    "density": "comfortable",
    "emphasis": "moderate",
    "animation": "subtle",
    "explanationVisibility": "low",
    "showProgressBar": false
  },
  "reason": "Texto curto não identificável",
  "reasonDetails": {
    "summary": "Texto curto não identificável",
    "details": ["RULE-002", "RULE-010"],
    "display": "info_icon"
  },
  "rulesApplied": ["RULE-002", "RULE-010"],
  "fallback": {
    "used": false,
    "reason": null
  },
  "infoRecommendation": {
    "type": "day_progress",
    "source": "isis",
    "priority": "medium",
    "title": "Resumo do dia",
    "reason": "Há atividades do dia para acompanhar.",
    "ctaRoute": "/agendaPage",
    "category": "agenda"
  }
}
```

### Campos de `infoRecommendation`

| Campo | Tipo | Obrigatório | Regra |
| --- | --- | --- | --- |
| `type` | enum | Sim | Deve estar em `INFO_RECOMMENDATION_TYPES` e em `supportedInfoTypes` quando informado. |
| `source` | enum | Sim | `isis`, `local_tip` ou `fallback`. |
| `priority` | enum | Sim | `low`, `medium` ou `high`. |
| `title` | string | Sim | Copy curta, genérica e não identificável. |
| `reason` | string | Sim | Justificativa curta baseada em sinais técnicos, sem PII. |
| `ctaRoute` | enum route | Sim | Deve estar na allowlist da Info Home. |
| `category` | enum | Sim | Categoria funcional usada pelo frontend para renderização local/ISIS. |

### Allowlist de CTA da Info Home

- `/agendaPage`
- `/lotePage`
- `/protocoloPage`
- `/solucaoPage`
- `/reservatoriosPage`
- `/cadernoCampoPage`
- `/relatoriosPage`
- `/areaCultivoPage`

## Segurança e PII

- O Gemini não pode receber nomes de usuários, nomes de lotes, descrições de anotações, textos livres ou dados identificáveis.
- O prompt deve conter apenas contexto sanitizado: flags, contagens, enums, categorias, regras, `deterministicSignals`, tipos permitidos e rotas allowlisted.
- O Gemini não deve decidir detalhes finais renderizados da Home. Ele pode sugerir `type/category/priority/ctaRoute/title/reason` dentro do schema, mas a validação e o fallback determinístico são autoritativos.
- Textos retornados pela API (`title`, `reason`) devem ser templates genéricos e sem interpolação de dados identificáveis.

## Acceptance criteria

- AC-001: Dado modo `INSTANT`, toda resposta final válida contém `infoRecommendation` com todos os campos obrigatórios.
- AC-002: Dado Gemini retornando `infoRecommendation` válido, o normalizer preserva o campo normalizado.
- AC-003: Dado Gemini sem `infoRecommendation`, a resposta final recebe fallback determinístico para Info.
- AC-004: Dado Gemini com `type` inválido, a validação rejeita ou a normalização substitui por fallback determinístico antes da resposta final.
- AC-005: Dado Gemini com `ctaRoute` fora da allowlist da Info Home, a validação rejeita ou a normalização substitui por fallback determinístico antes da resposta final.
- AC-006: Dado fallback geral de `INSTANT`, `infoRecommendation` é sempre retornado.
- AC-007: Dado `supportedInfoTypes` sem determinado tipo, a resposta final não usa esse tipo.
- AC-008: Dado o prompt do `INSTANT`, ele contém o schema de `infoRecommendation` e não contém PII enviada em campos brutos.
- AC-009: Campos legados continuam presentes e com shape compatível.
- AC-010: `SUPPORTED_METRIC_EVENTS` inclui `info_card_shown` e `info_card_clicked`.
- AC-011: Testes unitários cobrem prompt, normalizer, validator, fallback, compatibilidade legada, `supportedInfoTypes`, métricas e aliases legados aceitos.

## Open questions

- O frontend espera copies exatas para `title`/`reason` ou apenas chaves semânticas por `type/category`?
- `source: "isis"` deve indicar origem de dados disponível no app mesmo quando a API não consultou ISIS, ou deve ser usado apenas quando o frontend confirmou capacidade ISIS?
- Quais aliases legados de `testSequenceSignals` já existem no Flutter e devem ser aceitos formalmente?
