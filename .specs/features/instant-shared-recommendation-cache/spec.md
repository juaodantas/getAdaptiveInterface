# Spec — Cache compartilhado de recomendações INSTANT geradas pelo Gemini

## Contexto

O modo `INSTANT` da Cloud Function `getAdaptiveInterface` hoje mantém Gemini como etapa de enriquecimento das recomendações adaptativas. O fluxo principal usa `buildEnhancedInstantRecommendation` em `src/enhancedInstantMode.js`, deriva sinais determinísticos com `deriveInstantSignals` em `src/instantDomainRules.js` e chama o provedor via `src/geminiClient.js`.

As recomendações geradas para usuários em estados operacionais semelhantes tendem a ser próximas, especialmente quando derivadas do mesmo `stepId`, do mesmo modo e de um contexto sanitizado amplo. Reaproveitar essas recomendações pode reduzir latência, custo e variabilidade sem remover Gemini do produto.

Já existe cache para o modo `GRADUAL` em `index.js`, usando `adaptiveInterfaceCache`, mas `index.js` é grande e não deve receber a lógica principal desta feature. A recomendação técnica é introduzir um módulo dedicado para cache INSTANT, com adapter Firestore injetado, mantendo `index.js` apenas como ponto de composição quando necessário.

## Problem statement

O `INSTANT` chama Gemini mesmo quando o contexto amplo do usuário é equivalente ao de chamadas recentes. Isso gera:

1. custo recorrente desnecessário;
2. maior latência em chamadas de interface adaptativa;
3. variação textual entre usuários semelhantes;
4. maior exposição operacional ao rate limit/falhas do provedor.

Um cache ingênuo por `userId` ou `sessionId` não resolve o problema de compartilhamento e ainda aumenta risco de acoplar recomendações a dados identificáveis. A feature precisa cachear por perfil contextual amplo, sem granularidade excessiva e sem usar identificadores de usuário/sessão na chave.

## Goals

- Manter Gemini como origem de recomendações novas quando não houver cache válido.
- Reaproveitar recomendações INSTANT entre usuários com contexto/estado semelhante.
- Criar chaves de cache focadas em `promptVersion`, `mode`, `stepId` e `contextProfile`.
- Usar `clientCapabilities` na chave somente quando a diferença de capabilities alterar o shape/cacheabilidade da resposta.
- Evitar `userId`, `sessionId`, timestamps exatos, rotas recentes detalhadas ou textos livres na chave.
- Definir modelo Firestore para a collection `instantRecommendationCache`.
- Definir TTL, invalidação, política de cacheabilidade, segurança/PII e observabilidade.
- Isolar a lógica principal em módulo dedicado com Firestore adapter injetado.
- Preservar contrato de response do `INSTANT`.

## Non-goals

- Não substituir Gemini por outro provedor.
- Não remover fallback determinístico do `INSTANT`.
- Não alterar comportamento dos modos `STATIC` ou `GRADUAL`.
- Não migrar ou refatorar o cache `adaptiveInterfaceCache` existente do `GRADUAL`.
- Não criar cache por usuário, sessão ou dispositivo.
- Não armazenar payload bruto de request, prompt completo com dados sensíveis ou resposta não validada do Gemini.
- Não implementar UI Flutter ou mudanças no app cliente.
- Não adicionar a lógica principal da feature em `index.js`.

## Requisitos rastreáveis

| ID | Requisito |
| --- | --- |
| ISRC-REQ-001 | O modo `INSTANT` deve consultar cache compartilhado antes de chamar Gemini quando a chamada for cacheável. |
| ISRC-REQ-002 | Cache miss deve manter o fluxo atual com Gemini via `src/geminiClient.js`. |
| ISRC-REQ-003 | Uma resposta Gemini somente pode ser gravada no cache após normalização e validação final do `INSTANT`. |
| ISRC-REQ-004 | A chave de cache não deve conter `userId`, `sessionId`, device id, IP, timestamp exato ou texto livre identificável. |
| ISRC-REQ-005 | A chave base deve ser composta por `promptVersion`, `mode`, `stepId` e `contextProfile`. |
| ISRC-REQ-006 | `clientCapabilities` só deve participar da chave quando limitar componentes, quantidades ou tipos de forma que altere a resposta final cacheada. |
| ISRC-REQ-007 | `contextProfile` deve ser derivado de sinais sanitizados, discretizados e amplos, preferencialmente a partir de `deriveInstantSignals`. |
| ISRC-REQ-008 | O cache deve usar collection Firestore `instantRecommendationCache`. |
| ISRC-REQ-009 | Cada documento de cache deve registrar metadados de versão, expiração, status e observabilidade. |
| ISRC-REQ-010 | Entradas expiradas, inválidas ou incompatíveis com a versão do prompt não devem ser usadas. |
| ISRC-REQ-011 | A política de TTL deve ser explícita e curta o suficiente para evitar recomendações obsoletas. |
| ISRC-REQ-012 | Mudança de `promptVersion` deve invalidar logicamente entradas antigas sem exigir deleção imediata. |
| ISRC-REQ-013 | Falha de leitura/escrita do cache não deve impedir a geração de resposta INSTANT. |
| ISRC-REQ-014 | A response retornada em cache hit deve preservar o contrato final do `INSTANT`. |
| ISRC-REQ-015 | A implementação deve expor métricas de hit, miss, bypass, stale, read error, write error e Gemini saved. |
| ISRC-REQ-016 | O cache não deve armazenar PII nem texto livre oriundo do usuário. |
| ISRC-REQ-017 | A lógica principal deve ficar em módulo dedicado, com adapter Firestore injetado, sem expandir significativamente `index.js`. |
| ISRC-REQ-018 | Recomendações com fallback usado por erro do Gemini não devem ser cacheadas por padrão. |
| ISRC-REQ-019 | Recomendações específicas demais, de baixa confiança ou dependentes de contexto volátil devem ser bypassadas. |
| ISRC-REQ-020 | Operações concorrentes para a mesma chave devem tolerar race condition sem quebrar contrato; deduplicação forte é opcional nesta spec. |

## Technical approach and design decisions

### Fluxo proposto

1. `buildEnhancedInstantRecommendation` continua sendo o ponto de orquestração do modo `INSTANT`.
2. Antes de montar/chamar Gemini, o fluxo deriva sinais com `deriveInstantSignals`.
3. Um módulo dedicado, por exemplo `src/instantRecommendationCache.js`, recebe sinais sanitizados, versão de prompt, modo, step e capabilities normalizadas.
4. O módulo decide se a chamada é cacheável.
5. Se cacheável, calcula `cacheKey` e consulta `instantRecommendationCache` via adapter Firestore injetado.
6. Em cache hit válido, retorna a recomendação final cacheada com metadados de cache.
7. Em miss/bypass/stale/erro de leitura, segue para Gemini.
8. Após normalização e validação final, grava no cache somente se a resposta for cacheável.

### Decisões de design

- **Cache compartilhado por contexto, não por identidade:** maximiza reaproveitamento e reduz risco de PII.
- **Chave ampla e discretizada:** evita fragmentação por detalhes finos que não mudam a recomendação.
- **`promptVersion` na chave:** mudanças de prompt/schema invalidam versões antigas automaticamente.
- **Adapter Firestore injetado:** permite testar política de chave/cache sem depender de Firestore real e evita acoplamento de domínio à infraestrutura.
- **Cache best-effort:** erro no cache não deve impedir resposta do `INSTANT`.
- **Somente respostas finais válidas:** o cache armazena output pós-validação, nunca resposta bruta do Gemini.

## Estratégia de chave ampla

### Componentes obrigatórios

| Componente | Regra |
| --- | --- |
| `promptVersion` | Versão estável do prompt/schema usado para Gemini. |
| `mode` | Deve ser `INSTANT`. |
| `stepId` | Step derivado por `deriveInstantSignals`. |
| `contextProfile` | Perfil amplo, sanitizado e discretizado do estado operacional. |

### `contextProfile`

`contextProfile` deve representar estado suficiente para recomendações semelhantes, sem identificar usuário. Exemplos de dimensões aceitáveis:

- etapa do roteiro/sinais de sequência (`testSequenceSignals` normalizados);
- presença de lote ativo, protocolo vinculado e atividades geradas;
- buckets de tarefas pendentes/atrasadas (`none`, `low`, `medium`, `high`), não contagens exatas quando desnecessárias;
- presença de alerta crítico e bucket de severidade;
- existência de dados de produção recentes como boolean/bucket;
- rota atual canônica somente se ela alterar materialmente a recomendação.

Exemplo conceitual:

```json
{
  "sequenceStage": "activities_generated_not_seen",
  "lotState": "active_with_protocol",
  "agendaLoad": "pending_today_low",
  "overdueLoad": "none",
  "alertState": "none",
  "productionState": "no_recent_production",
  "currentRouteGroup": "home"
}
```

O documento pode usar um hash estável do payload canônico como ID, desde que o payload canônico também seja armazenado sem PII para debug seguro.

### Uso de capabilities

`clientCapabilities` não deve entrar na chave por padrão. Só deve ser incorporado quando afetar o shape da resposta final, por exemplo:

- `maxShortcuts` menor que o default usado no cache;
- ausência de componente necessário para a recomendação cacheada;
- `supportedInfoTypes` restringindo `infoRecommendation`;
- `maxSectionAdaptations` menor que o default.

Quando necessário, usar um `capabilityProfile` discretizado, não o objeto bruto.

## Data structures or interfaces involved

### Collection Firestore sugerida: `instantRecommendationCache`

ID sugerido do documento: hash estável de `cacheKeyCanonical`.

```json
{
  "cacheKey": "sha256:...",
  "cacheKeyCanonical": {
    "promptVersion": "instant-v3",
    "mode": "INSTANT",
    "stepId": "check_generated_activities",
    "contextProfile": {
      "sequenceStage": "activities_generated_not_seen",
      "lotState": "active_with_protocol",
      "agendaLoad": "pending_today_low",
      "overdueLoad": "none",
      "alertState": "none",
      "productionState": "no_recent_production",
      "currentRouteGroup": "home"
    },
    "capabilityProfile": null
  },
  "promptVersion": "instant-v3",
  "mode": "INSTANT",
  "stepId": "check_generated_activities",
  "responseVersion": "1.0",
  "recommendation": {
    "mode": "INSTANT",
    "source": "adaptive",
    "dashboard": "Tarefas Pendentes",
    "dashboardId": "TAREFAS_PENDENTES",
    "cardType": "tarefas",
    "confidence": 0.82,
    "visualPriority": "moderate",
    "nextStepPrediction": {},
    "sectionAdaptations": [],
    "shortcuts": [],
    "focus": {},
    "uiTreatment": {},
    "reason": "Texto genérico não identificável",
    "reasonDetails": {},
    "rulesApplied": [],
    "fallback": { "used": false, "reason": null },
    "infoRecommendation": {}
  },
  "cacheability": {
    "cacheable": true,
    "reason": "valid_shared_context"
  },
  "stats": {
    "hitCount": 0,
    "lastHitAt": null
  },
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "expiresAt": "timestamp",
  "status": "active"
}
```

### Interface conceitual do módulo

```ts
type InstantRecommendationCacheDecision =
  | { kind: 'hit'; recommendation: InstantRecommendation; cacheKey: string }
  | { kind: 'miss'; cacheKey: string }
  | { kind: 'bypass'; reason: string };

type InstantRecommendationCacheAdapter = {
  get(cacheKey: string): Promise<InstantRecommendationCacheEntry | null>;
  set(entry: InstantRecommendationCacheEntry): Promise<void>;
  markHit(cacheKey: string): Promise<void>;
};
```

Esta interface é ilustrativa; a implementação deve seguir os padrões JavaScript/TypeScript existentes do repositório.

## Política de TTL e invalidação

- TTL padrão sugerido: 24 horas para respostas INSTANT cacheadas.
- TTL menor sugerido: 1 a 6 horas para perfis com alertas críticos, tarefas atrasadas ou contexto operacional mais volátil.
- Entradas com `expiresAt <= now` devem ser tratadas como stale e não retornadas.
- Mudança de `promptVersion` invalida logicamente entradas antigas porque altera a chave.
- Mudança de contrato de response ou schema deve atualizar `promptVersion` ou `responseVersion`.
- Invalidação manual pode ser feita por `status: "disabled"` ou por mudança controlada de versão, sem exigir deleção física imediata.
- Limpeza física de documentos expirados pode ser feita futuramente por job/TTL nativo Firestore, fora do escopo de implementação principal.

## Política de cacheabilidade

Uma chamada pode usar cache quando:

- `mode` é `INSTANT`;
- existe `stepId` derivado de forma determinística;
- `contextProfile` é composto apenas por sinais sanitizados;
- capabilities não exigem variação não representada pela chave;
- a recomendação final passou pela validação existente;
- `fallback.used` é `false`;
- `confidence` está acima do limiar mínimo definido para cache, sugerido `>= 0.7`.

Uma chamada deve bypassar cache quando:

- faltam sinais suficientes para gerar `contextProfile` estável;
- há dado textual livre necessário para a recomendação;
- capabilities restringem resposta de forma não modelada;
- a resposta é fallback por erro do Gemini;
- a recomendação depende de timestamp exato, navegação granular ou estado altamente volátil;
- qualquer campo de PII for detectado no payload que seria armazenado.

## Segurança e PII

- `userId`, `sessionId`, nomes de usuários, nomes de lotes, descrições livres, anotações e qualquer identificador direto não podem compor chave nem documento.
- O cache deve armazenar apenas contexto canônico sanitizado, buckets, enums, flags e resposta final validada.
- A resposta cacheada não deve conter interpolação de dados identificáveis.
- Logs e métricas devem registrar `cacheKey` ou prefixo/hash, nunca request bruto.
- Falhas de validação por suspeita de PII devem impedir gravação no cache.
- O módulo deve tratar dados externos como hostis e depender da validação já existente nas boundaries do `INSTANT`.

## Observabilidade

Eventos/métricas sugeridos:

| Evento | Quando emitir |
| --- | --- |
| `instant_cache_hit` | Documento válido encontrado e usado. |
| `instant_cache_miss` | Chave cacheável sem documento válido. |
| `instant_cache_bypass` | Política decide não usar cache. |
| `instant_cache_stale` | Documento encontrado, mas expirado/incompatível. |
| `instant_cache_read_error` | Erro ao consultar Firestore. |
| `instant_cache_write_error` | Erro ao gravar Firestore. |
| `instant_cache_write_success` | Resposta final válida gravada. |
| `instant_gemini_saved_by_cache` | Cache hit evitou chamada ao Gemini. |

Dimensões permitidas: `mode`, `stepId`, `promptVersion`, `cachePolicyReason`, `hitOrMiss`, `ttlBucket`. Não registrar `userId`, `sessionId` ou payload bruto.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Recomendação obsoleta por contexto amplo demais | TTL curto, `promptVersion`, buckets bem definidos e bypass para contextos voláteis. |
| Fragmentação por chave detalhada demais | Proibir identificadores e detalhes finos; revisar `contextProfile` por step. |
| Vazamento de PII no cache | Armazenar apenas resposta validada e contexto sanitizado; bloquear texto livre. |
| Aumento de complexidade em `index.js` | Módulo dedicado com adapter injetado; `index.js` apenas compõe dependências. |
| Cache hit com capabilities incompatíveis | `capabilityProfile` só quando necessário e validação final antes de retornar. |
| Métricas de economia imprecisas | Emitir evento explícito `instant_gemini_saved_by_cache` em hits. |
| Race condition em writes concorrentes | Aceitar last-write-wins para mesma chave; resposta deve ser equivalente por política. |

## Plano de validação

- Testar geração determinística de `cacheKey` para contextos equivalentes com `userId`/`sessionId` diferentes.
- Testar que mudanças em `promptVersion`, `stepId` ou `contextProfile` alteram a chave.
- Testar que timestamps exatos, ids e textos livres não aparecem em `cacheKeyCanonical`.
- Testar cache hit retorna recomendação final sem chamar Gemini.
- Testar cache miss chama Gemini e grava somente resposta final válida.
- Testar entrada expirada é tratada como stale e não usada.
- Testar falha de leitura/escrita do cache não impede resposta INSTANT.
- Testar bypass para fallback Gemini, baixa confiança e contexto insuficiente.
- Testar variações relevantes de capabilities geram `capabilityProfile` ou bypass.
- Testar emissão de métricas para hit, miss, bypass, stale, read error, write error e Gemini saved.

## Critérios de aceitação

- AC-001: Dadas duas chamadas `INSTANT` com `userId` e `sessionId` diferentes, mas mesmo `promptVersion`, `stepId` e `contextProfile`, a chave de cache gerada é igual.
- AC-002: A chave de cache não contém `userId`, `sessionId`, timestamps exatos, rotas recentes detalhadas nem texto livre.
- AC-003: Dado cache hit ativo e não expirado, a Function retorna recomendação compatível com o contrato `INSTANT` sem chamar Gemini.
- AC-004: Dado cache miss cacheável, a Function chama Gemini e grava a resposta final validada em `instantRecommendationCache`.
- AC-005: Dada resposta Gemini inválida ou fallback com `fallback.used: true`, nenhuma entrada é gravada no cache.
- AC-006: Dada entrada com `expiresAt` no passado, a Function não usa a recomendação e emite métrica de stale.
- AC-007: Dada mudança de `promptVersion`, entradas antigas não são retornadas para a nova versão.
- AC-008: Dada falha de leitura do Firestore, o fluxo segue para Gemini e emite métrica de read error.
- AC-009: Dada falha de escrita no Firestore, a resposta INSTANT ainda é retornada ao cliente e a falha é observável.
- AC-010: `clientCapabilities` só altera a chave quando afeta shape ou limites da resposta cacheada; caso contrário, a chave permanece compartilhável.
- AC-011: O documento salvo em `instantRecommendationCache` contém `cacheKeyCanonical`, `promptVersion`, `mode`, `stepId`, `recommendation`, `createdAt`, `updatedAt`, `expiresAt` e `status`.
- AC-012: Nenhum documento salvo contém request bruto, prompt bruto, `userId`, `sessionId` ou PII conhecida.
- AC-013: A lógica principal de cache fica fora de `index.js`, em módulo dedicado com adapter Firestore injetado.
- AC-014: Métricas de hit, miss, bypass, stale, erro de leitura, erro de escrita e Gemini economizado são emitidas sem identificadores de usuário/sessão.

## Open questions

- Qual deve ser o valor inicial oficial de `promptVersion` para o prompt INSTANT atual?
- O TTL padrão deve ser 24 horas ou menor durante o experimento moderado?
- Qual limiar de `confidence` deve habilitar cache: `0.7`, `0.75` ou outro valor?
- Quais dimensões finais de `contextProfile` devem ser consideradas obrigatórias por `stepId`?
- A resposta retornada em cache hit deve adicionar metadado interno de `cache: { hit: true }` ou isso deve ficar apenas em métricas?
- O Firestore usará TTL nativo em `expiresAt` ou limpeza manual futura?
