Agent: architect
Rules: AGENTS.md

# Tasks — Recomendação contextual de Info da Home no INSTANT

## Contexto

Esta task list transforma a spec/design da feature `instant-home-info-recommendation` em passos atômicos verificáveis. A implementação deve focar `INSTANT`, métricas e testes unitários, sem implementar código Flutter e sem mover lógica para `index.js` salvo wiring mínimo inevitável.

## Goals e non-goals

### Goals

- Entregar `infoRecommendation` obrigatório em respostas finais `INSTANT`.
- Preservar contrato legado.
- Proteger prompt e validação contra PII e valores fora de allowlist.
- Cobrir comportamento com testes unitários.

### Non-goals

- Não implementar UI do app `osi-solucoes`.
- Não consultar ISIS na Cloud Function.
- Não alterar modos fora de `INSTANT`, exceto métricas compartilhadas e compatibilidade de contrato.

## Tasks atômicas

### T1 — Mapear contexto existente antes de alterar

- Dependências: nenhuma.
- Pode rodar em paralelo: não, bloqueia implementação.
- Arquivos para leitura: `src/adaptiveContract.js`, `src/clientCapabilitiesValidator.js`, `src/operationalContextValidator.js`, `src/instantDomainRules.js`, `src/instantPromptBuilder.js`, `src/instantResponseNormalizer.js`, `src/instantResponseValidator.js`, `src/instantFallbackBuilder.js`, `src/enhancedInstantMode.js`, `src/adaptiveMetrics.js`, testes unitários existentes.
- Critérios de verificação:
  - Responsabilidades atuais entendidas antes de editar.
  - Nenhuma alteração feita em `src` antes de confirmar pontos de integração.

### T2 — Expandir contrato central de Info

- Dependências: T1.
- Pode rodar em paralelo: não.
- Arquivo: `src/adaptiveContract.js`.
- Ações:
  - Adicionar enums/allowlists de `type`, `source`, `priority`, `category` e CTA da Info Home.
  - Exportar constantes sem remover exports existentes.
- Critérios de verificação:
  - Constantes cobrem exatamente os valores da spec.
  - Rotas CTA da Info não incluem rotas fora da allowlist exigida.
  - Campos legados e `ALLOWED_INSTANT_ROUTES` permanecem compatíveis.

### T3 — Normalizar `supportedInfoTypes`

- Dependências: T2.
- Pode rodar em paralelo: não.
- Arquivo: `src/clientCapabilitiesValidator.js`.
- Ações:
  - Aceitar `clientCapabilities.supportedInfoTypes` opcional.
  - Remover inválidos, duplicados e strings vazias.
  - Usar todos os tipos permitidos quando ausente ou sem valores válidos.
- Critérios de verificação:
  - Capabilities antigas continuam funcionando.
  - Tipos inválidos não chegam ao prompt nem à seleção final.

### T4 — Normalizar aliases legados aceitos de `testSequenceSignals`

- Dependências: T1.
- Pode rodar em paralelo: sim, após T1, se a lista de aliases estiver definida.
- Arquivo: `src/operationalContextValidator.js`.
- Ações:
  - Mapear aliases legados conhecidos para os nomes canônicos atuais, se existirem no payload do Flutter.
  - Manter retorno final apenas com nomes canônicos.
- Critérios de verificação:
  - Aliases aceitos produzem os mesmos sinais que campos canônicos.
  - Nenhum texto livre ou identificador é preservado.

### T5 — Criar builder isolado de Info

- Dependências: T2, T3.
- Pode rodar em paralelo: não.
- Arquivo: `src/instantInfoRecommendationBuilder.js`.
- Ações:
  - Implementar matriz RULE-001..008 da spec.
  - Centralizar templates genéricos de `title` e `reason`.
  - Criar seleção que respeite `supportedInfoTypes`.
  - Criar normalização/fallback determinístico de `infoRecommendation` com base em `deriveInstantSignals`/`rulesApplied`.
- Critérios de verificação:
  - Fallback não chama Gemini.
  - Todos os retornos têm shape completo.
  - Nenhum template interpola dados identificáveis.

### T6 — Atualizar prompt do INSTANT

- Dependências: T2, T3, T5.
- Pode rodar em paralelo: não.
- Arquivo: `src/instantPromptBuilder.js`.
- Ações:
  - Incluir schema obrigatório de `infoRecommendation` no prompt.
  - Incluir enums permitidos, `supportedInfoTypes` e allowlist CTA da Info.
  - Reforçar instrução para não usar PII nem textos livres.
- Critérios de verificação:
  - Teste confirma presença do schema no prompt.
  - Teste com PII em campos brutos não suportados confirma ausência no prompt.

### T7 — Normalizar resposta Gemini com Info

- Dependências: T5, T6.
- Pode rodar em paralelo: não.
- Arquivo: `src/instantResponseNormalizer.js`.
- Ações:
  - Normalizar `infoRecommendation` quando válido em estrutura básica.
  - Preparar fallback de Info quando ausente/incompleto, conforme design.
  - Preservar normalização de campos legados.
- Critérios de verificação:
  - Normalizer aceita `infoRecommendation` válido.
  - Normalizer não quebra `reasonDetails` legado.

### T8 — Validar `infoRecommendation`

- Dependências: T2, T3, T7.
- Pode rodar em paralelo: não.
- Arquivo: `src/instantResponseValidator.js`.
- Ações:
  - Rejeitar `type`, `source`, `priority`, `category` inválidos.
  - Rejeitar `ctaRoute` fora da allowlist da Info.
  - Rejeitar `type` fora de `supportedInfoTypes`.
  - Garantir obrigatoriedade de `infoRecommendation` em response final `INSTANT`.
- Critérios de verificação:
  - Teste rejeita tipo inválido.
  - Teste rejeita CTA fora da allowlist.
  - Teste respeita `supportedInfoTypes`.

### T9 — Anexar Info no fallback e na finalização INSTANT

- Dependências: T5, T8.
- Pode rodar em paralelo: não.
- Arquivos: `src/instantFallbackBuilder.js`, `src/enhancedInstantMode.js`, possivelmente `src/instantResponseValidator.js` se `finalizeValidInstantResponse` receber o fallback de Info.
- Ações:
  - Fazer `buildEnhancedInstantFallback` sempre retornar `infoRecommendation`.
  - Garantir que resposta Gemini adaptativa válida, mas sem Info válida, receba fallback determinístico de Info antes do retorno final.
  - Manter `source` legado da resposta geral sem confundir com `infoRecommendation.source`.
- Critérios de verificação:
  - Fallback sempre contém `infoRecommendation`.
  - Campos legados continuam presentes.
  - `fallback.used` geral mantém semântica existente.

### T10 — Adicionar métricas de Info

- Dependências: T1.
- Pode rodar em paralelo: sim, após T1.
- Arquivo: `src/adaptiveMetrics.js`.
- Ações:
  - Adicionar `info_card_shown` e `info_card_clicked` aos eventos suportados.
  - Preservar eventos legados e do enhanced INSTANT.
- Critérios de verificação:
  - `SUPPORTED_METRIC_EVENTS` contém os novos eventos.
  - `getSupportedMetricEventsSqlList()` inclui ambos.

### T11 — Cobrir com testes unitários

- Dependências: T2 a T10.
- Pode rodar em paralelo: não.
- Arquivos: `tests/unit/instant-enhanced-mode.test.js` ou novo `tests/unit/instant-info-recommendation.test.js`.
- Casos obrigatórios:
  - Prompt contém schema `infoRecommendation`.
  - Prompt não contém PII.
  - Normalizer aceita `infoRecommendation` válido.
  - Validator rejeita tipo inválido.
  - Validator rejeita CTA fora da allowlist.
  - Fallback sempre retorna `infoRecommendation`.
  - Campos legados preservados.
  - `supportedInfoTypes` é respeitado.
  - Métricas incluem `info_card_shown` e `info_card_clicked`.
  - Aliases legados de `testSequenceSignals` são normalizados se aceitos.
- Critérios de verificação:
  - Testes falham antes da implementação correspondente e passam após implementação.
  - Nenhum teste depende de chamada real ao Gemini.

### T12 — Validação final

- Dependências: T11.
- Pode rodar em paralelo: não.
- Comandos:
  - `npm test`
  - `npx jest tests/unit/instant-enhanced-mode.test.js`
  - Se for criado novo arquivo: `npx jest tests/unit/instant-info-recommendation.test.js`
- Critérios de verificação:
  - Comandos executados e resultado registrado.
  - Se algum comando não puder rodar, registrar motivo e evidência.

## Technical approach and design decisions

- Implementar por extensão dos módulos existentes e novo builder coeso, não por lógica inline em orquestrador.
- Usar fallback determinístico como garantia contratual para `infoRecommendation` final.
- Tratar saída Gemini como não confiável até passar por normalização e validação.
- Preservar compatibilidade por adição de campo novo, nunca por remoção ou renome.

## Data structures or interfaces involved

- `clientCapabilities.supportedInfoTypes?: string[]`.
- `response.infoRecommendation` com shape `{ type, source, priority, title, reason, ctaRoute, category }`.
- Enums e allowlists em `adaptiveContract.js`.
- Eventos de métrica `info_card_shown` e `info_card_clicked`.

## Acceptance criteria

- Todas as tasks T1..T12 concluídas.
- Todos os requisitos `IHIR-REQ-001` a `IHIR-REQ-022` têm cobertura por código ou teste.
- `npm test` passa ou impedimento é documentado.
- Teste unitário específico do INSTANT passa.

## Open questions

- Confirmar aliases legados exatos de `testSequenceSignals` antes da T4 se não estiverem claros no código Flutter.
- Confirmar se `source: "isis"` é semântico para renderização frontend ou deve exigir capability futura.
