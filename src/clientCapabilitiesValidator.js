const {
  DEFAULT_SUPPORTED_COMPONENTS,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_TYPES,
  SAFE_LIMITS,
} = require('./adaptiveContract');

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))];
}

function clampLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function normalizeClientCapabilities(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const forbiddenComponents = uniqueStrings([
    ...FORBIDDEN_COMPONENTS,
    ...(Array.isArray(input.forbiddenComponents) ? input.forbiddenComponents : []),
  ]);
  const supportedComponents = uniqueStrings(
    Array.isArray(input.supportedComponents) && input.supportedComponents.length > 0
      ? input.supportedComponents
      : DEFAULT_SUPPORTED_COMPONENTS,
  ).filter((component) => !forbiddenComponents.includes(component));
  const requestedInfoTypes = uniqueStrings(Array.isArray(input.supportedInfoTypes) ? input.supportedInfoTypes : []);
  const supportedInfoTypes = requestedInfoTypes.filter((type) => INFO_RECOMMENDATION_TYPES.includes(type));

  return {
    supportedComponents,
    supportsInfoIconExplanation: input.supportsInfoIconExplanation === true,
    supportsHighlightFrame: input.supportsHighlightFrame === true,
    maxShortcuts: clampLimit(input.maxShortcuts, SAFE_LIMITS.maxShortcuts),
    maxSectionAdaptations: clampLimit(input.maxSectionAdaptations, SAFE_LIMITS.maxSectionAdaptations),
    supportedInfoTypes: supportedInfoTypes.length > 0 ? supportedInfoTypes : INFO_RECOMMENDATION_TYPES,
    forbiddenComponents,
  };
}

module.exports = { normalizeClientCapabilities };
