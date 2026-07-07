const { DASHBOARD_CONFIG } = require('./adaptiveContract');

function clampConfidence(value, fallback = 0.6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function parseGeminiJson(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const cleaned = text.trim().replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeEnrichedRoutes(rawEnriched, expectedCount) {
  if (!Array.isArray(rawEnriched)) {
    return [];
  }

  return rawEnriched.slice(0, expectedCount || 6).map((entry) => {
    if (!entry || typeof entry !== 'object') return {};
    return {
      title: typeof entry.title === 'string' ? entry.title : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      actionLabel: typeof entry.actionLabel === 'string' ? entry.actionLabel : '',
      reason: typeof entry.reason === 'string' ? entry.reason : null,
    };
  });
}

function normalizeDashboardFields(raw) {
  const dashboardName = typeof raw.dashboard === 'string' ? raw.dashboard : null;
  let dashboardId = typeof raw.dashboardId === 'string' ? raw.dashboardId : null;
  let cardType = typeof raw.cardType === 'string' ? raw.cardType : null;

  if (dashboardName && (!dashboardId || !cardType)) {
    const config = Object.values(DASHBOARD_CONFIG).find((item) => item.displayName === dashboardName);
    if (config) {
      dashboardId = config.id;
      cardType = config.cardType;
    }
  }

  const config = dashboardId ? DASHBOARD_CONFIG[dashboardId] : null;
  if (!config || config.cardType !== cardType) {
    return { dashboard: null, dashboardId: null, cardType: null };
  }

  return { dashboard: config.displayName, dashboardId: config.id, cardType: config.cardType };
}

function normalizeInstantResponse(raw, clientCapabilities, signals) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const dashboardFields = normalizeDashboardFields(raw);
  const confidence = clampConfidence(raw.confidence);
  const ranking = Array.isArray(signals?.ranking) ? signals.ranking : [];
  const enrichedRoutes = normalizeEnrichedRoutes(raw.enrichedRoutes, ranking.length);

  const rawReasonDetails = raw.reasonDetails && typeof raw.reasonDetails === 'object' ? raw.reasonDetails : {};
  const legacyReasonDetails = raw.reason && typeof raw.reason === 'object' ? raw.reason : {};
  const reasonDetails = Object.keys(rawReasonDetails).length > 0 ? rawReasonDetails : legacyReasonDetails;
  const reason = typeof raw.reason === 'string' ? raw.reason : null;

  return {
    responseVersion: '1.0',
    ...dashboardFields,
    confidence,
    enrichedRoutes,
    reason,
    reasonDetails: {
      summary: typeof reasonDetails.summary === 'string' ? reasonDetails.summary : reason || '',
      details: Array.isArray(reasonDetails.details) ? reasonDetails.details.filter((detail) => typeof detail === 'string').slice(0, 8) : [],
      display: typeof reasonDetails.display === 'string' ? reasonDetails.display : 'info_icon',
    },
    rulesApplied: Array.isArray(raw.rulesApplied) ? raw.rulesApplied.filter((rule) => typeof rule === 'string') : [],
  };
}

module.exports = {
  parseGeminiJson,
  normalizeInstantResponse,
};
