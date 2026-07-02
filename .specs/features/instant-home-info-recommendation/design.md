# Design — Recomendação contextual de Info da Home no INSTANT

## Contexto

O `INSTANT` atual monta um prompt sanitizado, chama Gemini, valida a resposta, normaliza campos adaptativos e cai para fallback determinístico quando necessário. A nova seção de Info da Home precisa de uma recomendação adicional, mas não deve depender do Gemini para disponibilidade final nem deve expor PII.

## Goals e non-goals

### Goals

- Introduzir contrato explícito de `infoRecommendation`.
- Centralizar enums, allowlists e validação em boundaries existentes.
- Isolar copy/templates e decisão determinística de Info em `src/instantInfoRecommendationBuilder.js`.
- Fazer `enhancedInstantMode` continuar orquestrando o fluxo sem crescer em responsabilidade.
- Validar Gemini antes e depois da normalização.

### Non-goals

- Não alterar renderização Flutter.
- Não consultar ISIS na Cloud Function.
- Não mover lógica de negócio para `index.js`.
- Não substituir as regras de `deriveInstantSignals`; a Info deve reutilizar esses sinais.

## Technical approach and design decisions

### Decisão principal: abordagem híbrida/resiliente

Gemini pode retornar `infoRecommendation` conforme o schema, mas a API não deve depender disso. A normalização/validação deve produzir resposta final com `infoRecommendation` obrigatório para `INSTANT` usando fallback determinístico quando o campo vier ausente, incompleto, não suportado pelo cliente ou inválido.

Razões:

- aumenta resiliência contra saída inconsistente do modelo;
- preserva previsibilidade do contrato com o frontend;
- evita dependência do Gemini para uma seção crítica da Home;
- mantém PII fora do prompt, pois o fallback usa apenas `deriveInstantSignals` e contexto normalizado.

Alternativas descartadas:

- Tornar `infoRecommendation` opcional: descartado porque obrigaria o frontend a lidar com ausência em `INSTANT` e enfraqueceria o experimento.
- Deixar Gemini autoritativo: descartado por risco de schema inválido, rotas fora da allowlist e vazamento indireto de texto livre.
- Implementar lógica no `index.js`: descartado para manter `index.js` como boundary/orquestração mínima.

### Fluxo proposto

1. `operationalContextValidator` normaliza contexto e aliases aceitos de `testSequenceSignals`.
2. `clientCapabilitiesValidator` normaliza `supportedInfoTypes`.
3. `instantDomainRules.deriveInstantSignals` deriva `stepId`, `targetRoute`, `dashboardId` e regras aplicadas.
4. `instantPromptBuilder` inclui schema de `infoRecommendation`, enums permitidos, tipos suportados e allowlist de CTA da Info Home.
5. Gemini retorna resposta adaptativa legada + opcionalmente `infoRecommendation`.
6. `instantResponseNormalizer` normaliza campos legados e tenta normalizar `infoRecommendation`.
7. `instantResponseValidator` rejeita rota CTA fora da allowlist, tipo inválido, source/priority/category inválidos e tipo não suportado por `supportedInfoTypes`.
8. Se resposta Gemini for inválida no todo, `instantFallbackBuilder` retorna fallback completo com `infoRecommendation` determinístico.
9. Se apenas `infoRecommendation` estiver ausente/inválido em resposta adaptativa válida, a camada de normalização/finalização deve anexar fallback determinístico de Info antes da resposta final.
10. `adaptiveMetrics` passa a aceitar eventos `info_card_shown` e `info_card_clicked`.

## Data structures and interfaces involved

### Constantes novas ou expandidas em `adaptiveContract.js`

```js
INFO_RECOMMENDATION_TYPES = [
  'today_cultivation',
  'reservoir_report',
  'day_progress',
  'field_notes_summary',
  'basic_tip',
]

INFO_RECOMMENDATION_SOURCES = ['isis', 'local_tip', 'fallback']
INFO_RECOMMENDATION_PRIORITIES = ['low', 'medium', 'high']
INFO_RECOMMENDATION_CATEGORIES = [
  'geral',
  'agenda',
  'lote',
  'protocolo',
  'solucao',
  'reservatorio',
  'caderno_campo',
  'cultivo',
]

ALLOWED_INFO_CTA_ROUTES = [
  '/agendaPage',
  '/lotePage',
  '/protocoloPage',
  '/solucaoPage',
  '/reservatoriosPage',
  '/cadernoCampoPage',
  '/relatoriosPage',
  '/areaCultivoPage',
]
```

### `InfoRecommendation`

```ts
type InfoRecommendation = {
  type: 'today_cultivation' | 'reservoir_report' | 'day_progress' | 'field_notes_summary' | 'basic_tip';
  source: 'isis' | 'local_tip' | 'fallback';
  priority: 'low' | 'medium' | 'high';
  title: string;
  reason: string;
  ctaRoute: '/agendaPage' | '/lotePage' | '/protocoloPage' | '/solucaoPage' | '/reservatoriosPage' | '/cadernoCampoPage' | '/relatoriosPage' | '/areaCultivoPage';
  category: 'geral' | 'agenda' | 'lote' | 'protocolo' | 'solucao' | 'reservatorio' | 'caderno_campo' | 'cultivo';
}
```

> Nota: o projeto está em JavaScript; o tipo acima é documentação de contrato, não implementação TypeScript.

### `clientCapabilities.supportedInfoTypes`

Normalizado como array único com apenas valores de `INFO_RECOMMENDATION_TYPES`. Se a entrada não trouxer tipos válidos, usar todos os tipos permitidos para preservar compatibilidade.

## Matriz de regras RULE-001..008

As regras abaixo mapeiam os sinais determinísticos atuais para recomendação de Info. `RULE-010` continua aplicada para proibição de progress bar, mas não define Info.

| Regra | Condição derivada | type | category | source | priority | ctaRoute |
| --- | --- | --- | --- | --- | --- | --- |
| RULE-001 | Sem lote com protocolo | `basic_tip` | `protocolo` | `local_tip` | `high` | `/protocoloPage` |
| RULE-002 | Lote com protocolo e atividades geradas ainda não conferidas | `day_progress` | `agenda` | `isis` | `high` | `/agendaPage` |
| RULE-003 | Ajuste nutricional pendente | `today_cultivation` | `solucao` | `isis` | `high` | `/solucaoPage` |
| RULE-004 | Ajuste executado e caderno ainda não conferido | `field_notes_summary` | `caderno_campo` | `isis` | `medium` | `/cadernoCampoPage` |
| RULE-005 | Caderno conferido com pendências na agenda | `day_progress` | `agenda` | `isis` | `medium` | `/agendaPage` |
| RULE-006 | Atividades concluídas/final Home | `day_progress` | `geral` | `local_tip` | `low` | `/relatoriosPage` |
| RULE-007 | Tarefas atrasadas | `day_progress` | `agenda` | `isis` | `high` | `/agendaPage` |
| RULE-008 | Alertas críticos | `basic_tip` | `agenda` | `fallback` | `high` | `/agendaPage` |

Regras complementares:

- Se o tipo escolhido não estiver em `supportedInfoTypes`, escolher o primeiro fallback suportado na ordem: `basic_tip`, `day_progress`, `today_cultivation`, `field_notes_summary`, `reservoir_report`.
- Se nenhuma regra específica for aplicada além de `RULE-010`, usar `basic_tip`, `geral`, `local_tip`, `low`, `/areaCultivoPage`.
- `reservoir_report` pode ser escolhido por Gemini quando válido e suportado, mas o fallback determinístico só deve usá-lo se houver sinal normalizado futuro de reservatório; sem sinal atual, preferir `basic_tip` ou tipo suportado alternativo.

## File plan and responsibilities

| Arquivo | Responsabilidade |
| --- | --- |
| `src/adaptiveContract.js` | Declarar enums/allowlists de Info e exportar constantes reutilizáveis. |
| `src/clientCapabilitiesValidator.js` | Normalizar `supportedInfoTypes` sem quebrar capabilities existentes. |
| `src/operationalContextValidator.js` | Normalizar aliases aceitos de `testSequenceSignals` para nomes canônicos e manter PII fora do contexto. |
| `src/instantDomainRules.js` | Continuar derivando sinais determinísticos; não adicionar copy de Info aqui. |
| `src/instantInfoRecommendationBuilder.js` | Novo módulo recomendado para templates, matriz RULE-001..008, fallback determinístico, normalização localizada de Info e seleção respeitando `supportedInfoTypes`. |
| `src/instantPromptBuilder.js` | Incluir schema `infoRecommendation`, enums permitidos, `supportedInfoTypes` e allowlist de CTA no prompt. |
| `src/instantResponseNormalizer.js` | Normalizar `infoRecommendation` válido e preparar fallback de Info quando necessário. |
| `src/instantResponseValidator.js` | Validar shape, enums, CTA allowlisted e `supportedInfoTypes`. |
| `src/instantFallbackBuilder.js` | Anexar `infoRecommendation` em todo fallback INSTANT. |
| `src/enhancedInstantMode.js` | Orquestrar fallback de Info usando sinais já derivados, sem incorporar matriz/copy local. |
| `src/adaptiveMetrics.js` | Adicionar eventos `info_card_shown` e `info_card_clicked`. |
| `tests/unit/instant-enhanced-mode.test.js` ou novo arquivo unitário | Cobrir prompt, normalizer, validator, fallback, capabilities, métricas e aliases. |

## Boundaries and large files

- `index.js` não deve receber regra de negócio de Info; qualquer alteração deve ser mínima e apenas para wiring já existente, se inevitável.
- `instantPromptBuilder.js` deve continuar apenas montando prompt; templates de fallback pertencem ao novo builder.
- `instantDomainRules.js` deve continuar retornando sinais e regras aplicadas, sem copy de UI.
- `instantFallbackBuilder.js` já possui copy de next step; evitar inflá-lo com matriz de Info além de chamada ao builder.
- Se um arquivo se aproximar de 300 linhas durante implementação, preferir extração coesa para o novo builder.

## Segurança/PII

- Não serializar request bruta no prompt.
- Não aceitar `title`/`reason` do cliente.
- Não interpolar nomes, IDs humanos, descrições de notas ou textos livres em templates.
- Validar qualquer campo vindo do Gemini antes de responder.
- Tratar payload externo como hostil: rotas e enums devem ser allowlisted.

## Acceptance criteria

- O prompt contém o schema completo de `infoRecommendation`.
- O prompt não contém campos brutos identificáveis quando a request contiver PII em locais não suportados.
- `normalizeInstantResponse` preserva `infoRecommendation` válido.
- `validateInstantResponse` rejeita `type` inválido e CTA fora da allowlist.
- `buildEnhancedInstantFallback` sempre retorna `infoRecommendation`.
- `finalizeValidInstantResponse` ou etapa equivalente garante `infoRecommendation` em respostas finais `INSTANT`.
- `supportedInfoTypes` é respeitado em Gemini normalizado e fallback.
- Métricas incluem `info_card_shown` e `info_card_clicked`.
- Campos legados permanecem no contrato final.

## Open questions

- Deve existir capability explícita `supportsInfoRecommendation` ou `supportedInfoTypes` vazio já significa suporte completo?
- `reservoir_report` precisa de novos sinais em `operationalContext` para fallback determinístico em uma próxima feature?
- O evento `info_card_clicked` deve validar `ctaRoute` no backend de métricas ou apenas registrar evento allowlisted no BigQuery atual?
