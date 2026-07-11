# Feature Spec: Operational Onboarding Info Slot for Initial INSTANT Step

## Context

INSTANT mode returns Home guidance payloads that can include both `infoRecommendation` and `operationalOnboarding`. For the initial natural-flow step, `create_lot_with_protocol`, the intended primary Home information surface is the operational onboarding card, not the generic info recommendation card.

This adjustment exists to make the response contract unambiguous for the frontend: when onboarding content exists for the initial lot/protocol creation step, `operationalOnboarding` occupies the info-card slot and `infoRecommendation` is intentionally absent for that step only.

This is a contract-changing feature because it changes the response payload semantics for `infoRecommendation` in one INSTANT step.

## Goals

- REQ-001: In INSTANT mode, when `stepId` is `create_lot_with_protocol` and `operationalOnboarding` exists, return `operationalOnboarding` as the info-card payload.
- REQ-002: Set `infoRecommendation` to `null` only for `create_lot_with_protocol` when `operationalOnboarding` exists.
- REQ-003: Preserve existing `infoRecommendation` behavior for all other steps and for `create_lot_with_protocol` when onboarding does not exist.
- REQ-004: Ensure the visible recommended-actions block does not duplicate the primary create-lot action.
- REQ-005: For this onboarding state, expose exactly three visible recommended actions total: one primary `nextStepPrediction` / `NextStepCard` create-lot action plus two secondary shortcuts after removing the duplicated create-lot shortcut.
- REQ-006: Set `operationalOnboarding.targetRoute` to `/areaCultivoPage`.

## Non-Goals

- No implementation code in this spec task.
- No broad redesign of INSTANT decisioning, Gemini prompting, cache behavior, or step priority.
- No frontend implementation.
- No database schema change.
- No change to unrelated steps' routes, banners, recommendations, or shortcut counts.
- No removal of legacy response fields beyond the specified conditional `infoRecommendation: null` behavior.

## Technical Approach and Design Decisions

### Response composition rule

When building the INSTANT response, response composition should treat `operationalOnboarding` as the primary info-card payload only under this exact condition:

```text
mode == INSTANT
AND stepId == create_lot_with_protocol
AND operationalOnboarding exists
```

Under that condition:

- `operationalOnboarding` remains present and is the payload the frontend should render in the info-card slot.
- `infoRecommendation` is returned as `null` to avoid a second competing info card.
- `operationalOnboarding.targetRoute` is `/areaCultivoPage`.
- The visible recommended-actions block contains exactly three total actions: the primary create-lot action from `nextStepPrediction` / `NextStepCard`, plus two secondary shortcuts.
- Secondary shortcuts exclude any duplicated create-lot shortcut by action ID, route, or equivalent create-lot intent.

For every other condition, `infoRecommendation` should retain the existing contract and should not be nulled by this feature.

### Design decisions

- Use a narrow conditional contract change instead of globally replacing `infoRecommendation` with `operationalOnboarding`.
- Make `null` explicit rather than omitting `infoRecommendation`, preserving response shape while signaling intentional absence.
- Treat visible recommended-action de-duplication as part of response assembly for the initial step, not as a global shortcut filtering rule.

## Data Structures or Interfaces Involved

### INSTANT response fields

Relevant response fields:

```text
{
  mode: "INSTANT",
  stepId: "create_lot_with_protocol",
  infoRecommendation: InfoRecommendation | null,
  operationalOnboarding?: OperationalOnboarding,
  nextStepPrediction?: NextStepPrediction,
  shortcuts?: Shortcut[]
}
```

### Conditional field semantics

| Field | Required behavior for `create_lot_with_protocol` when onboarding exists |
| --- | --- |
| `operationalOnboarding` | Present and used as the info-card payload. |
| `operationalOnboarding.targetRoute` | Exactly `/areaCultivoPage`. |
| `infoRecommendation` | Exactly `null`. |
| `nextStepPrediction` / `NextStepCard` | Provides the one primary create-lot action in the visible recommended-actions block. |
| `shortcuts` or equivalent secondary actions collection | Provides exactly two secondary shortcuts after removing any duplicated create-lot shortcut. |

### Primary action definition

For this feature, the primary action is the main create-lot action associated with the `create_lot_with_protocol` step and rendered through `nextStepPrediction` / `NextStepCard`. Secondary shortcuts must not contain that same action by ID, route, or equivalent create-lot intent. This spec does not introduce `operationalOnboarding.recommendedActions`, because the current contract does not contain that field.

## Acceptance Criteria

- AC-001 / REQ-001: Given an INSTANT response for `stepId = create_lot_with_protocol` with an available onboarding payload, the response includes `operationalOnboarding` and the frontend can use it as the info-card payload.
- AC-002 / REQ-002: Given the same condition, `infoRecommendation` is exactly `null`.
- AC-003 / REQ-003: Given any INSTANT response where `stepId != create_lot_with_protocol`, this feature does not set `infoRecommendation` to `null` because onboarding exists.
- AC-004 / REQ-003: Given `stepId = create_lot_with_protocol` but no onboarding payload is available, existing `infoRecommendation` fallback behavior is preserved.
- AC-005 / REQ-004: Given the visible recommended-actions block for this step, no secondary shortcut duplicates the primary create-lot action by action ID, route, or equivalent create-lot intent.
- AC-006 / REQ-005: Given the visible recommended-actions block for this step, it contains exactly three actions total: one primary `nextStepPrediction` / `NextStepCard` create-lot action and two secondary shortcuts.
- AC-007 / REQ-006: Given onboarding for this step, `operationalOnboarding.targetRoute` is exactly `/areaCultivoPage`.
- AC-008 / REQ-001,REQ-002: Response validation or tests cover the contract-changing case so future changes do not reintroduce simultaneous visible `infoRecommendation` and `operationalOnboarding` cards for this step.
- AC-009 / REQ-005: The response contract does not add or require `operationalOnboarding.recommendedActions`.

## Resolved Questions and Decisions

- RQ-001 / REQ-004: The duplicated create-lot shortcut is the existing `create_lot_with_protocol` shortcut with route `/lotePage` and label/intent `Criar primeiro lote`. It is duplicated because `nextStepPrediction` / `NextStepCard` already owns the primary create-lot action for this state.
- RQ-002 / REQ-005: The canonical secondary shortcuts are the existing non-primary `create_lot_with_protocol` shortcuts `/protocoloPage` and `/areaCultivoPage`, preserved in their current order.
- RQ-003 / REQ-001,REQ-002: No frontend documentation update is in scope for this backend repository unless an existing frontend contract document is present. No existing frontend contract document was found in this repository context during spec refinement.
