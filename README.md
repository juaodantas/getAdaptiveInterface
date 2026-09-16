# Bounded context-aware adaptive interface

Research artifact for the JIS 2026 article, *Arquitetura híbrida para interfaces móveis adaptativas: desenvolvimento e avaliação em gestão hortícola*.

The evaluated interface confines adaptation to selected home-screen regions. Deterministic domain rules first determine eligible alternatives; the LLM then prioritizes only those alternatives from operational state and recent intra-session navigation. A deterministic validation layer and a stable fallback prevent invalid responses from reaching the interface.

## What is in this repository

| Material | Location | Status |
| --- | --- | --- |
| Cloud Function source code | `index.js`, `src/` | Available |
| Unit and integration tests | `tests/` | Available |
| Study protocol | [`docs/STUDY_PROTOCOL.md`](docs/STUDY_PROTOCOL.md) | Available |
| Blank post-block instrument | [`docs/INSTRUMENT.md`](docs/INSTRUMENT.md) | Available through the original Google Form |
| LLM prompt and response contract | [`docs/LLM_CONTRACT.md`](docs/LLM_CONTRACT.md) | Available |
| Reproducibility and privacy statement | [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md) | Available |
| De-identified data and analysis scripts | `data/`, `analysis/` | Pending final analytical snapshot |

The last item is intentionally not represented as available. The candidate analytical workspace currently requires reconciliation with the final JIS results before it can be released.

## Evaluated workflow

```text
Mobile application
  -> normalized operational context + recent session navigation
  -> deterministic domain-rule eligibility
  -> cache lookup for an equivalent shared context
  -> Gemini prioritization within the valid alternative set
  -> normalization, sanitization, and deterministic validation
  -> bounded home-screen configuration or deterministic fallback
  -> exposure and click telemetry after presentation
```

The LLM does not freely generate routes, components, or application capabilities. Telemetry is recorded after presentation and was not used to train the mechanism during the study.

## Study scope

The exploratory, moderated, counterbalanced within-subjects study included 28 Agronomy students aged 20--30. Each participant used static and adaptive conditions; 14 used the static condition first and 14 the adaptive condition first. The study collected SUS, UEQ-S, open-ended responses, and adaptive-component telemetry.

The article reports 697 adaptive-card exposures, 50 subsequent clicks, and activation of at least one adaptive component by 20 of 28 participants. These records characterize use of presented resources; they do not establish recommendation relevance, destination arrival, task completion, performance improvement, or an isolated LLM effect.

## Repository structure

```text
index.js                         Firebase Functions entry point
src/                              adaptation workflow, contracts, rules, cache, and validation
tests/                            unit and integration tests
docs/STUDY_PROTOCOL.md            protocol reconstructed from the dissertation and article
docs/INSTRUMENT.md                blank post-block instrument and original-form link
docs/LLM_CONTRACT.md              prompt and response-contract source map
docs/REPRODUCIBILITY.md           scope, data-release boundary, and pending materials
```

## Local verification

```bash
npm install
npm test
```

Deployment requires project-specific Firebase and Gemini credentials. Do not commit credentials or study records to this repository.

## Scope boundary

The codebase contains legacy and operational paths in addition to the evaluated `INSTANT` workflow. The JIS article evaluates the bounded contextual-adaptation configuration described above, not every mode or endpoint present in this repository.
