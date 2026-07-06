# Spec — Deduplicação de rotas entre superfícies de recomendação no modo INSTANT

## Contexto

O modo `INSTANT` do `getAdaptiveInterface` retorna 4 superfícies de recomendação distintas, cada uma com um campo de rota que o frontend renderiza como cards/ações na seção "ações recomendadas":

| Superfície | Campo de rota | Propósito |
|---|---|---|
| `nextStepPrediction` | `targetRoute` | Card principal — próximo passo do fluxo |
| `infoRecommendation` | `ctaRoute` | Card informativo com ação alternativa |
| `shortcuts` | `route` | Botões de atalho (grupos `primary`, `secondary`, `contextual`) |
| `sectionAdaptations` | (não tem rota direta) | Destaque de seção |

Atualmente, estas três superfícies frequentemente apontam para a **mesma rota**, reduzindo a utilidade percebida das recomendações:

1. **Fallback determinístico** (`instantFallbackBuilder.js`): `deriveInstantSignals()` produz `signals.targetRoute` e `signals.shortcuts` cujo primeiro item (grupo `primary`) sempre possui `route === targetRoute`. A matriz `INFO_BY_RULE` em `instantInfoRecommendationBuilder.js` define `ctaRoute` também igual ao `targetRoute` da regra.
2. **Caminho Gemini** (`instantResponseNormalizer.js` → `instantInfoRecommendationBuilder.js`): O prompt não instrui o modelo a diferenciar rotas, e `normalizeInfoWithSignal` frequentemente rejeita o `infoRecommendation` do Gemini se o tipo diferir do esperado — que compartilha a mesma rota — caindo no mesmo fallback determinístico.

## Problem statement

**O quê**: Aplicar pós-processamento de deduplicação de rotas ao final do pipeline `INSTANT` para garantir que `nextStepPrediction`, `infoRecommendation` e `shortcuts` apontem para rotas **semanticamente relacionadas porém diferentes**.

**Por que**: O valor da recomendação diminui quando múltiplas superfícies levam à mesma página. O usuário vê cards diferentes que fazem a mesma coisa, gerando confusão e diminuindo a confiança no sistema adaptativo. Ao diversificar as rotas, cada card oferece uma ação complementar útil dentro do mesmo contexto operacional.

**Impacto se não resolvido**:
- Experiência redundante: o card principal (nextStep), o card de info e o atalho primário disputam a mesma ação.
- Baixa adoção das superfícies secundárias de recomendação (`infoRecommendation`, `shortcuts`).
- Dificuldade em medir o valor incremental de cada superfície.

## Goals

- `infoRecommendation.ctaRoute` deve ser diferente de `nextStepPrediction.targetRoute` **sempre que houver alternativa viável** dentro da allowlist.
- `shortcuts[].route` não deve conter rotas duplicadas entre si.
- O shortcut primário (`group === 'primary'`) deve preferencialmente ser diferente de `nextStepPrediction.targetRoute`.
- A deduplicação deve operar como pós-processamento, sem alterar a lógica central de derivação de sinais.
- A abordagem deve funcionar tanto para respostas Gemini válidas quanto para fallback determinístico.
- O mapeamento de rotas alternativas deve ser semântico: rotas substitutas devem pertencer ao mesmo contexto funcional da rota original.

## Non-goals

- Não alterar o algoritmo de `deriveInstantSignals` nem a matriz `STEP_SHORTCUTS`.
- Não remover shortcuts por causa de deduplicação.
- Não alterar o contrato de response (`shape` dos campos permanece idêntico).
- Não modificar o prompt Gemini (a deduplicação ocorre no pós-processamento, não no prompt).
- Não alterar `sectionAdaptations` (superfície sem campo de rota direto).
- Não adicionar novas dependências externas.

## Requisitos rastreáveis

| ID | Requisito | Prioridade |
|---|---|---|
| RD-REQ-001 | O sistema deve manter um mapeamento de rota alternativa para cada rota alvo possível. | Alta |
| RD-REQ-002 | `finalizeValidInstantResponse` em `instantResponseValidator.js` deve aplicar deduplicação em `infoRecommendation.ctaRoute` contra `nextStepPrediction.targetRoute`. | Alta |
| RD-REQ-003 | `buildEnhancedInstantFallback` em `instantFallbackBuilder.js` deve aplicar deduplicação em `infoRecommendation.ctaRoute` e `shortcuts` contra `nextStepPrediction.targetRoute`. | Alta |
| RD-REQ-004 | A normalização em `normalizeInstantResponse` (Gemini) deve garantir que o `infoRecommendation` resultante não compartilhe rota com `nextStepPrediction.targetRoute`. | Alta |
| RD-REQ-005 | `shortcuts` não devem conter rotas duplicadas entre si após deduplicação. | Média |
| RD-REQ-006 | O shortcut de grupo `primary` deve preferencialmente diferir de `nextStepPrediction.targetRoute`. | Média |
| RD-REQ-007 | Se não houver alternativa viável na allowlist, `infoRecommendation.ctaRoute` pode manter a rota original como fallback extremo. | Baixa |
| RD-REQ-008 | A deduplicação não deve quebrar a validação de contrato (`infoRecommendation` continua obrigatório e com todos os campos). | Alta |
| RD-REQ-009 | `ALTERNATIVE_CTA_BY_TARGET` deve ser um mapa definido em `instantInfoRecommendationBuilder.js`. | Alta |
| RD-REQ-010 | O mapeamento alternativo deve ser bijetivo (rota A → B e B → A) ou ao menos formar ciclos fechados para evitar inconsistências. | Média |
| RD-REQ-011 | As rotas alternativas devem ser sempre um subconjunto de `ALLOWED_INFO_CTA_ROUTES`. | Alta |
| RD-REQ-012 | A função de deduplicação deve ser testável unitariamente. | Alta |

## Design técnico

### Arquivos afetados

| Arquivo | Responsabilidade |
|---|---|
| `src/instantInfoRecommendationBuilder.js` | Recebe o mapa `ALTERNATIVE_CTA_BY_TARGET` e a função `buildDeduplicatedCtaRoute`. |
| `src/instantResponseValidator.js` | `finalizeValidInstantResponse` aplica deduplicação no `infoRecommendation` e `shortcuts`. |
| `src/instantFallbackBuilder.js` | `buildEnhancedInstantFallback` aplica deduplicação no `infoRecommendation` e `shortcuts` antes de retornar a resposta. |
| `src/instantResponseNormalizer.js` | `normalizeInstantResponse` aplica deduplicação após normalizar Gemini (se necessário). |
| `src/adaptiveContract.js` | (Nenhuma alteração — `ALLOWED_INFO_CTA_ROUTES` já está definido.) |

### Fluxo de deduplicação

#### 1. Mapa de rotas alternativas (`instantInfoRecommendationBuilder.js`)

```js
const ALTERNATIVE_CTA_BY_TARGET = {
  '/protocoloPage': '/lotePage',
  '/agendaPage': '/relatoriosPage',
  '/cadernoCampoPage': '/solucaoPage',
  '/relatoriosPage': '/agendaPage',
  '/lotePage': '/areaCultivoPage',
  '/solucaoPage': '/reservatoriosPage',
  '/gerenciarEquipePage': '/agendaPage',
  '/areaCultivoPage': '/lotePage',
  '/reservatoriosPage': '/solucaoPage',
};
```

Regras do mapa:
- **Bijetividade parcial**: rotas que aparecem como chave e valor formam pares. Rotas sem entrada no mapa mantêm a rota original.
- **Validação**: cada valor deve estar em `ALLOWED_INFO_CTA_ROUTES`.
- **Cobertura**: cobre todas as rotas que aparecem como `targetRoute` nas regras ou como `route` nos `STEP_SHORTCUTS`.

#### 2. Função `buildDeduplicatedCtaRoute(primaryRoute, allowedRoutes)` ← `instantInfoRecommendationBuilder.js`

```js
/**
 * Retorna uma rota CTA alternativa à `primaryRoute` usando o mapa semântico.
 * Se a alternativa não estiver em `allowedRoutes`, ou se não houver alternativa,
 * retorna a `primaryRoute` como fallback.
 *
 * @param {string} primaryRoute - Rota do nextStepPrediction.targetRoute
 * @param {string[]} allowedRoutes - Lista de rotas permitidas (ALLOWED_INFO_CTA_ROUTES)
 * @returns {string} Rota alternativa ou a própria primaryRoute
 */
function buildDeduplicatedCtaRoute(primaryRoute, allowedRoutes) { ... }
```

Comportamento:
1. Consulta `ALTERNATIVE_CTA_BY_TARGET[primaryRoute]`.
2. Se a alternativa existe **e** está em `allowedRoutes`, retorna a alternativa.
3. Caso contrário, retorna `primaryRoute` (não quebra o contrato).

#### 3. Chamadas nos pontos de pós-processamento

**A. `finalizeValidInstantResponse` (instantResponseValidator.js)**

Após validar/normalizar `infoRecommendation` e `shortcuts`, aplicar:

```js
// infoRecommendation.ctaRoute
response.infoRecommendation.ctaRoute = buildDeduplicatedCtaRoute(
  response.nextStepPrediction.targetRoute,
  ALLOWED_INFO_CTA_ROUTES,
);

// shortcuts: deduplicar rotas entre si + evitar primary = targetRoute
response.shortcuts = deduplicateShortcutRoutes(
  response.shortcuts,
  response.nextStepPrediction.targetRoute,
);
```

**B. `buildEnhancedInstantFallback` (instantFallbackBuilder.js)**

Após construir `infoRecommendation` via `buildInfoRecommendationFallback`, aplicar a mesma função:

```js
const infoRec = buildInfoRecommendationFallback({ signals, clientCapabilities, operationalContext });
infoRec.ctaRoute = buildDeduplicatedCtaRoute(signals.targetRoute, ALLOWED_INFO_CTA_ROUTES);
```

E nos `shortcuts`:

```js
response.shortcuts = deduplicateShortcutRoutes(signals.shortcuts, signals.targetRoute);
```

**C. `normalizeInstantResponse` (instantResponseNormalizer.js)**

Após normalizar o `infoRecommendation` via `normalizeInfoWithSignal`, e antes de montar o objeto final:

```js
const infoRecommendation = normalizeInfoWithSignal(...);
if (infoRecommendation) {
  infoRecommendation.ctaRoute = buildDeduplicatedCtaRoute(
    nextStep.targetRoute,
    ALLOWED_INFO_CTA_ROUTES,
  );
}
```

#### 4. Função `deduplicateShortcutRoutes(shortcuts, primaryRoute)` ← novo helper

```js
/**
 * Remove duplicatas de rota entre shortcuts e, preferencialmente,
 * troca a rota do shortcut primário se for igual a primaryRoute.
 *
 * @param {Array} shortcuts - Lista de shortcuts
 * @param {string} primaryRoute - Rota do nextStepPrediction.targetRoute
 * @returns {Array} Shortcuts sem duplicatas de rota
 */
function deduplicateShortcutRoutes(shortcuts, primaryRoute) { ... }
```

Algoritmo:
1. Agrupar shortcuts por rota. Manter o primeiro de cada rota (ou o de maior `confidence`).
2. Se o shortcut `group === 'primary'` tem `route === primaryRoute`, tentar substituir sua rota pela primeira rota diferente disponível entre os demais shortcuts (mantendo label/reason originais). Se não houver alternativa, manter a rota original.
3. Shortcuts duplicados são removidos (mantém-se o primeiro).

### Exemplo de comportamento esperado

**Cenário: passo `create_lot_with_protocol` (fallback)**

```
nextStepPrediction.targetRoute = '/protocoloPage'

Antes da deduplicação:
  infoRecommendation.ctaRoute = '/protocoloPage'     ← igual
  shortcuts[0].route = '/protocoloPage' (primary)     ← igual
  shortcuts[1].route = '/lotePage' (secondary)
  shortcuts[2].route = '/areaCultivoPage' (contextual)

Após deduplicação:
  infoRecommendation.ctaRoute = '/lotePage'           ← diferente (via ALTERNATIVE_CTA)
  shortcuts[0].route = '/lotePage' (primary)           ← mudado para evitar duplicata? OU mantém?
```

Aqui precisamos decidir: o shortcut primário pode mudar de rota? A spec do usuário diz que idealmente deve ser diferente. Vamos seguir a regra:

- `infoRecommendation.ctaRoute` **sempre** tenta ser diferente (usando `buildDeduplicatedCtaRoute`).
- `shortcuts` podem ter a rota do `targetRoute` se não houver alternativas, mas o ideal é evitar.

Então no cenário acima, provavelmente:
```
infoRecommendation.ctaRoute = '/lotePage'
shortcuts[0].route = '/protocoloPage' (mantém primary, afinal o card principal já leva para lá)
```

Mas e se quisermos que o primary shortcut seja diferente? Aí seria preciso trocar o primary shortcut por outro existente ou criar um novo. Isso pode ser complexo. A spec diz "o ideal é evitar", mas não é mandatório. Vamos adotar a regra:
- Se o primary shortcut tiver a mesma rota que targetRoute, e houver algum outro shortcut com rota diferente, **promover** esse outro shortcut para primary e manter o original como secundário, OU simplesmente trocar a rota do primary shortcut pela rota do segundo shortcut.

Vou seguir uma abordagem conservadora: manter a estrutura original, mas remover duplicatas. Se o primary shortcut é igual ao targetRoute, isso é aceitável (é um atalho direto para o próximo passo). O foco principal é infoRecommendation ser diferente.

Na verdade, relendo o user request:
> `shortcuts[].route` não deve conter mais de um shortcut com a mesma rota
> O shortcut primário (grupo `primary`) deve ser diferente de `nextStepPrediction.targetRoute` (já que o card principal já leva para essa rota)

Então sim, o shortcut primário deve ser diferente de targetRoute. Vamos adotar essa regra mais forte. Mas o que fazer se não houver outra rota disponível nos shortcuts? Aí mantém.

### Estratégia para remover rota duplicada do shortcut primário

1. Se `shortcuts[0].route === targetRoute`:
   a. Procurar o próximo shortcut com rota diferente de `targetRoute`.
   b. Se encontrar, trocar a `route` do primary shortcut pela rota desse outro shortcut (preservando label/description/group do primary). O outro shortcut permanece com a rota antiga.
   c. Se todos os shortcuts tiverem a mesma rota, manter como está.

2. Remover duplicatas exatas de rota entre os demais shortcuts (keep first by confidence).

### Localização do código

Todo o novo código de deduplicação (mapa + funções) pode ficar em `src/instantInfoRecommendationBuilder.js` por coesão (já que lida com Info recommendation e rotas), ou em um módulo separado. Como a regra do projeto é "consistência supera pureza teórica" e o arquivo tem 237 linhas atualmente, não ultrapassaria o limite de 300. Vou manter em `instantInfoRecommendationBuilder.js`.

### Contrato de resposta

Nenhum campo novo é adicionado. Apenas os valores de campos existentes (`ctaRoute`, `shortcuts[].route`) são alterados. O shape permanece idêntico ao documentado na spec `instant-home-info-recommendation`.

## Critérios de aceitação

| ID | Critério |
|---|---|
| AC-001 | Dado `nextStepPrediction.targetRoute = '/protocoloPage'`, `infoRecommendation.ctaRoute` deve ser `'/lotePage'` (via `ALTERNATIVE_CTA_BY_TARGET`). |
| AC-002 | Dado `nextStepPrediction.targetRoute = '/agendaPage'`, `infoRecommendation.ctaRoute` deve ser `'/relatoriosPage'`. |
| AC-003 | Dado `nextStepPrediction.targetRoute = '/cadernoCampoPage'`, `infoRecommendation.ctaRoute` deve ser `'/solucaoPage'`. |
| AC-004 | Dado Gemini retornando `infoRecommendation.ctaRoute = '/agendaPage'` e `nextStepPrediction.targetRoute = '/agendaPage'`, a normalização ajusta `ctaRoute` para `'/relatoriosPage'`. |
| AC-005 | Dado fallback determinístico com `signals.targetRoute = '/protocoloPage'`, `buildEnhancedInstantFallback` retorna `infoRecommendation.ctaRoute = '/lotePage'`. |
| AC-006 | Dado `shortcuts = [ { route: '/agendaPage', group: 'primary' }, { route: '/agendaPage', group: 'secondary' } ]`, a deduplicação remove o segundo. |
| AC-007 | Dado `shortcuts = [ { route: '/agendaPage', group: 'primary' } ]` e `nextStepPrediction.targetRoute = '/agendaPage'`, o shortcut primário mantém a rota se não houver alternativa. |
| AC-008 | Dado `shortcuts = [ { route: '/agendaPage', group: 'primary' }, { route: '/relatoriosPage', group: 'secondary' } ]` e `targetRoute = '/agendaPage'`, o shortcut primário troca sua rota para `'/relatoriosPage'` (ou promove o secondary). |
| AC-009 | `ALTERNATIVE_CTA_BY_TARGET` contém todas as chaves necessárias para cobrir as `targetRoute` de todas as regras em `INFO_BY_RULE`. |
| AC-010 | `ALTERNATIVE_CTA_BY_TARGET` contém todas as chaves necessárias para cobrir as `route` dos shortcuts primários em `STEP_SHORTCUTS`. |
| AC-011 | Nenhum valor em `ALTERNATIVE_CTA_BY_TARGET` está fora de `ALLOWED_INFO_CTA_ROUTES`. |
| AC-012 | `buildDeduplicatedCtaRoute` com rota não mapeada retorna a própria rota (fallback seguro). |
| AC-013 | `buildDeduplicatedCtaRoute` com rota mapeada para rota não permitida retorna a própria rota (fallback seguro). |
| AC-014 | `infoRecommendation` continua presente e válido em todas as respostas INSTANT após deduplicação. |
| AC-015 | Testes unitários cobrem `buildDeduplicatedCtaRoute`, `deduplicateShortcutRoutes`, `ALTERNATIVE_CTA_BY_TARGET` validação, fallback Gemini e fallback determinístico. |

## Riscos

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| Rota alternativa não faz sentido semântico para o usuário | Confusão do usuário | Baixa | Mapeamento revisado manualmente; todas as alternativas são do mesmo contexto funcional |
| Gemini retorna ctaRoute válido e semanticamente superior, mas é sobrescrito pela deduplicação | Perda de assertividade | Média | A deduplicação ocorre APÓS a validação Gemini; Gemini tem precedência sobre fallback, mas não sobre a regra de não repetir rota |
| Shortcuts perdem rotas úteis por causa da remoção de duplicatas | Redução de opções | Baixa | Remoção apenas de duplicatas exatas; preserva labels/descriptions |
| Rota alternativa está na allowlist mas não faz sentido na resposta atual (ex: rota de lote quando não há lote) | Link quebrado ou página vazia | Média | `ALTERNATIVE_CTA_BY_TARGET` usa rotas semanticamente relacionadas; o mesmo risco já existe no sistema atual com qualquer rota |
| Novas rotas adicionadas no futuro sem entrada no mapa | Deduplicação não funciona para nova rota | Média | `buildDeduplicatedCtaRoute` retorna fallback para rota original (não quebra); adicionar entrada no mapa deve fazer parte do checklist de novas features |
| infoRecommendation.ctaRoute é alterado, mas o infoRecommendation.type/category não correspondem mais à rota | Inconsistência semântica | Baixa | O mapeamento é semântico (agenda ↔ relatorios, protocolo ↔ lote); type/category são genéricos e compatíveis com ambas as rotas |

## Open questions

1. O shortcut primário com rota igual a `targetRoute` deve **ter sua rota trocada** (preservando label/group) ou devemos **promover outro shortcut** a primário? A primeira opção é mais simples; a segunda é semanticamente mais correta. Recomendação: trocar a rota do shortcut primário, preservando seu label/description/group, para não alterar a hierarquia visual esperada pelo frontend.

2. Devemos também aplicar deduplicação entre `shortcuts` e `infoRecommendation.ctaRoute`? Ex: se um shortcut já tem a mesma rota que o `ctaRoute` deduplicado, isso é aceitável? A intenção do usuário é focar na diferença entre as **superfícies** (nextStep, info, shortcuts), não entre cada par. Mas remover duplicatas entre shortcuts e info também traria benefício. Sugestão: por ora, manter escopo mínimo (nextStep vs info, shortcuts entre si, primary shortcut vs targetRoute).

3. O mapeamento atual é estático. Deveria ser dinâmico com base no contexto operacional (ex: se o usuário já visitou a rota alternativa recentemente)? Isso adicionaria complexidade significativa e foge do escopo desta feature. Pode ser revisitado em versão futura.
