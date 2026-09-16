# Reproducibility and data-release statement

## Public materials currently available

This repository currently provides the implementation snapshot, tests, study protocol, blank post-block instrument, LLM prompt, response contract, deterministic domain rules, validation, fallback, and cache policy.

## Pending materials

The de-identified analytical dataset and the analysis scripts are not yet published. Their candidate workspace requires reconciliation with the final JIS analytical snapshot before release. Until that reconciliation is complete, no path in this repository should be interpreted as containing the final public data or as reproducing the article's numerical results.

## Protected materials

The following must not be committed to this public repository:

- raw form exports containing names, email addresses, or other direct identifiers;
- raw telemetry or account exports containing participant, user, or session identifiers;
- identifiable free-text responses;
- credentials, API keys, Firebase configuration secrets, or production data.

## Interpretation boundary

The study reports recorded presentation and activation of adaptive resources. It does not establish the relevance of an individual recommendation, verified destination arrival, task completion, performance improvement, or an isolated causal effect of the LLM. Any future release of analysis data and scripts must preserve these limits and reproduce the final reported results before being labeled as a replication package.
