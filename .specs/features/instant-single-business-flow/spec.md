# Feature Spec: INSTANT Single Business Flow

## Context

The INSTANT API currently contains a dedicated “test sequence” path with `test_*` step IDs, test-only constants, deterministic Gemini bypass behavior, prompt instructions, cache profiling, and copied step definitions. The intended product behavior is no longer a separate test-only mode: the former “test sequence” represents the natural business flow for guiding users through operational setup and follow-up actions.

The frontend originally sent a large `operationalContext` payload that may include `testSequenceSignals`, `infoCardsState`, raw activity/note arrays, bucket summaries, and nested next-activity objects. The frontend now also supports a slimmer payload shape that sends pre-derived operational booleans/counters and optional recent user action metadata. Backend cleanup should remove test-specific decisioning while remaining tolerant of both the old and new payload shapes.

The desired INSTANT flow is:

1. Receive payload.
2. Normalize/extract key operational information.
3. Compare extracted facts with business rules.
4. Build Gemini prompt from the selected business step and context.
5. Normalize and validate Gemini response.
6. Use deterministic fallback when Gemini output is invalid or unavailable.

This feature exists to make INSTANT easier to maintain, make business rules easier to understand, and remove duplicated behavior that treats real business flow as test-only behavior.

## Problem Statement

The current backend mixes business rules with test-sequence mechanics. This creates several issues:

- `testSequenceSignals` can override real operational state and route the user through `test_*` steps.
- `test_*` constants and copied step definitions duplicate the core business flow.
- Gemini can be bypassed for test sequence scenarios, making behavior inconsistent with the standard INSTANT pipeline.
- Prompt and cache logic contain test-specific concepts that obscure the actual domain rules.
- Info recommendation fallback mappings can point to routes/types that do not align with the core business step being recommended.

## Goals

- Use one INSTANT decision path for all users and sessions.
- Treat the previous test-sequence behavior as normal business flow, expressed with non-`test_*` step IDs.
- Stop using `testSequenceSignals` for backend decisioning in Phase 1.
- Keep accepting current frontend payloads without requiring frontend changes.
- Remove or stop exporting safe test-specific constants, copied steps, prompt instructions, and cache sequence profiling in Phase 1.
- Ensure Gemini is called through the same prompt/normalize/validate/fallback pipeline for former test-sequence cases.
- Make business rule priority explicit and testable.
- Correct the Home information surface mapping for the core business steps, including `operationalOnboarding` as the primary card for initial lot/protocol setup when supported.
- Accept the Phase 1.1 slim frontend payload without requiring legacy-only fields.
- Normalize cheap and safe legacy aliases at the API boundary while internally preferring the slim normalized field names.
- Align the next phase with the exact five Home sequence expected by users, including route, FocusBanner, shortcuts, and primary Home info.
- Allow sanitized `recentUserActions` to aid natural-flow transition decisions without making it required.
- Preserve critical alerts and overdue tasks as higher-priority interruptions over the natural five-step flow.

## Non-Goals

- No frontend implementation in this phase.
- No broad rewrite of `operationalContextValidator` in this phase.
- No file deletion in Phase 1.
- No requirement that `lastAction` or last effective action exists in the payload yet.
- No database schema change.
- No API contract breaking change for current clients.
- No redesign of unrelated recommendation, metrics, or route distribution behavior.
- No requirement that `lastAction` or `recentUserActions` exists in the payload, even when `recentUserActions` is used as an optional decision aid in the next phase.
- No forwarding of free-text `recentUserActions.entityName` values to Gemini.

## Technical Approach and Design Decisions

### Desired Architecture

INSTANT should have a single business-rule-driven path:

```text
request payload
  -> normalizeOperationalContext
  -> extract/derive business facts
  -> deriveInstantSignals via ordered business rules
  -> buildInstantPrompt
  -> call Gemini
  -> normalizeInstantResponse
  -> validate normalized response
  -> deterministic fallback when needed
```

Design decisions:

- Step IDs must represent domain/business steps, not execution mode. No `test_*` step IDs should be produced by the main backend flow.
- `testSequenceSignals` must be tolerated as legacy input but ignored for business decisioning in Phase 1.
- Former deterministic test-sequence behavior should become fallback/business-rule behavior, not a separate Gemini bypass.
- Gemini should not be bypassed solely because a request resembles the previous test sequence.
- Cache profiles should key business context and selected step, not a test sequence stage.
- Prompt instructions should describe business rules and allowed output, not test-sequence instructions.

### Phase 1 Scope

Backend-only cleanup:

- Ignore `operationalContext.testSequenceSignals` when deriving step decisions.
- Keep accepting `testSequenceSignals` in the normalized payload for compatibility, but mark it deprecated in spec and avoid using it for decisioning.
- Remove or stop using/exporting `test_*` constants where safe:
  - `RULE_IDS.TEST_*` entries.
  - `TEST_SEQUENCE_SHORTCUTS`.
  - `TEST_SEQUENCE_STEPS`.
  - `resolveTestSequenceStep`.
  - `test_*` step copies in fallback and domain rules.
  - Prompt instructions that mention test sequence handling.
  - Cache `sequenceStage` profile derived from `testSequenceSignals`, if no active callers depend on it.
- Remove Gemini bypass logic for test sequence and route all requests through the normal prompt pipeline.
- Fix Home information surface mappings for the core business steps listed below, including the `operationalOnboarding` primary card for initial setup when supported.
- Keep `infoCardsState` optional; use it only as a supplemental signal when present.
- Do not delete source files in Phase 1.

### Phase 2 Deferred Scope

After the frontend starts sending last effective action information:

- Add an optional `lastAction` contract or equivalent last effective action field.
- Use `lastAction` to disambiguate transitions that are currently inferred from dashboard/agenda/notebook state.
- Consider deprecating `testSequenceSignals` at the API documentation level after all active clients stop sending it.
- Revisit validator structure only if the new contract requires clearer boundaries.

### Next Phase Scope: Natural 5-Home Flow with Optional Recent Action Aid

Backend decisioning should align the natural business flow with the user's expected five Home states. `recentUserActions` may now be used as an optional decision aid to disambiguate transitions, but it must not become required for valid requests or for reaching the flow through equivalent state facts.

Scope updates:

- Keep critical alerts and overdue tasks as higher-priority operational interruptions. They may temporarily supersede the natural five-step flow because they represent urgent work.
- Use normalized state facts first, with `recentUserActions` as supporting evidence when present.
- Do not require `recentUserActions`; requests without it must continue to follow the best state-derived business step.
- Do not allow generic `review_today_tasks` to mask a more specific natural-flow step when recent action/state matches `check_generated_activities`, `record_caderno_adjustment`, `finish_agenda_activities`, or `review_final_home`.
- Keep `recentUserActions.entityName` out of Gemini prompt content.
- Align the step target, FocusBanner copy, shortcuts, and Home information type with the exact five-step sequence below.

### Phase 1.1 Payload Compatibility Scope

Backend-only compatibility update for the new slim frontend payload:

- Accept the slim payload fields listed in this spec without requiring removed legacy-only structures.
- Normalize old field names to the slim internal names where the mapping is cheap, deterministic, and safe.
- Prefer slim normalized names internally going forward:
  - `pendingToday`
  - `overdueCount`
  - `lastAgendaInteraction`
  - `hasRecentNotes`
  - `hasNutritionAdjustmentRecord`
  - `hasSowingNote`
  - `culturesCount`
  - `speciesInProgressCount`
  - `recentUserActions`
- Treat `recentUserActions` as optional, sanitized context only. It must not be required and must not be decisive for selecting a business step in Phase 1.1.
- In the next phase, `recentUserActions` may be used as an optional decision aid for natural-flow disambiguation, while remaining non-required.
- If `recentUserActions` is included in a Gemini prompt, include only sanitized aggregate/count/type/action/timestamp data. Do not send `entityName` because it can contain PII or domain free text.
- Continue tolerating removed legacy payload fields when present, but do not require them:
  - `testSequenceSignals`
  - `infoCardsState`
  - raw `latestTasks` / `latestNotes` arrays
  - `dueBuckets`
  - `priorityBuckets`
  - nested `nextActivity` object
  - `completedActivitiesTodayCount`

## Data Structures and Interfaces Involved

### Request Payload Compatibility

Relevant payload fields after Phase 1.1:

| Field | Phase 1 behavior |
| --- | --- |
| `operationalContext` | Required as today by existing route behavior; normalized before decisioning. |
| `operationalContext.testSequenceSignals` | Accepted but ignored for step decisioning; deprecated legacy field. |
| `operationalContext.infoCardsState` | Optional legacy field; not required for valid requests. May be used as supplemental business context when present. |
| `operationalContext.dashboardState` | Primary source for active lot/protocol signals. Slim fields: `hasActiveLots`, `hasProtocolLinkedToLatestLot`, `hasUpcomingHarvests`. |
| `operationalContext.agendaState` | Primary source for generated, pending, overdue, today, and activity follow-up signals. Slim fields: `hasGeneratedActivities`, `pendingToday`, `overdueCount`, `hasOverdue`, `nextActivityType`, `nextActivityStatus`, `nextActivityDueLabel`, `nextActivityOverdue`, `hasProtocolTasks`, `lastAgendaInteraction`. |
| `operationalContext.fieldNotebookState` | Primary source for field note and adjustment signals. Slim fields: `hasRecentNotes`, `hasNutritionAdjustmentRecord`, `totalRecentNotes`, `hasSowingNote`. |
| `operationalContext.reservoirState` | Source for reservoir/solution attention signals; mostly unchanged in the slim payload. |
| `operationalContext.productionState` | Source for production context signals; mostly unchanged in the slim payload. |
| `operationalContext.cultivationState` | Source for cultivation context signals. Slim fields: `culturesCount`, `speciesInProgressCount`. |
| `operationalContext.teamState` | Source for team context signals. |
| `operationalContext.alertState` | Source for critical alert signals. |
| `operationalContext.recentUserActions` | Optional slim payload array of recent user actions; sanitized at the boundary, non-decisive in Phase 1.1, and allowed as an optional natural-flow decision aid in the next phase. |
| Future `lastAction` / last effective action | Not required in Phase 1; optional contract candidate for Phase 2. |

### Slim Payload Shape

The backend should accept this slim shape in addition to the existing broader payload:

```text
{
  operationalContext: {
    dashboardState: {
      hasActiveLots: boolean,
      hasProtocolLinkedToLatestLot: boolean,
      hasUpcomingHarvests: boolean
    },
    agendaState: {
      hasGeneratedActivities: boolean,
      pendingToday: number,
      overdueCount: number,
      hasOverdue: boolean,
      nextActivityType?: string,
      nextActivityStatus?: string,
      nextActivityDueLabel?: string,
      nextActivityOverdue?: boolean,
      hasProtocolTasks: boolean,
      lastAgendaInteraction?: string
    },
    fieldNotebookState: {
      hasRecentNotes: boolean,
      hasNutritionAdjustmentRecord: boolean,
      totalRecentNotes: number,
      hasSowingNote: boolean
    },
    reservoirState: object,
    productionState: object,
    teamState: object,
    alertState: object,
    cultivationState: {
      culturesCount: number,
      speciesInProgressCount: number
    },
    recentUserActions?: Array<{
      entityType: string,
      action: string,
      entityId?: string,
      entityName?: string,
      timestamp: string
    }>
  }
}
```

### Boundary Normalization Rules

Normalize aliases at the boundary so downstream business rules use slim names:

| Normalized field | Preferred source | Legacy tolerance |
| --- | --- | --- |
| `agendaState.pendingToday` | `pendingToday` | Map from old today/pending counters when available and unambiguous. |
| `agendaState.overdueCount` | `overdueCount` | Map from old overdue counters or bucket totals when cheap/safe. |
| `agendaState.hasOverdue` | `hasOverdue` | Derive from `overdueCount > 0` if missing. |
| `agendaState.lastAgendaInteraction` | `lastAgendaInteraction` | Preserve old equivalent interaction field only if already present and clearly equivalent. |
| `fieldNotebookState.hasRecentNotes` | `hasRecentNotes` | Derive from old recent note arrays/counts when present. |
| `fieldNotebookState.hasNutritionAdjustmentRecord` | `hasNutritionAdjustmentRecord` | Map from old adjustment/nutrition flags when clearly equivalent. |
| `fieldNotebookState.hasSowingNote` | `hasSowingNote` | Map from old sowing note flags when clearly equivalent. |
| `cultivationState.culturesCount` | `culturesCount` | Map from old culture count fields when present. |
| `cultivationState.speciesInProgressCount` | `speciesInProgressCount` | Map from old species-in-progress counters when present. |
| `recentUserActions` | `recentUserActions` | No legacy requirement; absence is valid. |

Removed legacy-only structures must not be required for valid requests. If present, they may be used only as fallback alias sources where the mapping is deterministic and does not reintroduce test-sequence decisioning.

### `recentUserActions` Sanitization Contract

`recentUserActions` is optional context for transition disambiguation. In Phase 1.1 it is sanitized context only; in the next phase it may also aid natural-flow step selection when consistent with state facts.

- Validate each item at the API boundary.
- Keep only bounded, expected primitive fields.
- Treat `entityId` as optional and avoid including it in Gemini prompts unless there is an explicit non-PII use case.
- Do not include `entityName` in Gemini prompts.
- Prompt context, if any, should be reduced to sanitized counts and non-free-text dimensions such as action type, entity type, and timestamp recency.
- Do not require `recentUserActions` or a separate `lastAction` field for request validity.
- When used as a decision aid, only use sanitized dimensions such as `entityType`, `action`, and timestamp recency.
- Do not let recent action evidence override higher-priority critical alerts or overdue tasks.

### Business Step Output Shape

`deriveInstantSignals` should continue returning an object compatible with existing downstream code:

```text
{
  stepId: string,
  targetRoute: string,
  dashboardId: string,
  rulesApplied: string[],
  shortcuts: Shortcut[]
}
```

Phase 1 constraint: `stepId` must not start with `test_`.

## Business Rule Priority Order and Expected Step Outcomes

The single flow should evaluate business rules in this order. Earlier rules win over later rules. Critical alerts and overdue tasks remain explicit higher-priority operational interruptions because they represent urgent work that should temporarily supersede the natural onboarding/protocol flow.

The former test sequence is not a separate mode. The five-step sequence below is the natural business flow when operational state matches:

1. `create_lot_with_protocol`
2. `check_generated_activities`
3. `record_caderno_adjustment`
4. `finish_agenda_activities`
5. `review_final_home`

These steps should be selected by normal business facts from the normalized `operationalContext`, not by `testSequenceSignals`.

| Priority | Business condition | Expected `stepId` | `targetRoute` | Primary rule |
| --- | --- | --- | --- | --- |
| 1 | Critical operational alerts exist | `review_critical_alerts` | `/agendaPage` | `CRITICAL_ALERTS` |
| 2 | Overdue tasks exist | `resolve_overdue_tasks` | `/agendaPage` | `OVERDUE_TASKS` |
| 3 | Lot/protocol was just created and generated activities exist | `check_generated_activities` | `/agendaPage` | `CHECK_GENERATED_ACTIVITIES` |
| 4 | Agenda activity was viewed/edited/opened, or agenda was viewed, and no nutrition adjustment record exists | `record_caderno_adjustment` | `/cadernoCampoPage` | `RECORD_CADERNO_ADJUSTMENT` |
| 5 | Field note or nutrition adjustment was created and today agenda activities remain pending | `finish_agenda_activities` | `/agendaPage` | `FINISH_AGENDA_ACTIVITIES` |
| 6 | Agenda activity was completed, or `lastAgendaInteraction` indicates completion | `review_final_home` | `/lotePage` | `REVIEW_FINAL_HOME` |
| 7 | No lot with protocol exists, or no stronger state/recent-action signal exists | `create_lot_with_protocol` | `/lotePage` | `NO_PROTOCOL_LOT` |
| 8 | Lot with protocol exists and generated activities exist, but no agenda-check signal exists yet | `check_generated_activities` | `/agendaPage` | `CHECK_GENERATED_ACTIVITIES` |
| 9 | Generated activities exist or have been checked, but nutrition adjustment is not recorded | `record_caderno_adjustment` | `/cadernoCampoPage` | `RECORD_CADERNO_ADJUSTMENT` |
| 10 | Nutrition adjustment is recorded and agenda activities remain pending | `finish_agenda_activities` | `/agendaPage` | `FINISH_AGENDA_ACTIVITIES` |
| 11 | Agenda activities are complete and final review is still needed | `review_final_home` | `/lotePage` | `REVIEW_FINAL_HOME` |
| 12 | Today tasks or next pending task exist, but they do not match a more specific natural-flow step | `review_today_tasks` | `/agendaPage` | `TODAY_TASKS` |
| 13 | Recent field notebook signal exists outside the natural-flow adjustment path | `review_field_notes` | `/cadernoCampoPage` | `FIELD_NOTEBOOK` |
| 14 | Reservoir or nutrient solution attention signal exists | `review_reservoirs` | `/reservatoriosPage` | `RESERVOIR_ATTENTION` |
| 15 | Production/cultivation context exists | `review_production` | `/relatoriosPage` | `PRODUCTION_CONTEXT` |
| 16 | Team context exists | `review_team` | `/gerenciarEquipePage` | `TEAM_CONTEXT` |
| 17 | Default safe onboarding when no stronger signal exists | `create_lot_with_protocol` | `/lotePage` | `NO_PROTOCOL_LOT` or `AVOID_EMPTY_PRODUCTION` |

Notes:

- No terminal `test_complete` step should remain in the single business flow.
- If a terminal/completed state is needed later, it should receive a non-test domain name such as `review_operational_summary`, but this is not required for Phase 1 unless existing behavior needs a replacement.
- The final priority order should be implemented in one business-rule function/module to avoid duplicated step definitions.
- `review_today_tasks` must remain a generic fallback for agenda work and must not mask the specific natural-flow steps when state or sanitized recent action evidence matches them.

### Optional `recentUserActions` Decision Aid Examples

The backend may use the following sanitized recent action patterns as supporting evidence for natural-flow transitions:

| Sanitized recent action/state pattern | Supported natural-flow step |
| --- | --- |
| Lot created and generated activities exist | `check_generated_activities` |
| Agenda activity viewed, edited, or opened; or agenda viewed; and no nutrition adjustment record exists | `record_caderno_adjustment` |
| Field note or nutrition adjustment created and `agendaState.pendingToday > 0` | `finish_agenda_activities` |
| Agenda activity completed, or `agendaState.lastAgendaInteraction` indicates completion | `review_final_home` |

These patterns are aids, not hard requirements. Equivalent normalized state facts must still be able to select the same natural-flow step when recent actions are absent.

## Correct Home Information Mapping Table

Home information surfaces for the natural business flow should align with the desired user sequence, not the legacy test-sequence mapping. When `operationalOnboarding` is supported for `create_lot_with_protocol`, it is the primary visible information card. In that case, `infoRecommendation` may still be returned as a compatibility/fallback object, but it must not create an extra competing visible card if the frontend renders `operationalOnboarding`.

### Natural Business Flow

| Sequence | User state | Step ID | Target route | FocusBanner | Shortcuts | Primary Home info |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Initial home | `create_lot_with_protocol` | `/lotePage` | `Comece criando seu primeiro lote` | [`/lotePage`, `/protocoloPage`, `/areaCultivoPage`] | `operationalOnboarding` primary |
| 2 | After creating lot/protocol | `check_generated_activities` | `/agendaPage` | `Confira a Agenda antes de seguir.` | [`/agendaPage`, `/lotePage`, `/cadernoCampoPage`] | `today_cultivation` |
| 3 | After checking agenda | `record_caderno_adjustment` | `/cadernoCampoPage` | `Caderno de campo - Registrar atividade` | [`/cadernoCampoPage`, `/agendaPage`, `/lotePage`] | `today_cultivation` |
| 4 | After recording field notebook/pulverização | `finish_agenda_activities` | `/agendaPage` | `Concluir na Agenda` | [`/agendaPage`, `/cadernoCampoPage`, `/lotePage`] | `field_notes_summary` |
| 5 | After completing agenda activities | `review_final_home` | `/lotePage` | `Revisar Agenda - lote segue em acompanhamento` | [`/lotePage`, `/cadernoCampoPage`, `/agendaPage`] | `basic_tip` |

Compatibility notes:

- For `create_lot_with_protocol`, `operationalOnboarding` is the primary visible Home surface. A compatibility/fallback `basic_tip` may still exist, but it must not create an extra competing visible card when `operationalOnboarding` is rendered.
- Step targets, FocusBanner copy, shortcuts, and info type must match this table exactly for the five natural-flow homes.

### Other Operational Steps

The mappings below remain fallback guidance for operational interruptions and contextual recommendations outside the five-step natural business flow.

| Step ID | Rule ID | Type | Category | Source | Priority | CTA route |
| --- | --- | --- | --- | --- | --- | --- |
| `review_protocol_tasks` | `CHECK_GENERATED_ACTIVITIES` | `day_progress` | `agenda` | `isis` | `high` | `/agendaPage` |
| `review_field_notes` | `FIELD_NOTEBOOK` | `field_notes_summary` | `caderno_campo` | `isis` | `medium` | `/cadernoCampoPage` |
| `review_today_tasks` | `TODAY_TASKS` | `today_cultivation` | `agenda` | `isis` | `high` | `/agendaPage` |
| `resolve_overdue_tasks` | `OVERDUE_TASKS` | `day_progress` | `agenda` | `isis` | `high` | `/agendaPage` |
| `review_critical_alerts` | `CRITICAL_ALERTS` | `basic_tip` | `agenda` | `fallback` | `high` | `/agendaPage` |
| `review_reservoirs` | `RESERVOIR_ATTENTION` | `reservoir_report` | `reservatorio` | `isis` | `medium` | `/reservatoriosPage` |
| `review_production` | `PRODUCTION_CONTEXT` | `today_cultivation` | `cultivo` | `isis` | `medium` | `/relatoriosPage` |
| `review_team` | `TEAM_CONTEXT` | `day_progress` | `agenda` | `local_tip` | `low` | `/agendaPage` |

## Files Likely Touched and Boundaries

Likely touched in Phase 1:

- `src/instantDomainRules.js`
  - Remove test-sequence decisioning and `test_*` exports where safe.
  - Keep one ordered business-rule derivation path.
- `src/enhancedInstantMode.js`
  - Remove `isTestSequence` branch and Gemini bypass behavior.
  - Keep normal fallback behavior for invalid Gemini responses.
- `src/instantPromptBuilder.js`
  - Remove test-sequence prompt instructions and avoid including legacy test signals as decisioning guidance.
- `src/instantInfoRecommendationBuilder.js`
  - Correct info recommendation mappings for core business steps.
  - Remove route conflict special casing for `test_*` if present.
- `src/instantFallbackBuilder.js`
  - Remove `test_*` step copy and fallback copy.
  - Ensure fallback uses non-test business step IDs only.
- `src/instantOperationalOnboardingBuilder.js`
  - Remove `test_create_lot_with_protocol` from onboarding eligibility if still present.
- `src/operationalContextValidator.js`
  - Keep compatibility normalization for `testSequenceSignals`; do not broadly rewrite.
- `src/instantRecommendationCache.js`
  - Remove test sequence profile/stage derivation if safe.
- `src/instantRecommendationCacheFirestoreAdapter.js`
  - Touch only if cache key shape/metadata changes require adapter alignment.

Boundaries:

- Do not delete files in Phase 1.
- Do not modify frontend code.
- Do not introduce a new validator architecture.
- Do not change public payload requirements except documenting legacy deprecation.
- Keep fallback and response validation contracts compatible with existing clients.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing frontend still sends `testSequenceSignals`. | Keep accepting the field in normalization; ignore it for decisioning. |
| Removing `test_*` step IDs may break tests or clients asserting exact IDs. | Update backend tests/fixtures to assert business step IDs; do not change response shape beyond step IDs. |
| Cache hits may reuse old test-sequence responses. | Remove test sequence stage from new cache profiles and consider cache version bump if stale cache responses can contain `test_*` IDs. |
| Gemini output may still produce `test_*` IDs from old prompt wording. | Remove test-sequence prompt instructions and reject/normalize invalid `test_*` step IDs during response validation/fallback. |
| Business rule order may change observed recommendations. | Encode priority table in tests and document intentional precedence. |
| `infoCardsState` may be absent in current or older payloads. | Treat as optional supplemental context; never require it for core decisions. |
| Phase 1 lacks `lastAction`, so some transitions remain inferred. | Use dashboard/agenda/notebook signals as current source of truth; defer last-action refinement to Phase 2. |
| New slim payload omits arrays/buckets previously used by backend logic. | Normalize slim booleans/counters as the preferred internal source and keep legacy aliases only as fallback inputs. |
| `recentUserActions.entityName` may contain PII or domain free text. | Sanitize at the boundary and never send `entityName` to Gemini. |
| Optional recent action context could accidentally become a hidden requirement. | Add validation coverage proving requests without `recentUserActions` and without `lastAction` remain valid. |
| Generic agenda rules could mask the natural five-step flow. | Keep `review_today_tasks` below specific natural-flow matches and test the recent-action/state examples explicitly. |

## Acceptance Criteria

- Requests containing `operationalContext.testSequenceSignals` no longer produce any `stepId` beginning with `test_`.
- Requests containing `operationalContext.testSequenceSignals` still parse successfully when the rest of the payload is valid.
- INSTANT does not bypass Gemini solely because legacy test sequence fields are present.
- The normal flow remains: normalize context, derive business signals, build prompt, call Gemini, normalize/validate response, fallback if needed.
- `test_*` constants, step copies, prompt instructions, cache sequence profiles, and exports are removed or unused where safe in Phase 1.
- Home information surface mappings match the natural business flow table in this spec, including `operationalOnboarding` as primary for `create_lot_with_protocol` when supported.
- The `create_lot_with_protocol` compatibility/fallback `basic_tip` does not create an extra visible competing info card when `operationalOnboarding` is rendered.
- `infoCardsState` is not required for a valid request.
- `lastAction` is not required in Phase 1.
- The Phase 1.1 slim frontend payload is accepted when it includes `dashboardState`, `agendaState`, `fieldNotebookState`, `reservoirState`, `productionState`, `teamState`, `alertState`, `cultivationState`, and omits legacy-only fields.
- Removed legacy-only frontend fields are not required for request validity: `testSequenceSignals`, `infoCardsState`, raw `latestTasks` / `latestNotes` arrays, `dueBuckets`, `priorityBuckets`, nested `nextActivity`, and `completedActivitiesTodayCount`.
- Boundary normalization exposes slim internal names for downstream logic: `pendingToday`, `overdueCount`, `lastAgendaInteraction`, `hasRecentNotes`, `hasNutritionAdjustmentRecord`, `hasSowingNote`, `culturesCount`, `speciesInProgressCount`, and `recentUserActions`.
- Old aliases for the slim fields are tolerated where mapping is cheap, deterministic, and safe.
- Requests without `recentUserActions` parse successfully.
- Requests without `lastAction` parse successfully.
- `recentUserActions` entries are normalized/sanitized when present, but do not decide the selected business step in Phase 1.1.
- In the next phase, sanitized `recentUserActions` may aid natural-flow step selection but are not required.
- Gemini prompt context does not include `recentUserActions.entityName`.
- Critical alerts and overdue tasks remain higher-priority interruptions than the natural five-step flow.
- `review_today_tasks` is selected only when no more specific natural-flow step matches the normalized state or sanitized recent action evidence.
- The five natural-flow homes match the exact target routes, FocusBanner copy, shortcuts, and primary Home info types listed in the Natural Business Flow table.
- No source files are deleted in Phase 1.
- Existing response shape remains compatible for downstream consumers.
- Tests or validation fixtures cover at least:
  - legacy payload with `testSequenceSignals.lotWithProtocolCreated = false` maps to `create_lot_with_protocol`, not `test_create_lot_with_protocol`;
  - generated activities seen without adjustment maps to `record_caderno_adjustment` or the chosen caderno business step;
  - completed agenda state maps to `review_final_home` when final review is needed;
  - legacy test fields do not trigger Gemini bypass;
  - fallback response never emits `test_*` step IDs;
  - slim payload with `agendaState.pendingToday` and `agendaState.overdueCount` drives the same business facts as equivalent legacy aliases;
  - slim payload with `fieldNotebookState.hasRecentNotes`, `hasNutritionAdjustmentRecord`, and `hasSowingNote` is accepted without raw `latestNotes`;
  - slim payload with `cultivationState.culturesCount` and `speciesInProgressCount` is accepted without old cultivation counters;
  - `recentUserActions` with `entityName` is accepted only after sanitization and does not leak `entityName` into prompt content;
  - payloads that omit both `lastAction` and `recentUserActions` remain valid;
  - lot created plus generated activities selects `check_generated_activities` instead of generic `review_today_tasks`;
  - agenda viewed/opened/edited with no nutrition adjustment record selects `record_caderno_adjustment`;
  - field note or nutrition adjustment created with `pendingToday > 0` selects `finish_agenda_activities`;
  - completed agenda activity or completed `lastAgendaInteraction` selects `review_final_home`;
  - critical alerts and overdue tasks interrupt the natural-flow step when present.

## Validation Plan

- Run the existing automated test suite for INSTANT-related modules, if available.
- Add or update unit tests around `deriveInstantSignals` for the priority table.
- Add or update tests for `buildInfoRecommendationFallback` mappings.
- Add or update route-level tests for legacy payload compatibility.
- Add or update route-level tests for Phase 1.1 slim payload compatibility.
- Add or update normalization tests proving old aliases map to slim internal names where cheap/safe.
- Add or update prompt-builder tests proving `recentUserActions.entityName` is excluded from Gemini prompt content.
- Add or update validation tests proving `recentUserActions` and `lastAction` are optional.
- Add or update prompt/fallback tests to assert no `test_*` step IDs or test-sequence instructions are emitted.
- Run existing lint/typecheck/test commands identified in `package.json` before implementation completion.

## Open Questions

- Should the field-note priority use `review_field_notes` or `record_caderno_adjustment` as the canonical step when generated activities have been seen but no adjustment exists?
- Should a completed operational flow have a non-test terminal step such as `review_operational_summary`, or should it continue to fall back to `review_final_home` / general business context?
- Should the cache prompt version be bumped when removing test sequence profiles to prevent stale cached `test_*` responses?
- Which backend tests currently assert `test_*` step IDs and need fixture migration?
- What exact shape should Phase 2 `lastAction` use once the frontend is ready?
- Which legacy aliases already exist in production payloads for `pendingToday`, `overdueCount`, field notebook adjustment flags, and cultivation counters?
- Should `recentUserActions.timestamp` be validated as ISO datetime only, or should the backend tolerate existing non-ISO frontend labels during Phase 1.1?

## Decision Note Guidance

Create a decision record under `.specs/decisions/` only if implementation introduces a significant tradeoff, such as:

- changing cache key/version semantics;
- choosing a new canonical terminal business step;
- changing public API response contracts;
- introducing a new `lastAction` contract;
- materially reordering business rule precedence beyond the table above.

Do not create a decision record for straightforward removal of dead test-sequence branches, mapping corrections, or compatibility-only cleanup.
