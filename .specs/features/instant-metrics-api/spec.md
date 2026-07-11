# INSTANT Metrics - API

## Problem
The current metrics pipeline (Firebase Analytics → BigQuery → Cloud Function → Firestore) is complex, fragile, and doesn't capture INSTANT-specific KPIs. There is no visibility into Gemini usage, cache effectiveness, or fallback rates.

## Goal
Write structured metrics to Firestore collection `instantMetrics` after each INSTANT recommendation, capturing cache outcome, Gemini success/failure, and recommendation metadata.

## Requirements

### R1: Write metric after every INSTANT response
Every call to `buildEnhancedInstantRecommendation` must write one document to `instantMetrics` before returning.

### R2: Metric document schema
Each document must contain:

| Field | Type | Description |
|---|---|---|
| `event` | string | `cache_hit`, `gemini_success`, `gemini_fallback`, `gemini_error`, `cache_bypass` |
| `userId` | string | From `data.userId` |
| `sessionId` | string | From `data.sessionId` |
| `stepId` | string | Derived from `signals.stepId` |
| `confidence` | number | From the returned recommendation |
| `fallbackUsed` | boolean | `recommendation.fallback?.used === true` |
| `cachePolicy` | string or null | Cache reason, if applicable |
| `createdAt` | Timestamp | Firestore server timestamp |

### R3: Non-blocking
Metrics write must NEVER block or affect the recommendation response. Use fire-and-forget with silent error handling.

### R4: File to modify
Only `src/enhancedInstantMode.js`

## Files
- `src/enhancedInstantMode.js` — add metrics write helper + call at each return point

## Dependencies
- `db` (Firestore instance) is available in `index.js` — must be passed as parameter or imported from closure
- `admin` (firebase-admin) is available for `admin.firestore.FieldValue.serverTimestamp()`
