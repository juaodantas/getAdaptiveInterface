Agent: architect
Rules: AGENTS.md

# Tasks — Cache compartilhado de recomendações INSTANT

## Contexto

Esta task list transforma a spec `instant-shared-recommendation-cache` em passos atômicos verificáveis. A feature introduz cache compartilhado para recomendações `INSTANT` geradas pelo Gemini, sem remover Gemini do fluxo e sem alterar `STATIC`, `GRADUAL` ou o cache `adaptiveInterfaceCache` existente.

O ponto de orquestração continua sendo `buildEnhancedInstantRecommendation` em `src/enhancedInstantMode.js`. A política principal de cache deve ficar em módulo dedicado, com adapter Firestore injetado. `index.js` é grande e deve receber apenas wiring mínimo de composição.

## Goals e non-goals

### Goals

- Consultar cache antes de chamar Gemini em chamadas `INSTANT` cacheáveis.
- Cachear por `promptVersion`, `mode`, `stepId`, `contextProfile` e, apenas quando necessário, `capabilityProfile`.
- Evitar `userId`, `sessionId`, device id, IP, timestamps exatos, rotas recentes detalhadas e texto livre identificável em chave ou documento.
- Persistir entradas na collection Firestore `instantRecommendationCache`.
- Gravar somente resposta final normalizada e validada do `INSTANT`.
- Manter cache best-effort: falhas de leitura/escrita não bloqueiam resposta.
- Preservar o contrato público final do `INSTANT`.

### Non-goals

- Não substituir Gemini.
- Não remover fallback determinístico do `INSTANT`.
- Não alterar `STATIC`, `GRADUAL` ou o cache `adaptiveInterfaceCache`.
- Não criar cache por usuário, sessão ou dispositivo.
- Não armazenar request bruto, prompt bruto, resposta Gemini bruta ou payload com PII.
- Não implementar UI Flutter.
- Não implementar limpeza física de documentos expirados nesta entrega.
- Não adicionar política de cache, chave, TTL ou profile em `index.js`.

## Decisões iniciais para implementação

- `promptVersion`: deve ser uma constante explícita da integração INSTANT/cache; o nome final deve seguir o padrão encontrado no código durante a implementação.
- TTL padrão: 24 horas.
- TTL para contexto volátil: 6 horas quando houver alerta crítico, atraso ou contexto operacional mais instável representado no `contextProfile`.
- Limiar mínimo de cacheabilidade por confiança: `confidence >= 0.7`.
- Cache hit não deve adicionar metadado público novo à response; usar métricas/observabilidade internas.
- Firestore TTL nativo ou job de limpeza física fica fora do escopo; esta feature só grava e respeita `expiresAt`.

## Tasks atômicas

### T1 — Mapear pontos de integração antes de alterar código

- Dependências: nenhuma.
- Pode rodar em paralelo: não, bloqueia implementação.
- Arquivos para leitura: `src/enhancedInstantMode.js`, `src/instantDomainRules.js`, `src/geminiClient.js`, `src/instantResponseNormalizer.js`, `src/instantResponseValidator.js`, `src/instantFallbackBuilder.js`, `src/clientCapabilitiesValidator.js`, `index.js`, testes unitários existentes de INSTANT.
- Ações:
  - Confirmar o shape final retornado por `buildEnhancedInstantRecommendation`.
  - Confirmar onde `deriveInstantSignals` já é chamado e como `stepId` é derivado.
  - Confirmar como Gemini é injetado/mockado nos testes existentes.
  - Confirmar mecanismo existente de logs/métricas reutilizável sem criar infraestrutura nova.
- Critérios de verificação:
  - Responsabilidades atuais entendidas antes de editar `src`.
  - Pontos de injeção do cache documentados no plano de implementação.
  - Nenhuma regra de cache planejada para `index.js`, `instantDomainRules.js` ou `operationalContextValidator.js`.

### T2 — Criar módulo puro de política de cache INSTANT

- Dependências: T1.
- Pode rodar em paralelo: sim, com T3 após contrato mínimo do adapter estar definido.
- Arquivo: `src/instantRecommendationCache.js`.
- Ações:
  - Implementar constantes de política: `mode`, `promptVersion`, `responseVersion`, TTL padrão, TTL volátil e confiança mínima.
  - Derivar `contextProfile` amplo, sanitizado e discretizado a partir dos sinais já derivados para o INSTANT.
  - Derivar `capabilityProfile` somente quando `clientCapabilities` alterar shape, limites ou tipos da resposta cacheada.
  - Gerar `cacheKeyCanonical` determinístico com `promptVersion`, `mode`, `stepId`, `contextProfile` e `capabilityProfile` opcional.
  - Gerar `cacheKey` por hash estável do canonical.
  - Implementar decisões `hit`, `miss`, `bypass` e `stale` sem dependência de Firestore real.
  - Implementar política de cacheabilidade para leitura e escrita.
- Critérios de verificação:
  - `node -c src/instantRecommendationCache.js` passa.
  - O módulo não importa Firestore/Admin SDK.
  - `cacheKeyCanonical` não contém `userId`, `sessionId`, timestamps exatos, rotas recentes detalhadas nem texto livre identificável.
  - Fallback, baixa confiança e contexto insuficiente geram bypass.
  - Capabilities irrelevantes não fragmentam a chave.

### T3 — Cobrir política de chave/cache com testes unitários

- Dependências: T2.
- Pode rodar em paralelo: sim, com T4 após o contrato do módulo puro estabilizar.
- Arquivo: `tests/unit/instant-recommendation-cache.test.js`.
- Ações:
  - Testar chave igual para chamadas com `userId`/`sessionId` diferentes e mesmo `promptVersion`, `stepId` e `contextProfile`.
  - Testar mudança de `promptVersion`, `stepId` ou `contextProfile` altera a chave.
  - Testar exclusão de IDs, timestamps exatos e texto livre no canonical.
  - Testar bypass para fallback, baixa confiança, contexto insuficiente e suspeita de PII.
  - Testar stale para `expiresAt <= now`.
  - Testar `capabilityProfile` apenas quando capabilities alteram shape/limites/tipos.
- Critérios de verificação:
  - `npx jest tests/unit/instant-recommendation-cache.test.js` passa.
  - Casos cobrem AC-001, AC-002, AC-005, AC-006, AC-007, AC-010 e AC-012.
  - Nenhum teste depende de chamada real ao Gemini ou Firestore real.

### T4 — Criar adapter Firestore injetável

- Dependências: T1 e contrato mínimo de T2.
- Pode rodar em paralelo: sim, com T3.
- Arquivo: `src/instantRecommendationCacheFirestoreAdapter.js`.
- Ações:
  - Implementar adapter para a collection `instantRecommendationCache`.
  - Expor operações equivalentes a `get`, `set` e `markHit` usando Firestore injetado.
  - Gravar documento com `cacheKey`, `cacheKeyCanonical`, `promptVersion`, `mode`, `stepId`, `responseVersion`, `recommendation`, `cacheability`, `stats`, `createdAt`, `updatedAt`, `expiresAt` e `status`.
  - Atualizar `hitCount` e `lastHitAt` best-effort em cache hit.
  - Tolerar writes concorrentes para a mesma chave com semântica last-write-wins/idempotente, sem exigir deduplicação forte.
  - Tratar corrida ou falha em `markHit` como best-effort e não bloqueante.
  - Representar falhas de leitura/escrita de modo observável para o orquestrador, sem quebrar o fluxo principal.
- Critérios de verificação:
  - Adapter usa somente a collection `instantRecommendationCache`.
  - Adapter não decide política de cacheability nem monta `contextProfile`.
  - Writes concorrentes para o mesmo `cacheKey` não quebram contrato de resposta nem exigem transação global.
  - Corrida/falha em `markHit` não impede uso do cache hit.
  - Falha de leitura/escrita pode ser testada com mock sem Firestore real.

### T5 — Testar adapter e schema do documento de cache

- Dependências: T4.
- Pode rodar em paralelo: sim, com T6 depois do contrato do adapter estabilizar.
- Arquivo: `tests/unit/instant-recommendation-cache.test.js`.
- Ações:
  - Adicionar testes com Firestore mockado para `get`, `set` e `markHit`.
  - Validar que `set` monta documento com os campos obrigatórios.
  - Validar que falha de leitura é retornada como read error consumível.
  - Validar que falha de escrita é observável e não exige throw para o fluxo principal.
  - Validar que dois writes equivalentes para o mesmo `cacheKey` são tolerados por last-write-wins/idempotência.
  - Validar que falha ou corrida em `markHit` é best-effort e não invalida o hit.
- Critérios de verificação:
  - `npx jest tests/unit/instant-recommendation-cache.test.js` passa.
  - Casos cobrem AC-008, AC-009, AC-011 e ISRC-REQ-020 no nível de adapter.
  - Nenhum teste grava em Firestore real.

### T6 — Integrar cache em `buildEnhancedInstantRecommendation`

- Dependências: T2 e T4.
- Pode rodar em paralelo: não, define o fluxo principal.
- Arquivo: `src/enhancedInstantMode.js`.
- Ações:
  - Receber dependências opcionais de cache sem quebrar chamadas existentes.
  - Derivar sinais antes da consulta de cache, reutilizando `deriveInstantSignals`.
  - Consultar cache antes de montar/chamar Gemini quando a chamada for cacheável.
  - Em hit válido, retornar recomendação compatível com o contrato final `INSTANT` sem chamar Gemini.
  - Em miss, bypass, stale ou read error, manter fluxo atual para Gemini/fallback.
  - Após normalização e validação final, gravar somente resposta cacheável.
  - Não gravar fallback usado por erro do Gemini.
  - Tratar write error como observabilidade, sem impedir retorno ao cliente.
- Critérios de verificação:
  - `node -c src/enhancedInstantMode.js` passa.
  - O contrato público final do `INSTANT` permanece compatível.
  - `src/geminiClient.js` continua provider-only.
  - Nenhuma lógica de cache é adicionada a `instantDomainRules.js`.

### T7 — Cobrir integração INSTANT/cache com testes unitários

- Dependências: T6.
- Pode rodar em paralelo: não.
- Arquivo: `tests/unit/instant-enhanced-mode.test.js`.
- Ações:
  - Testar cache hit ativo e não expirado retornando resposta sem chamar Gemini.
  - Testar cache miss chamando Gemini e gravando resposta final válida.
  - Testar entrada expirada tratada como stale e não usada.
  - Testar read error seguindo para Gemini.
  - Testar write error retornando resposta final ao cliente.
  - Testar fallback com `fallback.used: true` não gravado.
  - Testar que writes concorrentes simulados para a mesma chave não alteram o contrato retornado ao cliente.
  - Testar que cache hit não adiciona metadado público inesperado à response.
- Critérios de verificação:
  - `npx jest tests/unit/instant-enhanced-mode.test.js` passa.
  - Casos cobrem AC-003, AC-004, AC-005, AC-006, AC-008, AC-009, AC-013 e AC-014.
  - Nenhum teste chama Gemini real.

### T8 — Implementar observabilidade segura do cache

- Dependências: T2 e T6.
- Pode rodar em paralelo: sim, com T7 se o mecanismo de emissão estiver claro.
- Arquivos prováveis: `src/instantRecommendationCache.js`, `src/enhancedInstantMode.js`, possivelmente módulo existente de métricas/logs se já houver padrão.
- Ações:
  - Emitir eventos/métricas para hit, miss, bypass, stale, read error, write error, write success e Gemini saved.
  - Restringir dimensões a `mode`, `stepId`, `promptVersion`, `cachePolicyReason`, `hitOrMiss` e `ttlBucket`.
  - Não registrar `userId`, `sessionId`, request bruto, prompt bruto ou payload bruto.
  - Reutilizar mecanismo existente; não criar infraestrutura nova sem necessidade.
- Critérios de verificação:
  - Testes confirmam emissão dos eventos esperados.
  - Métricas/logs não contêm identificadores de usuário/sessão.
  - AC-014 coberto sem alterar contrato público da response.

### T9 — Fazer wiring mínimo em `index.js`

- Dependências: T4, T6.
- Pode rodar em paralelo: não, deve ocorrer após integração funcional.
- Arquivo: `index.js`.
- Ações:
  - Instanciar ou compor o adapter Firestore para `instantRecommendationCache`.
  - Injetar dependência no fluxo `INSTANT`.
  - Manter `index.js` restrito a composição; nenhuma política de chave, TTL, cacheability ou profile deve entrar no arquivo.
- Critérios de verificação:
  - `node -c index.js` passa.
  - Diff em `index.js` é pequeno e restrito a wiring.
  - AC-013 preservado: lógica principal fica fora de `index.js`.

### T10 — Revisar boundaries, acoplamento e regressões de modos

- Dependências: T6, T8, T9.
- Pode rodar em paralelo: não.
- Arquivos para revisão: `index.js`, `src/enhancedInstantMode.js`, `src/instantRecommendationCache.js`, `src/instantRecommendationCacheFirestoreAdapter.js`, `src/instantDomainRules.js`, `src/operationalContextValidator.js`.
- Ações:
  - Confirmar que `index.js` só compõe dependências.
  - Confirmar que `instantDomainRules.js` não recebeu responsabilidade de cache.
  - Confirmar que `operationalContextValidator.js` não recebeu derivação de profile de cache.
  - Confirmar que `STATIC`, `GRADUAL` e `adaptiveInterfaceCache` não foram alterados.
  - Confirmar que não há armazenamento de request bruto, prompt bruto ou PII.
- Critérios de verificação:
  - Boundaries da spec preservadas.
  - Arquivos grandes não ganharam nova responsabilidade.
  - Riscos de acoplamento documentados se algum ajuste residual for necessário.

### T11 — Validação final automatizada

- Dependências: T1 a T10.
- Pode rodar em paralelo: não, etapa final.
- Comandos:
  - `node -c index.js`
  - `node -c src/enhancedInstantMode.js`
  - `node -c src/instantRecommendationCache.js`
  - `node -c src/instantRecommendationCacheFirestoreAdapter.js`
  - `npx jest tests/unit/instant-recommendation-cache.test.js`
  - `npx jest tests/unit/instant-enhanced-mode.test.js`
  - `npm test`
- Critérios de verificação:
  - Comandos executados e resultados registrados.
  - Se algum comando não puder rodar, registrar motivo e evidência.
  - Nenhum teste depende de Gemini real ou Firestore real.

## Mapeamento de requisitos

| Requisito | Tasks principais |
| --- | --- |
| ISRC-REQ-001 | T2, T6, T7 |
| ISRC-REQ-002 | T6, T7 |
| ISRC-REQ-003 | T2, T6, T7 |
| ISRC-REQ-004 | T2, T3, T10 |
| ISRC-REQ-005 | T2, T3 |
| ISRC-REQ-006 | T2, T3 |
| ISRC-REQ-007 | T2, T3 |
| ISRC-REQ-008 | T4, T5, T9 |
| ISRC-REQ-009 | T4, T5 |
| ISRC-REQ-010 | T2, T3, T6, T7 |
| ISRC-REQ-011 | T2, T3 |
| ISRC-REQ-012 | T2, T3 |
| ISRC-REQ-013 | T4, T5, T6, T7 |
| ISRC-REQ-014 | T6, T7 |
| ISRC-REQ-015 | T8, T7 |
| ISRC-REQ-016 | T2, T3, T4, T10 |
| ISRC-REQ-017 | T2, T4, T6, T9, T10 |
| ISRC-REQ-018 | T2, T6, T7 |
| ISRC-REQ-019 | T2, T3 |
| ISRC-REQ-020 | T4, T6, T7 |

## Mapeamento de critérios de aceitação

| AC | Tasks principais |
| --- | --- |
| AC-001 | T2, T3 |
| AC-002 | T2, T3, T10 |
| AC-003 | T6, T7 |
| AC-004 | T6, T7 |
| AC-005 | T2, T6, T7 |
| AC-006 | T2, T3, T6, T7 |
| AC-007 | T2, T3 |
| AC-008 | T4, T6, T7 |
| AC-009 | T4, T6, T7 |
| AC-010 | T2, T3 |
| AC-011 | T4, T5 |
| AC-012 | T2, T3, T4, T10 |
| AC-013 | T2, T4, T6, T9, T10 |
| AC-014 | T7, T8 |

## Paralelismo

| Task | Dependências | Pode rodar em paralelo | Observação |
| --- | --- | --- | --- |
| T1 | nenhuma | não | Bloqueia implementação. |
| T2 | T1 | T3/T4 parcialmente | Define contrato central do cache. |
| T3 | T2 | T4/T5 | Testes podem evoluir com o módulo puro. |
| T4 | T1 + contrato de T2 | T3 | Adapter não deve decidir política. |
| T5 | T4 | T6 parcialmente | Depende do contrato do adapter. |
| T6 | T2, T4 | não | Integra fluxo principal. |
| T7 | T6 | T8 parcialmente | Valida comportamento integrado. |
| T8 | T2, T6 | T7 | Desde que mecanismo de emissão esteja claro. |
| T9 | T4, T6 | não | Wiring final em `index.js`. |
| T10 | T6, T8, T9 | não | Revisão arquitetural antes da validação final. |
| T11 | T1–T10 | não | Validação final. |

## Sequência recomendada

1. T1 — Mapear pontos de integração.
2. T2 — Criar módulo puro de política de cache.
3. T3/T4 — Cobrir política e criar adapter Firestore.
4. T5 — Testar adapter/schema.
5. T6 — Integrar no fluxo `buildEnhancedInstantRecommendation`.
6. T7/T8 — Cobrir integração e observabilidade.
7. T9 — Fazer wiring mínimo em `index.js`.
8. T10 — Revisar boundaries e regressões.
9. T11 — Rodar validação final.

## Lacunas que permanecem abertas

- As dimensões finais obrigatórias de `contextProfile` por `stepId` devem ser refinadas durante T1/T2 conforme os sinais reais disponíveis e testes existentes.
- O nome exato da constante inicial de `promptVersion` deve seguir o padrão encontrado no código durante T1/T2.
- A implementação deve reutilizar mecanismo existente de métricas/logs se houver; se não houver, limitar observabilidade a reporter injetável simples sem criar infraestrutura nova.
