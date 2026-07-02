const { DASHBOARD_CONFIG, SHORTCUT_GROUPS } = require('./adaptiveContract');
const { normalizeInfoWithSignal } = require('./instantInfoRecommendationBuilder');

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
  const shortcuts = Array.isArray(raw.shortcuts) ? raw.shortcuts.slice(0, clientCapabilities.maxShortcuts).map((shortcut) => {
    const description = typeof shortcut.description === 'string' ? shortcut.description : '';
    return {
      route: typeof shortcut.route === 'string' ? shortcut.route : '',
      confidence: clampConfidence(shortcut.confidence, confidence),
      label: typeof shortcut.label === 'string' ? shortcut.label : 'Abrir',
      description: description,
      group: SHORTCUT_GROUPS.includes(shortcut.group) ? shortcut.group : 'contextual',
      reason: typeof shortcut.reason === 'string' ? shortcut.reason : description,
    };
  }) : [];

  const sectionAdaptations = Array.isArray(raw.sectionAdaptations)
    ? raw.sectionAdaptations.slice(0, clientCapabilities.maxSectionAdaptations).map((section) => ({
      sectionId: typeof section.sectionId === 'string' ? section.sectionId : 'recommended_actions',
      component: typeof section.component === 'string' ? section.component : 'NextStepCard',
      priority: typeof section.priority === 'string' ? section.priority : 'high',
      treatment: typeof section.treatment === 'string' ? section.treatment : 'prominent',
      title: typeof section.title === 'string' ? section.title : '',
      description: typeof section.description === 'string' ? section.description : '',
    }))
    : [];

  const nextStep = raw.nextStepPrediction && typeof raw.nextStepPrediction === 'object' ? raw.nextStepPrediction : {};
  const focus = raw.focus && typeof raw.focus === 'object' ? raw.focus : {};
  const uiTreatment = raw.uiTreatment && typeof raw.uiTreatment === 'object' ? raw.uiTreatment : {};
  const rawReasonDetails = raw.reasonDetails && typeof raw.reasonDetails === 'object' ? raw.reasonDetails : {};
  const legacyReasonDetails = raw.reason && typeof raw.reason === 'object' ? raw.reason : {};
  const reasonDetails = Object.keys(rawReasonDetails).length > 0 ? rawReasonDetails : legacyReasonDetails;
  const reason = typeof raw.reason === 'string' ? raw.reason : null;
  const infoRecommendation = normalizeInfoWithSignal(raw.infoRecommendation, clientCapabilities, signals || { rulesApplied: raw.rulesApplied });

  return {
    responseVersion: '1.0',
    ...dashboardFields,
    confidence,
    nextStepPrediction: {
      stepId: typeof nextStep.stepId === 'string' ? nextStep.stepId : '',
      confidence: clampConfidence(nextStep.confidence, confidence),
      title: typeof nextStep.title === 'string' ? nextStep.title : '',
      description: typeof nextStep.description === 'string' ? nextStep.description : '',
      targetRoute: typeof nextStep.targetRoute === 'string' ? nextStep.targetRoute : '',
      actionLabel: typeof nextStep.actionLabel === 'string' ? nextStep.actionLabel : '',
    },
    sectionAdaptations,
    shortcuts,
    focus: {
      component: typeof focus.component === 'string' ? focus.component : 'AdaptiveFocusBanner',
      message: typeof focus.message === 'string' ? focus.message : '',
      targetSectionId: typeof focus.targetSectionId === 'string' ? focus.targetSectionId : 'recommended_actions',
      priority: typeof focus.priority === 'string' ? focus.priority : 'high',
    },
    uiTreatment: {
      density: typeof uiTreatment.density === 'string' ? uiTreatment.density : 'comfortable',
      emphasis: 'moderate',
      animation: typeof uiTreatment.animation === 'string' ? uiTreatment.animation : 'subtle',
      explanationVisibility: typeof uiTreatment.explanationVisibility === 'string' ? uiTreatment.explanationVisibility : 'low',
      showProgressBar: false,
    },
    reason,
    reasonDetails: {
      summary: typeof reasonDetails.summary === 'string' ? reasonDetails.summary : reason || '',
      details: Array.isArray(reasonDetails.details) ? reasonDetails.details.filter((detail) => typeof detail === 'string').slice(0, 8) : [],
      display: typeof reasonDetails.display === 'string' ? reasonDetails.display : 'info_icon',
    },
    rulesApplied: Array.isArray(raw.rulesApplied) ? raw.rulesApplied.filter((rule) => typeof rule === 'string') : [],
    infoRecommendation,
  };
}

module.exports = {
  parseGeminiJson,
  normalizeInstantResponse,
};
