const { normalizeClientCapabilities } = require('./clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('./operationalContextValidator');
const { buildInstantPrompt } = require('./instantPromptBuilder');
const { parseGeminiJson, normalizeInstantResponse } = require('./instantResponseNormalizer');
const { validateRawInstantResponse, validateInstantResponse, finalizeValidInstantResponse } = require('./instantResponseValidator');
const { buildEnhancedInstantFallback } = require('./instantFallbackBuilder');
const { deriveInstantSignals } = require('./instantDomainRules');
const { normalizeNavigationContext, sanitizeSessionNavigations } = require('./sessionContext');
const { generateGeminiText } = require('./geminiClient');

async function buildEnhancedInstantRecommendation({
  data,
  sessionNavigations,
  geminiApiKey,
  geminiGenerateText = generateGeminiText,
}) {
  const operationalContext = normalizeOperationalContext(data.operationalContext);
  const clientCapabilities = normalizeClientCapabilities(data.clientCapabilities);
  const navigationContext = normalizeNavigationContext(data, sessionNavigations);
  const sanitizedSessionNavigations = sanitizeSessionNavigations(sessionNavigations);
  const signals = deriveInstantSignals(operationalContext);
  const fallbackInput = { operationalContext };

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

    const normalized = normalizeInstantResponse(parsed, clientCapabilities);
    const validation = validateInstantResponse(normalized, clientCapabilities);

    if (!validation.valid) {
      return buildEnhancedInstantFallback({
        ...fallbackInput,
        reason: `gemini_invalid_response:${validation.errors.join(',')}`,
      });
    }

    return finalizeValidInstantResponse(normalized);
  } catch (error) {
    return buildEnhancedInstantFallback({
      ...fallbackInput,
      reason: error.message === 'gemini_timeout' ? 'gemini_timeout' : 'gemini_error',
    });
  }
}

module.exports = { buildEnhancedInstantRecommendation };
