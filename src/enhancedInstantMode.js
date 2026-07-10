const { normalizeClientCapabilities } = require('./clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('./operationalContextValidator');
const { buildInstantPrompt } = require('./instantPromptBuilder');
const { parseGeminiJson, normalizeInstantResponse } = require('./instantResponseNormalizer');
const {
  validateRawInstantResponse,
  validateInstantResponse,
  finalizeValidInstantResponse,
  sanitizeFinalInstantResponse,
} = require('./instantResponseValidator');
const { buildEnhancedInstantFallback } = require('./instantFallbackBuilder');
const { deriveInstantSignals } = require('./instantDomainRules');
const { normalizeNavigationContext, sanitizeSessionNavigations } = require('./sessionContext');
const { generateGeminiText } = require('./geminiClient');
const {
  buildCacheEntry,
  buildCacheEvent,
  buildCacheLookup,
  getWriteCacheability,
  isEntryUsable,
} = require('./instantRecommendationCache');

function emitCacheEvent(cacheEventReporter, event, lookup, reason) {
  if (typeof cacheEventReporter !== 'function') {
    return;
  }
  try {
    cacheEventReporter(buildCacheEvent(event, lookup, reason));
  } catch {
    // Observability must never affect the INSTANT response path.
  }
}

function sanitizeCachedRecommendation(recommendation, clientCapabilities) {
  return sanitizeFinalInstantResponse(recommendation, clientCapabilities);
}

async function readInstantCache({ instantRecommendationCache, lookup, clientCapabilities, cacheEventReporter }) {
  if (!instantRecommendationCache || !lookup.cacheable) {
    emitCacheEvent(cacheEventReporter, 'instant_cache_bypass', lookup, lookup.reason);
    return null;
  }

  try {
    const result = await instantRecommendationCache.get(lookup.cacheKey);
    if (!result?.ok) {
      emitCacheEvent(cacheEventReporter, 'instant_cache_read_error', lookup, 'read_error');
      return null;
    }

    const usability = isEntryUsable(result.entry, lookup);
    if (!usability.usable) {
      emitCacheEvent(cacheEventReporter, usability.reason === 'stale' ? 'instant_cache_stale' : 'instant_cache_miss', lookup, usability.reason);
      return null;
    }

    const sanitizedRecommendation = sanitizeCachedRecommendation(result.entry.recommendation, clientCapabilities);
    if (!sanitizedRecommendation) {
      emitCacheEvent(cacheEventReporter, 'instant_cache_miss', lookup, 'invalid_entry');
      return null;
    }

    emitCacheEvent(cacheEventReporter, 'instant_cache_hit', lookup, 'hit');
    emitCacheEvent(cacheEventReporter, 'instant_gemini_saved_by_cache', lookup, 'hit');
    if (typeof instantRecommendationCache.markHit === 'function') {
      try {
        await instantRecommendationCache.markHit(lookup.cacheKey);
      } catch {
        // Hit accounting is best-effort and must not turn a valid hit into a miss.
      }
    }
    return sanitizedRecommendation;
  } catch {
    emitCacheEvent(cacheEventReporter, 'instant_cache_read_error', lookup, 'read_error');
    return null;
  }
}

async function writeInstantCache({ instantRecommendationCache, lookup, recommendation, cacheEventReporter }) {
  if (!instantRecommendationCache || !lookup.cacheable) {
    return;
  }

  const cacheability = getWriteCacheability(recommendation);
  if (!cacheability.cacheable) {
    emitCacheEvent(cacheEventReporter, 'instant_cache_bypass', lookup, cacheability.reason);
    return;
  }

  const entryResult = buildCacheEntry({ lookup, recommendation });
  if (!entryResult.cacheable) {
    emitCacheEvent(cacheEventReporter, 'instant_cache_bypass', lookup, entryResult.reason);
    return;
  }

  try {
    const result = await instantRecommendationCache.set(entryResult.entry);
    emitCacheEvent(cacheEventReporter, result?.ok ? 'instant_cache_write_success' : 'instant_cache_write_error', lookup, result?.ok ? 'valid_shared_context' : 'write_error');
  } catch {
    emitCacheEvent(cacheEventReporter, 'instant_cache_write_error', lookup, 'write_error');
  }
}

async function buildEnhancedInstantRecommendation({
  data,
  sessionNavigations,
  geminiApiKey,
  geminiGenerateText = generateGeminiText,
  instantRecommendationCache = null,
  cacheEventReporter = null,
}) {
  const operationalContext = normalizeOperationalContext(data.operationalContext);
  const clientCapabilities = normalizeClientCapabilities(data.clientCapabilities);
  const navigationContext = normalizeNavigationContext(data, sessionNavigations);
  const sanitizedSessionNavigations = sanitizeSessionNavigations(sessionNavigations);
  const signals = deriveInstantSignals(operationalContext);
  const fallbackInput = { operationalContext, clientCapabilities };
  const cacheLookup = buildCacheLookup({ operationalContext, signals, clientCapabilities, navigationContext });
  const cachedRecommendation = await readInstantCache({
    instantRecommendationCache,
    lookup: cacheLookup,
    clientCapabilities,
    cacheEventReporter,
  });

  if (cachedRecommendation) {
    return cachedRecommendation;
  }

  const prompt = buildInstantPrompt({
    navigationContext,
    sessionNavigations: sanitizedSessionNavigations,
    operationalContext,
    clientCapabilities,
    signals,
  });

  try {
    const text = await geminiGenerateText({ apiKey: geminiApiKey, prompt });
    const parsed = parseGeminiJson(text);
    const rawValidation = validateRawInstantResponse(parsed, clientCapabilities);

    if (!rawValidation.valid) {
      return buildEnhancedInstantFallback({
        ...fallbackInput,
        reason: `gemini_invalid_response:${rawValidation.errors.join(',')}`,
      });
    }

    const normalized = normalizeInstantResponse(parsed, clientCapabilities, signals, operationalContext);
    const validation = validateInstantResponse(normalized, clientCapabilities);

    if (!validation.valid) {
      return buildEnhancedInstantFallback({
        ...fallbackInput,
        reason: `gemini_invalid_response:${validation.errors.join(',')}`,
      });
    }

    const finalized = finalizeValidInstantResponse(normalized, clientCapabilities, signals);
    await writeInstantCache({
      instantRecommendationCache,
      lookup: cacheLookup,
      recommendation: finalized,
      cacheEventReporter,
    });
    return finalized;
  } catch (error) {
    return buildEnhancedInstantFallback({
      ...fallbackInput,
      reason: error.message === 'gemini_timeout' ? 'gemini_timeout' : 'gemini_error',
    });
  }
}

module.exports = { buildEnhancedInstantRecommendation };
