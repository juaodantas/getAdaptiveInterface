# Spec — Top-level field `operationalOnboarding` in INSTANT response

## 1. Context

The Cloud Function `getAdaptiveInterface` has an `INSTANT` mode that returns an adaptive recommendation for the Home screen. Currently the response contains `nextStepPrediction`, `sectionAdaptations`, `shortcuts`, `infoRecommendation`, `focus`, etc.

The Flutter Home screen needs a dedicated card — `OperationalOnboardingCard` — that displays a structured, multi-step onboarding message when the user has no active lot with protocol. This card requires its own data contract separate from `infoRecommendation`, because:

- It has a distinct visual layout (steps list, CTA button, priority ordering)
- It must be present **exclusively** when `stepId` is `create_lot_with_protocol` or `test_create_lot_with_protocol`
- It must be server-side deterministic (not subject to Gemini variability)
- It has different validation rules (steps array, priority integer, etc.)

Previously the test sequence spec (`instant-test-sequence-boundaries`) tentatively placed `operational_onboarding` as an `expectedInfoType` inside `infoRecommendation`. This was a stopgap. The current spec supersedes that approach by introducing a separate top-level field.

## 2. Problem statement

- There is no structured field for the Flutter app to render an onboarding card with title, message, steps, CTA and priority.
- Using `infoRecommendation` for this purpose conflates two concerns: informational tips vs. onboarding guidance with a defined step progression.
- The `infoRecommendation` contract (type, source, priority string, category, ctaRoute) does not model a multi-step list or a numeric priority for ordering among other cards.
- The Home screen needs to display `OperationalOnboardingCard` alongside other cards; having it as a flat top-level field with its own priority enables the app to sort and render independently of `infoRecommendation`.

## 3. Goals

- **OO-REQ-001 — Separate top-level field**: `operationalOnboarding` is a nullable top-level field in the INSTANT response, independent of `infoRecommendation`.
- **OO-REQ-002 — Conditional population**: The field is populated **only** when `deriveInstantSignals` returns `stepId === 'create_lot_with_protocol'` or `stepId === 'test_create_lot_with_protocol'` (no active lot with protocol).
- **OO-REQ-003 — Deterministic fallback**: When the stepId matches, the field is built server-side from copy constants, **not** from Gemini output. Gemini may include it, but the finalize step overrides based on stepId (server-side truth wins).
- **OO-REQ-004 — Null when not applicable**: When the stepId does **not** match the above two values, `operationalOnboarding` is `null` in the response.
- **OO-REQ-005 — Validation**: The field must be validated against a dedicated shape with char limits, allowed routes, and integer priority range.
- **OO-REQ-006 — Client capability gating**: The field is only sent if `clientCapabilities.supportedComponents` includes `'OperationalOnboardingCard'`. If not, the field is `null` regardless of stepId.
- **OO-REQ-007 — Non‑breaking addition**: Existing parsers must not break due to the new nullable field. The field is added to the final response keys and sanitized like other top-level fields.

## 4. Non-goals

- Não modificar o contrato existente de `infoRecommendation`.
- Não alterar `deriveInstantSignals` ou as regras de domínio em `instantDomainRules.js` — os stepIds já existem, não precisam de mudança.
- Não alterar o prompt do Gemini para incluir `operationalOnboarding` — o campo é sempre server-side determinístico.
- Não alterar `index.js` (1851 linhas, risco extremo).
- Não adicionar cache para `operationalOnboarding` separadamente — o cache já cobre a resposta INSTANT completa; se a resposta contém ou não o campo depende do `stepId`, que já é parte da chave de cache.
- Não criar endpoint separado ou modo adaptativo novo.

## 5. Contract

### 5.1 Shape

```json
{
  "operationalOnboarding": {
    "title": "Como começar",
    "message": "Crie seu primeiro lote com protocolo para iniciar o acompanhamento.",
    "steps": [
      "Cadastre ou selecione um protocolo",
      "Crie o primeiro lote",
      "Acompanhe as atividades geradas na agenda"
    ],
    "ctaLabel": "Criar primeiro lote",
    "targetRoute": "/lotePage",
    "reason": "Usuário ainda não possui lote ativo com protocolo",
    "priority": 20
  }
}
```

### 5.2 When populated

| Condition | `operationalOnboarding` |
|---|---|
| `stepId === 'create_lot_with_protocol'` | Populated (fallback data) |
| `stepId === 'test_create_lot_with_protocol'` | Populated (fallback data) |
| Any other `stepId` | `null` |
| `clientCapabilities.supportedComponents` does not include `'OperationalOnboardingCard'` | `null` (regardless of stepId) |

### 5.3 Fallback copy constants

When stepId matches, the data is built from these constants (modeled after `STEP_COPY` in `instantFallbackBuilder.js`):

| Field | Value |
|---|---|
| `title` | `"Como começar"` |
| `message` | `"Crie seu primeiro lote com protocolo para iniciar o acompanhamento."` |
| `steps` | `["Cadastre ou selecione um protocolo", "Crie o primeiro lote", "Acompanhe as atividades geradas na agenda"]` |
| `ctaLabel` | `"Criar primeiro lote"` |
| `targetRoute` | signals' `targetRoute` (determined by deriveInstantSignals: `/lotePage` for test, `/protocoloPage` for non-test) |
| `reason` | Domain rule description for `RULE-001` or `RULE-016` |
| `priority` | `20` (integer, lower = shown after higher-priority content) |

### 5.4 When Gemini response contains `operationalOnboarding` for wrong stepId

The normalize step (`normalizeOperationalOnboarding`) should parse and accept it if shape is valid. However, during the finalize step, if `stepId` does NOT match `create_lot_with_protocol` or `test_create_lot_with_protocol`, the field is overridden to `null`. Server-side truth wins.

If `stepId` **does** match but Gemini sent a malformed value, the fallback is used (deterministic).

### 5.5 When `clientCapabilities` lacks `OperationalOnboardingCard`

The field is forced to `null` during sanitization, regardless of stepId match. The fallback building step checks this capability before populating.

## 6. Validation rules

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | yes | non-empty, max 60 chars |
| `message` | string | yes | non-empty, max 120 chars |
| `steps` | array of strings | yes | min 1, max 5 items; each non-empty, max 80 chars per item |
| `ctaLabel` | string | yes | non-empty, max 40 chars |
| `targetRoute` | string | yes | must be in `ALLOWED_INSTANT_ROUTES` |
| `reason` | string | yes | non-empty, max 160 chars |
| `priority` | integer | yes | must be integer between 1 and 100 |

A validation function `validateOperationalOnboarding(value)` returns an array of error strings (empty if valid).

## 7. Architectural approach — New module `src/instantOperationalOnboardingBuilder.js`

### 7.1 Module responsibilities

```js
// instantOperationalOnboardingBuilder.js

function normalizeOperationalOnboarding(raw, signals, clientCapabilities)
```
- Accepts the raw value from Gemini normalization (may be `null`, `undefined`, object, or anything)
- Returns the normalized object or `null`
- If `signals.stepId` matches `create_lot_with_protocol` or `test_create_lot_with_protocol`, uses Gemini value if valid, else builds fallback
- If `signals.stepId` does not match, returns `null`
- If `clientCapabilities.supportedComponents` lacks `'OperationalOnboardingCard'`, returns `null`

```js
function validateOperationalOnboarding(value)
```
- Returns array of error strings (empty = valid)
- Checks all fields per section 6

```js
function buildOperationalOnboardingFallback({ signals })
```
- Deterministically returns the full shape from copy constants
- `targetRoute` derived from `signals.targetRoute`
- `reason` derived from the matching domain rule description

### 7.2 Copy constants in the module

```js
const OPERATIONAL_ONBOARDING_FALLBACK = {
  title: 'Como começar',
  message: 'Crie seu primeiro lote com protocolo para iniciar o acompanhamento.',
  steps: [
    'Cadastre ou selecione um protocolo',
    'Crie o primeiro lote',
    'Acompanhe as atividades geradas na agenda',
  ],
  ctaLabel: 'Criar primeiro lote',
  priority: 20,
};
```

The `targetRoute` and `reason` are derived dynamically:
- `targetRoute` from `signals.targetRoute`
- `reason` from `signals.rulesApplied` mapped to `DOMAIN_RULES` descriptions

### 7.3 Files to touch

| File | Change |
|---|---|
| **NEW:** `src/instantOperationalOnboardingBuilder.js` | Create module |
| `src/adaptiveContract.js` | Add `'OperationalOnboardingCard'` to `DEFAULT_SUPPORTED_COMPONENTS`; optionally add operational onboarding constants |
| `src/instantResponseNormalizer.js` | Import and call `normalizeOperationalOnboarding` in `normalizeInstantResponse`, add `operationalOnboarding` to returned object |
| `src/instantResponseValidator.js` | Add `'operationalOnboarding'` to `FINAL_INSTANT_RESPONSE_KEYS`; add `sanitizeFinalOperationalOnboarding`; add validation in `hasValidFinalNestedContract` (optional — nullable, so validation is lenient); update `finalizeValidInstantResponse` to enforce server-side override |
| `src/instantFallbackBuilder.js` | Import `buildOperationalOnboardingFallback`; populate `operationalOnboarding` in fallback response when stepId matches |

### 7.4 Files NOT to touch

| File | Reason |
|---|---|
| `index.js` | 1851 lines, extreme risk |
| `instantDomainRules.js` | Step IDs already exist; no change needed |
| `instantInfoRecommendationBuilder.js` | Separate concern (302 lines); no change needed |
| `enhancedInstantMode.js` | Implicitly picks up changes via pipeline; no direct modification needed |

### 7.5 Integration flow

```
normalizeInstantResponse(raw, clientCapabilities, signals, operationalContext)
  └─ operationalOnboarding = normalizeOperationalOnboarding(raw.operationalOnboarding, signals, clientCapabilities)

finalizeValidInstantResponse(response, clientCapabilities, signals)
  └─ Override: if stepId doesn't match → null
     else if capabilities lack component → null
     else keep as-is (fallback already applied in normalize)
  └─ Add operationalOnboarding to the returned response

buildEnhancedInstantFallback(...)
  └─ operationalOnboarding = buildOperationalOnboardingFallback({ signals }) or null
```

## 8. Test scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | `stepId = create_lot_with_protocol`, `clientCapabilities` includes `OperationalOnboardingCard` | `operationalOnboarding` populated with fallback data |
| 2 | `stepId = test_create_lot_with_protocol`, `clientCapabilities` includes `OperationalOnboardingCard` | `operationalOnboarding` populated with fallback data |
| 3 | `stepId = create_lot_with_protocol`, `clientCapabilities` does NOT include `OperationalOnboardingCard` | `operationalOnboarding` is `null` |
| 4 | `stepId = check_generated_activities`, `clientCapabilities` includes `OperationalOnboardingCard` | `operationalOnboarding` is `null` |
| 5 | `stepId = test_complete`, `clientCapabilities` includes `OperationalOnboardingCard` | `operationalOnboarding` is `null` |
| 6 | Gemini returns valid `operationalOnboarding` but stepId does not match | Overridden to `null` in finalize |
| 7 | Gemini returns invalid `operationalOnboarding` and stepId matches | Fallback data used instead |
| 8 | Gemini returns no `operationalOnboarding` and stepId matches | Fallback data used |
| 9 | Validation: title empty → error | `validateOperationalOnboarding` returns `['invalid_title']` |
| 10 | Validation: priority = 0 → error | returns `['invalid_priority']` |
| 11 | Validation: priority = 101 → error | returns `['invalid_priority']` |
| 12 | Validation: steps empty array → error | returns `['invalid_steps']` |
| 13 | Validation: targetRoute not in ALLOWED_INSTANT_ROUTES → error | returns `['invalid_target_route']` |
| 14 | Fallback response includes `operationalOnboarding` when stepId matches | Check all fields match expected constants |
| 15 | Fallback response does NOT include `operationalOnboarding` when stepId doesn't match | Field is `null` |

## 9. Acceptance criteria

- **AC-OO-001**: Given an INSTANT request where `deriveInstantSignals` returns `stepId: 'create_lot_with_protocol'` and `clientCapabilities.supportedComponents` includes `'OperationalOnboardingCard'`, the response contains `operationalOnboarding` with the fallback shape defined in 5.3.
- **AC-OO-002**: Given an INSTANT request where `deriveInstantSignals` returns `stepId: 'test_create_lot_with_protocol'` and client capabilities include the component, the response contains `operationalOnboarding` with the fallback shape.
- **AC-OO-003**: Given any other `stepId` (e.g., `check_generated_activities`, `resolve_overdue_tasks`, `test_complete`), the response contains `operationalOnboarding: null`.
- **AC-OO-004**: Given `clientCapabilities.supportedComponents` does not include `'OperationalOnboardingCard'`, the response contains `operationalOnboarding: null` regardless of `stepId`.
- **AC-OO-005**: Given Gemini returns a valid `operationalOnboarding` object for a non-matching stepId, the final response contains `operationalOnboarding: null` (server-side truth wins).
- **AC-OO-006**: Given Gemini returns a malformed `operationalOnboarding` for a matching stepId, the final response uses the deterministic fallback.
- **AC-OO-007**: The `operationalOnboarding` field appears in the final response keys and is sanitized as nullable. Existing responses without the field parse without error.
- **AC-OO-008**: The response passes `finalizeValidInstantResponse` and `sanitizeFinalInstantResponse` without introducing new validation errors.
- **AC-OO-009**: No changes were made to `index.js`, `instantDomainRules.js`, `instantInfoRecommendationBuilder.js`, or `enhancedInstantMode.js`.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| App expects `operationalOnboarding` and it's missing | The field is always present in the response (even if `null`). Existing `null`-tolerant parsers in the app handle it. |
| Priority 20 conflicts with other priorities in the app | Priority is documented as numeric, lower = less prominent. The app is responsible for sorting. 20 was chosen to be above the highest built-in `infoRecommendation` priority (which uses string priorities `low`/`medium`/`high`). |
| Steps list hardcoded in fallback cannot be localized | The copy constants are strings. If i18n is needed, the module can be extended to accept locale or use resource keys. For MVP, static PT-BR strings are acceptable. |
| `OperationalOnboardingCard` not yet implemented in Flutter | The field being `null` is safe. The app should handle the unknown component gracefully (skip rendering). |
| Non-test path `create_lot_with_protocol` also triggers onboarding but has lower confidence | The fallback is identical for both stepIds. The difference is that `test_create_lot_with_protocol` has `confidence: 0.85` vs `create_lot_with_protocol` `confidence: 0.65`. The `operationalOnboarding` itself has no confidence — it's a data card. |

## 11. Observability

| Event | When to emit |
|---|---|
| `operational_onboarding_populated` | When `operationalOnboarding` is populated in the final response |
| `operational_onboarding_suppressed_no_capability` | When stepId matches but `clientCapabilities` lacks the component |
| `operational_onboarding_overridden_from_gemini` | When Gemini provided a value but stepId mismatch caused override to `null` |

## 12. Dependencies

- `deriveInstantSignals` already returns `stepId`, `targetRoute`, `rulesApplied` — no changes needed.
- `clientCapabilities.supportedComponents` must include `'OperationalOnboardingCard'` — this will be added in `adaptiveContract.js`.
- The test sequence spec `.specs/features/instant-test-sequence-boundaries/spec.md` must be updated to remove `expectedInfoType: "operational_onboarding"` and revert to `basic_tip`, and to mark the `OperationalOnboardingCard` risk as resolved (see section 13).

## 13. Changes to existing specs

### 13.1 `.specs/features/instant-test-sequence-boundaries/spec.md`

The following changes must be applied:

1. **Section 5.3 Etapa 1**: Change `expectedInfoType: "operational_onboarding"` to `expectedInfoType: "basic_tip"`.
2. **Section 5.3 Etapa 1**: Remove the observation note about `OperationalOnboardingCard` fallback (lines 103-104).
3. **Section 4 Non-goals**: Remove the line `"Não modificar o contrato público de resposta do INSTANT."` — we are explicitly adding a new field to the contract. Replace it with `"Não alterar campos existentes do contrato INSTANT."`.
4. **Section 12 Riscos**: Mark the risk `OperationalOnboardingCard não existe no contrato/clientCapabilities` as **RESOLVED** — the card now has its own top-level field defined in this spec.
5. **Section 14 Plano de validação**: Remove the line about testing fallback of `OperationalOnboardingCard` to `basic_tip` (line 421) — this is no longer applicable.

### 13.2 `.specs/features/instant-shared-recommendation-cache/spec.md`

No changes needed. The cache key includes `stepId`, so responses with different `operationalOnboarding` states are automatically correctly cached.

## 14. Plano de validação

- Testar `normalizeOperationalOnboarding` com stepId matching → retorna objeto válido
- Testar `normalizeOperationalOnboarding` com stepId não matching → retorna `null`
- Testar `normalizeOperationalOnboarding` sem capability → retorna `null`
- Testar `validateOperationalOnboarding` com shape válido → erros vazio
- Testar `validateOperationalOnboarding` com cada campo inválido → erro específico
- Testar `buildOperationalOnboardingFallback` → shape completo com valores esperados
- Testar integração no normalizer: resposta INSTANT com Gemini contendo o campo → normalizado
- Testar integração no finalizer: overrides aplicados corretamente
- Testar integração no fallback builder: fallback inclui campo quando stepId matching
- Testar que `hasValidFinalNestedContract` não rejeita resposta por causa de `operationalOnboarding: null`
- Testar que `FINAL_INSTANT_RESPONSE_KEYS` inclui `'operationalOnboarding'`

## 15. Referências

- Spec relacionada: `.specs/features/instant-test-sequence-boundaries/spec.md`
- Módulo de contrato: `src/adaptiveContract.js`
- Normalizer: `src/instantResponseNormalizer.js`
- Validador: `src/instantResponseValidator.js`
- Fallback builder: `src/instantFallbackBuilder.js`
- Regras de domínio: `src/instantDomainRules.js`
- Builder de info recommendation: `src/instantInfoRecommendationBuilder.js`
