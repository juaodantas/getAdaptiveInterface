# Decision: Use `operationalOnboarding` as the Initial-Step Info Slot

## What was decided

For INSTANT responses where `stepId` is `create_lot_with_protocol` and `operationalOnboarding` exists, `operationalOnboarding` is the info-card payload and `infoRecommendation` is returned as `null`.

This nulling behavior is limited to that step and condition only.

## Why

Returning both payloads creates two competing Home information surfaces for the initial onboarding state. An explicit `null` preserves the response field while making the replacement intentional and testable.

## What was discarded

- Omitting `infoRecommendation`, because that would change the response shape more broadly.
- Keeping both payloads, because the frontend could render duplicate or conflicting cards.
- Applying the replacement to all steps, because only `create_lot_with_protocol` has this onboarding-specific info-card requirement.
