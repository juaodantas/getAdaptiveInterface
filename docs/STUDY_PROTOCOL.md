# Study protocol

## Objective

Evaluate, exploratorily, a bounded context-aware adaptive mobile interface for horticultural crop management against a static home-screen condition. The adaptive condition combined deterministic eligibility rules, contextual prioritization, bounded text formulation, validation, and a deterministic fallback.

## Design and participants

The study used a moderated, counterbalanced within-subjects design. Of 34 recruited candidates, 28 completed both condition blocks and the post-block questionnaires and formed the operational cohort. The six incomplete cases were excluded under the pre-specified completeness criterion.

All participants in the operational cohort were Agronomy students aged 20--30. Fourteen participants used the static condition first and 14 used the adaptive condition first. The application state was reset between periods. The study was approved by the Research Ethics Committee of the Federal University of Mato Grosso (CAAE: 94392325.5.0000.5690).

## Conditions

Both conditions exposed the same application modules and task scenario.

- **Static:** fixed home-screen organization, quick actions, and information panels.
- **Adaptive:** the permanent header and main modules remained fixed. A bounded home-screen surface could prioritize valid quick actions and contextual panels from operational state and recent intra-session navigation.

Domain rules determined which alternatives were eligible. The LLM only prioritized eligible alternatives and could formulate constrained text. The returned configuration was normalized, sanitized, and validated before presentation. Invalid, unavailable, or rejected results produced a deterministic fallback.

## Procedure and tasks

After informed consent and a brief introduction to basic functions, participants completed the assigned condition, filled in the post-block instrument, and completed the other condition after the experimental period advanced. The moderator remained neutral and intervened only to clarify task wording or address a blockage. Participants were not given an explanation of the adaptive mechanism.

In each block, participants:

1. created a lot and associated a crop protocol;
2. inspected first-day activities in the Schedule;
3. recorded root-stimulator spraying in the Field Notebook; and
4. returned to the Schedule to mark the planned first-day activities as completed.

Lettuce and arugula routines were assigned to the first and second periods, respectively, so that each routine occurred in each condition for 14 participants.

## Measures and analysis roles

| Evidence source | Analytical role |
| --- | --- |
| SUS | Perceived usability in each condition |
| UEQ-S | Pragmatic, hedonic, and overall perceived user experience |
| Open-ended responses | Qualitative accounts of orientation, navigation, content, interaction, and adaptation |
| Telemetry | Recorded use of adaptive resources during adaptive-condition use |

Paired comparisons used exploratory, two-sided, exact Wilcoxon tests with raw *p* values. Open-ended content was segmented into meaning units and coded by one researcher; no independent second coding or inter-coder agreement assessment was performed.

An exposure is one registered card-display occurrence, and a click is one registered interaction event. These are not unique participants, standardized opportunities to click, recommendation-relevance measures, verified arrivals, task-completion measures, or performance outcomes.

## Privacy and publication boundary

Model-facing context excluded user, session, and participant identifiers; personal identifiers; identifiable free text; and unsanitized raw data. Aggregate reporting and the conceptual architecture can be shared without exposing identifiable records or open-ended response text. See [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md) for the status of the public analytical materials.
