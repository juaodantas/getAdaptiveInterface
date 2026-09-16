# LLM prompt and response contract

## Source of truth

The executable prompt template is [`src/instantPromptBuilder.js`](../src/instantPromptBuilder.js), in `buildInstantPrompt`. The executable response validation and finalization rules are in [`src/instantResponseValidator.js`](../src/instantResponseValidator.js). Deterministic eligibility is implemented in [`src/instantDomainRules.js`](../src/instantDomainRules.js).

The `INSTANT` workflow normalizes the operational context and session navigation, derives deterministic signals, constructs a structured prompt, parses JSON-only output, validates it, and otherwise returns the deterministic fallback in [`src/instantFallbackBuilder.js`](../src/instantFallbackBuilder.js).

## Prompt boundary

The prompt instructs the model to use only the sanitized JSON context. It prohibits inventing entities, lot names, users, tasks, identifiable free text, unsupported components, routes outside the allowlist, and progress bars, steppers, or checklists.

The structured context contains operational flags and counts, recent intra-session navigation, client capabilities, allowed routes, supported component types, and the applicable domain rules. Operational state is the primary context source; navigation is complementary.

## Required response shape

The prompt requests JSON with this conceptual structure:

```json
{
  "responseVersion": "1.0",
  "confidence": 0.0,
  "nextStepPrediction": {
    "stepId": "step identifier",
    "targetRoute": "/allowedRoute",
    "title": "short text",
    "description": "short text",
    "actionLabel": "short text"
  },
  "infoRecommendation": {
    "type": "allowed type",
    "source": "allowed source",
    "priority": "low|medium|high",
    "title": "short text",
    "reason": "short text",
    "ctaRoute": "/allowedRoute",
    "category": "allowed category"
  },
  "shortcuts": [{"route": "/allowedRoute", "confidence": 0.0, "label": "short text", "reason": "short text"}],
  "sectionAdaptations": [{"sectionId": "recommended_actions", "component": "supported component", "priority": "high", "treatment": "prominent", "title": "short text", "description": "short text"}],
  "focus": {"component": "AdaptiveFocusBanner", "message": "short text", "targetSectionId": "recommended_actions", "priority": "high"},
  "uiTreatment": {"density": "comfortable", "emphasis": "moderate", "animation": "subtle", "explanationVisibility": "low", "showProgressBar": false}
}
```

The final response additionally includes mode, source, dashboard metadata, reasons, applied rules, fallback status, and, when applicable, operational-onboarding content. The response validator constrains route and component allowlists, client capability limits, allowed enumerations, textual fields, and the maximum of three shortcuts and four section adaptations.

## Validation and fallback

Malformed output, unsupported routes or components, prohibited UI equivalents, excess elements, or an invalid final response trigger a deterministic fallback. The fallback uses the same deterministic signals and retains bounded presentation rather than exposing an unvalidated model result.

## Cache boundary

Equivalent shared operational contexts can reuse valid configurations. The cache key is derived from a non-identifying context profile and capability profile. Regular entries are valid for 24 hours; critical-alert and overdue-task contexts are valid for six hours. Fallbacks, low-confidence outputs, and entries with unsafe text are not cached.
