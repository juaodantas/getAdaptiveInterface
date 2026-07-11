const crypto = require('crypto');
const { INFO_RECOMMENDATION_TYPES, SAFE_LIMITS } = require('./adaptiveContract');

const INSTANT_CACHE_MODE = 'INSTANT';
const INSTANT_CACHE_PROMPT_VERSION = 'instant-v1';
const INSTANT_CACHE_RESPONSE_VERSION = '1.0';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const VOLATILE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_CACHE_CONFIDENCE = 0.7;

const UNSAFE_CACHE_TEXT_PATTERN = /(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|@|https?:\/\/|resourceName|cpf|cnpj|sessionId|userId)/i;

function bucketCount(value) {
  const count = Number.isInteger(value) && value > 0 ? value : 0;
  if (count === 0) return 'none';
  if (count <= 2) return 'low';
  if (count <= 5) return 'medium';
  return 'high';
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function deriveContextProfile({ operationalContext, signals, navigationContext }) {
  const context = operationalContext || {};
  const dashboard = context.dashboardState || {};
  const agenda = context.agendaState || {};
  const notebook = context.fieldNotebookState || {};
  const reservoir = context.reservoirState || {};
  const production = context.productionState || {};
  const cultivation = context.cultivationState || {};
  const team = context.teamState || {};
  const alerts = context.alertState || {};
  const infoCards = context.infoCardsState || {};
  const currentRoute = typeof navigationContext?.currentRoute === 'string' ? navigationContext.currentRoute.split('?')[0] : null;

  return {
    stepStage: signals.stepId || 'unknown',
    lotState: dashboard.hasActiveLots || dashboard.hasProtocolLinkedToLatestLot
      ? (dashboard.hasProtocolLinkedToLatestLot ? 'active_with_protocol' : 'active_without_protocol')
      : 'none',
    agendaLoad: bucketCount(Math.max(agenda.pendingActivitiesTodayCount || 0, agenda.dueBuckets?.today || 0)),
    overdueLoad: bucketCount(Math.max(agenda.overdueActivitiesCount || 0, agenda.dueBuckets?.overdue || 0, team.overdueActivities || 0)),
    alertState: alerts.hasCriticalAlerts || alerts.criticalCount > 0 ? 'critical' : (alerts.highestSeverity || 'none'),
    productionState: production.hasProductionData || production.harvestedPlantsLast30d > 0 || production.producedPackagesLast30d > 0
      ? 'recent_production'
      : 'no_recent_production',
    reservoirState: reservoir.criticalLevelCount > 0 || reservoir.currentLevel === 'critical'
      ? 'critical'
      : (reservoir.lowLevelCount > 0 || reservoir.currentLevel === 'low' ? 'low' : (reservoir.hasReservoirs ? 'present' : 'none')),
    fieldNotebookState: notebook.hasRecentFieldNotes || notebook.totalRecentNotes > 0 ? 'recent_notes' : 'none',
    cultivationState: (cultivation.cultures || []).length > 0 || (cultivation.speciesInProgress || []).length > 0 || infoCards.todayCultivation?.activeLots > 0
      ? 'active'
      : 'none',
    currentRouteGroup: currentRoute || 'none',
  };
}

function deriveCapabilityProfile(clientCapabilities) {
  const caps = clientCapabilities || {};
  const profile = {};

  if ((caps.maxShortcuts || SAFE_LIMITS.maxShortcuts) < SAFE_LIMITS.maxShortcuts) {
    profile.maxShortcuts = caps.maxShortcuts;
  }
  if ((caps.maxSectionAdaptations || SAFE_LIMITS.maxSectionAdaptations) < SAFE_LIMITS.maxSectionAdaptations) {
    profile.maxSectionAdaptations = caps.maxSectionAdaptations;
  }
  if (Array.isArray(caps.supportedInfoTypes) && caps.supportedInfoTypes.length < INFO_RECOMMENDATION_TYPES.length) {
    profile.supportedInfoTypes = [...caps.supportedInfoTypes].sort();
  }
  if (Array.isArray(caps.supportedComponents) && !caps.supportedComponents.includes('NextStepCard')) {
    profile.nextStepCard = 'unsupported';
  }
  if (Array.isArray(caps.supportedComponents) && !caps.supportedComponents.includes('AdaptiveFocusBanner')) {
    profile.focusBanner = 'unsupported';
  }

  return Object.keys(profile).length > 0 ? profile : null;
}

function buildCacheKeyCanonical({ promptVersion = INSTANT_CACHE_PROMPT_VERSION, stepId, contextProfile, capabilityProfile = null }) {
  return {
    promptVersion,
    mode: INSTANT_CACHE_MODE,
    stepId,
    contextProfile,
    capabilityProfile,
  };
}

function hashCanonical(canonical) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(canonical)).digest('hex')}`;
}

function containsUnsafeCacheText(value) {
  if (typeof value === 'string') return UNSAFE_CACHE_TEXT_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsUnsafeCacheText);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => UNSAFE_CACHE_TEXT_PATTERN.test(key) || containsUnsafeCacheText(entry));
  }
  return false;
}

function hasStableContext(signals, contextProfile) {
  return Boolean(signals?.stepId && contextProfile?.stepStage && contextProfile.stepStage !== 'unknown');
}

function isVolatileProfile(contextProfile) {
  return contextProfile.alertState === 'critical' || contextProfile.overdueLoad !== 'none';
}

function ttlForContextProfile(contextProfile) {
  return isVolatileProfile(contextProfile) ? VOLATILE_TTL_MS : DEFAULT_TTL_MS;
}

function buildCacheLookup({ operationalContext, signals, clientCapabilities, navigationContext, promptVersion = INSTANT_CACHE_PROMPT_VERSION }) {
  const contextProfile = deriveContextProfile({ operationalContext, signals, navigationContext });
  if (!hasStableContext(signals, contextProfile)) {
    return { cacheable: false, reason: 'insufficient_context' };
  }
  const capabilityProfile = deriveCapabilityProfile(clientCapabilities);
  const cacheKeyCanonical = buildCacheKeyCanonical({ promptVersion, stepId: signals.stepId, contextProfile, capabilityProfile });
  const cacheKey = hashCanonical(cacheKeyCanonical);
  return {
    cacheable: true,
    reason: 'valid_shared_context',
    cacheKey,
    cacheKeyCanonical,
    promptVersion,
    stepId: signals.stepId,
    ttlMs: ttlForContextProfile(contextProfile),
    ttlBucket: isVolatileProfile(contextProfile) ? 'volatile_6h' : 'default_24h',
  };
}

function isEntryUsable(entry, lookup, now = new Date()) {
  if (!entry || typeof entry !== 'object') return { usable: false, reason: 'miss' };
  if (entry.status && entry.status !== 'active') return { usable: false, reason: 'disabled' };
  if (entry.promptVersion !== lookup.promptVersion || entry.cacheKey !== lookup.cacheKey) return { usable: false, reason: 'version_mismatch' };
  const expiresAt = toDate(entry.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return { usable: false, reason: 'stale' };
  if (!entry.recommendation || typeof entry.recommendation !== 'object') return { usable: false, reason: 'invalid_entry' };
  return { usable: true, reason: 'hit' };
}

function getWriteCacheability(recommendation) {
  if (!recommendation || typeof recommendation !== 'object') return { cacheable: false, reason: 'missing_recommendation' };
  if (recommendation.fallback?.used === true) return { cacheable: false, reason: 'fallback_used' };
  if ((Number(recommendation.confidence) || 0) < MIN_CACHE_CONFIDENCE) return { cacheable: false, reason: 'low_confidence' };
  if (containsUnsafeCacheText(recommendation)) return { cacheable: false, reason: 'unsafe_text' };
  return { cacheable: true, reason: 'valid_shared_context' };
}

function buildCacheEntry({ lookup, recommendation, now = new Date() }) {
  const cacheability = getWriteCacheability(recommendation);
  if (!lookup?.cacheable || !cacheability.cacheable) {
    return { cacheable: false, reason: lookup?.reason || cacheability.reason };
  }
  return {
    cacheable: true,
    reason: cacheability.reason,
    entry: {
      cacheKey: lookup.cacheKey,
      cacheKeyCanonical: lookup.cacheKeyCanonical,
      promptVersion: lookup.promptVersion,
      mode: INSTANT_CACHE_MODE,
      stepId: lookup.stepId,
      responseVersion: INSTANT_CACHE_RESPONSE_VERSION,
      recommendation,
      cacheability,
      stats: { hitCount: 0, lastHitAt: null },
      expiresAt: new Date(now.getTime() + lookup.ttlMs),
      status: 'active',
    },
  };
}

function buildCacheEvent(event, lookup, reason) {
  return {
    event,
    mode: INSTANT_CACHE_MODE,
    stepId: lookup?.stepId || null,
    promptVersion: lookup?.promptVersion || INSTANT_CACHE_PROMPT_VERSION,
    cachePolicyReason: reason || lookup?.reason || null,
    ttlBucket: lookup?.ttlBucket || null,
  };
}

module.exports = {
  INSTANT_CACHE_PROMPT_VERSION,
  INSTANT_CACHE_RESPONSE_VERSION,
  DEFAULT_TTL_MS,
  VOLATILE_TTL_MS,
  MIN_CACHE_CONFIDENCE,
  stableStringify,
  deriveContextProfile,
  deriveCapabilityProfile,
  buildCacheLookup,
  isEntryUsable,
  getWriteCacheability,
  buildCacheEntry,
  buildCacheEvent,
};
