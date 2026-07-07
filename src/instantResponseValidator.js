const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  ALLOWED_INFO_CTA_ROUTES,
  ALLOWED_INSTANT_ROUTES,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_CATEGORIES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_TYPES,
  SHORTCUT_GROUPS,
  VISUAL_PRIORITIES,
} = require('./adaptiveContract');
const { RULE_IDS } = require('./instantDomainRules');
const {
  buildInfoRecommendationFallback,
  supportedInfoTypesFromCapabilities,
} = require('./instantInfoRecommendationBuilder');
const { distributeFromRanking } = require('./instantRouteDistributor');

const UNSAFE_INFO_TEXT_PATTERN = /(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|@|https?:\/\/|resourceName|cpf|cnpj)/i;

function isAllowedRoute(route) {
  return ALLOWED_INSTANT_ROUTES.includes(route);
}

function isForbiddenComponent(component, clientCapabilities) {
  return FORBIDDEN_COMPONENTS.includes(component)
    || clientCapabilities.forbiddenComponents.includes(component)
    || containsForbiddenUiEquivalent(component);
}

function isUnsupportedComponent(component, clientCapabilities) {
  return typeof component !== 'string' || !clientCapabilities.supportedComponents.includes(component);
}

const FORBIDDEN_UI_EQUIVALENT_TOKENS = [
  'progress',
  'progressring',
  'progressindicator',
  'circularprogressindicator',
  'linearprogressindicator',
  'ringprogress',
  'indicatorprogress',
  'progresscircle',
  'circleprogress',
  'progressbar',
  'workflowprogressbar',
  'testprogressbar',
  'progressstepper',
  'stepper',
  'checklist',
  'progresso',
  'barradeprogresso',
  'listadeverificacao',
  'listadeverificação',
];

function normalizeToken(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function containsForbiddenUiEquivalent(value) {
  return typeof value === 'string'
    && FORBIDDEN_UI_EQUIVALENT_TOKENS.some((token) => normalizeToken(value).includes(normalizeToken(token)));
}

function isAllowedDomainEnumValue(path, value) {
  const fieldName = path[path.length - 1];
  const parentName = path[path.length - 2];
  return parentName === 'infoRecommendation'
    && fieldName === 'type'
    && INFO_RECOMMENDATION_TYPES.includes(value);
}

function hasForbiddenUiEquivalentOutsideExplicitFields(value, path = []) {
  if (containsForbiddenUiEquivalent(value) && !isAllowedDomainEnumValue(path, value)) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => {
    if (key === 'component' || key === 'showProgressBar') {
      return false;
    }
    return containsForbiddenUiEquivalent(key)
      || hasForbiddenUiEquivalentOutsideExplicitFields(entry, [...path, key]);
  });
}

function validateRawInstantResponse(response, clientCapabilities) {
  const errors = [];
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { valid: false, errors: ['missing_response'] };
  }

  if (response.uiTreatment?.showProgressBar === true) {
    errors.push('progress_bar_requested');
  }
  if (hasForbiddenUiEquivalentOutsideExplicitFields(response)) {
    errors.push('forbidden_ui_equivalent_requested');
  }
  if (!Array.isArray(response.enrichedRoutes)) {
    errors.push('missing_enriched_routes');
  }
  if (response.nextStepPrediction?.targetRoute && !isAllowedRoute(response.nextStepPrediction.targetRoute)) {
    errors.push('invalid_route_in_enriched');
  }
  if (Array.isArray(response.enrichedRoutes)) {
    response.enrichedRoutes.forEach((entry, i) => {
      if (entry && entry.title && UNSAFE_INFO_TEXT_PATTERN.test(entry.title)) {
        errors.push(`unsafe_title_in_enriched_${i}`);
      }
    });
  }
  if (Array.isArray(response.sectionAdaptations)) {
    response.sectionAdaptations.forEach((section) => {
      if (isUnsupportedComponent(section?.component, clientCapabilities)) errors.push('unsupported_component');
      if (isForbiddenComponent(section?.component, clientCapabilities)) errors.push('forbidden_component');
    });
  }
  if (response.focus?.component) {
    if (isUnsupportedComponent(response.focus.component, clientCapabilities)) errors.push('unsupported_focus_component');
    if (isForbiddenComponent(response.focus.component, clientCapabilities)) errors.push('forbidden_focus_component');
  }

  return { valid: errors.length === 0, errors };
}

function validateInstantResponse(response, clientCapabilities) {
  const errors = [];
  if (!response || typeof response !== 'object') {
    return { valid: false, errors: ['missing_response'] };
  }

  if (!Array.isArray(response.enrichedRoutes) || response.enrichedRoutes.length === 0) {
    errors.push('missing_enriched_routes');
  }
  if (!response.nextStepPrediction?.targetRoute && !response.enrichedRoutes?.length) {
    errors.push('missing_next_step');
  }
  if ((response.uiTreatment?.showProgressBar ?? false) !== false) {
    errors.push('progress_bar_requested');
  }

  return { valid: errors.length === 0, errors };
}

function validateInfoRecommendation(infoRecommendation, clientCapabilities) {
  const errors = [];
  const supportedInfoTypes = supportedInfoTypesFromCapabilities(clientCapabilities);

  if (!infoRecommendation || typeof infoRecommendation !== 'object' || Array.isArray(infoRecommendation)) {
    return ['missing_info_recommendation'];
  }
  if (!INFO_RECOMMENDATION_TYPES.includes(infoRecommendation.type)) errors.push('invalid_info_type');
  if (!supportedInfoTypes.includes(infoRecommendation.type)) errors.push('unsupported_info_type');
  if (!INFO_RECOMMENDATION_SOURCES.includes(infoRecommendation.source)) errors.push('invalid_info_source');
  if (!INFO_RECOMMENDATION_PRIORITIES.includes(infoRecommendation.priority)) errors.push('invalid_info_priority');
  if (!INFO_RECOMMENDATION_CATEGORIES.includes(infoRecommendation.category)) errors.push('invalid_info_category');
  if (!ALLOWED_INFO_CTA_ROUTES.includes(infoRecommendation.ctaRoute)) errors.push('invalid_info_cta_route');
  if (typeof infoRecommendation.title !== 'string'
    || infoRecommendation.title.trim().length === 0
    || infoRecommendation.title.trim().length > 80
    || UNSAFE_INFO_TEXT_PATTERN.test(infoRecommendation.title)) {
    errors.push('invalid_info_title');
  }
  if (typeof infoRecommendation.reason !== 'string'
    || infoRecommendation.reason.trim().length === 0
    || infoRecommendation.reason.trim().length > 160
    || UNSAFE_INFO_TEXT_PATTERN.test(infoRecommendation.reason)) {
    errors.push('invalid_info_reason');
  }

  return errors;
}

function finalizeValidInstantResponse(response, clientCapabilities, signals) {
  const ranking = Array.isArray(signals?.ranking) ? signals.ranking : [];
  const stepId = signals?.stepId || response.nextStepPrediction?.stepId || '';
  const confidence = response.confidence || 0.75;

  const distributed = distributeFromRanking({
    ranking,
    enrichedRoutes: response.enrichedRoutes || [],
    clientCapabilities,
    stepId,
    confidence,
  });

  return {
    responseVersion: '1.0',
    dashboard: response.dashboard || null,
    dashboardId: response.dashboardId || null,
    cardType: response.cardType || null,
    confidence,
    mode: ADAPTIVE_MODES.INSTANT,
    source: ADAPTIVE_SOURCES.ADAPTIVE,
    visualPriority: VISUAL_PRIORITIES.MODERATE,
    nextStepPrediction: distributed.nextStep,
    sectionAdaptations: [
      {
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: distributed.nextStep.title,
        description: distributed.nextStep.description,
      },
    ],
    shortcuts: distributed.shortcuts,
    focus: {
      component: 'AdaptiveFocusBanner',
      message: `Próximo foco: ${distributed.nextStep.title}.`,
      targetSectionId: 'recommended_actions',
      priority: 'high',
    },
    uiTreatment: {
      density: 'comfortable',
      emphasis: 'moderate',
      animation: 'subtle',
      explanationVisibility: 'low',
      showProgressBar: false,
    },
    reason: response.reason || distributed.nextStep.description,
    reasonDetails: response.reasonDetails || {
      summary: distributed.nextStep.description,
      details: signals.rulesApplied || [],
      display: 'info_icon',
    },
    rulesApplied: [...new Set([...(response.rulesApplied || []), ...(signals.rulesApplied || []), RULE_IDS.NO_PROGRESS_BAR])],
    infoRecommendation: distributed.infoRec,
    fallback: {
      used: false,
      reason: null,
    },
  };
}

module.exports = {
  validateRawInstantResponse,
  validateInstantResponse,
  validateInfoRecommendation,
  finalizeValidInstantResponse,
};
