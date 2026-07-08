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
  resolveRouteConflicts,
} = require('./instantInfoRecommendationBuilder');

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
  if (Array.isArray(response.shortcuts) && response.shortcuts.length > (clientCapabilities.maxShortcuts || 3)) {
    errors.push('too_many_shortcuts');
  }
  if (Array.isArray(response.sectionAdaptations) && response.sectionAdaptations.length > clientCapabilities.maxSectionAdaptations) {
    errors.push('too_many_sections');
  }
  if (response.nextStepPrediction?.targetRoute && !isAllowedRoute(response.nextStepPrediction.targetRoute)) {
    errors.push('invalid_next_step_route');
  }
  if (Array.isArray(response.shortcuts)) {
    response.shortcuts.forEach((shortcut) => {
      if (shortcut?.route && !isAllowedRoute(shortcut.route)) errors.push('invalid_shortcut_route');
    });
    response.shortcuts.forEach((shortcut) => {
      if (shortcut?.group && !SHORTCUT_GROUPS.includes(shortcut.group)) {
        errors.push('invalid_shortcut_group');
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

  if (!response.nextStepPrediction?.stepId || !response.nextStepPrediction?.targetRoute) {
    errors.push('missing_next_step');
  }
  if (!isAllowedRoute(response.nextStepPrediction?.targetRoute)) {
    errors.push('invalid_next_step_route');
  }
  if (!Array.isArray(response.sectionAdaptations) || response.sectionAdaptations.length === 0) {
    errors.push('missing_section_adaptations');
  }
  if (!Array.isArray(response.shortcuts) || response.shortcuts.length === 0) {
    errors.push('missing_shortcuts');
  }
  if (response.shortcuts.length > (clientCapabilities.maxShortcuts || 3)) {
    errors.push('too_many_shortcuts');
  }
  if (response.sectionAdaptations.length > clientCapabilities.maxSectionAdaptations) {
    errors.push('too_many_sections');
  }

  response.shortcuts.forEach((shortcut) => {
    if (!isAllowedRoute(shortcut.route)) errors.push('invalid_shortcut_route');
    if (shortcut.group && !SHORTCUT_GROUPS.includes(shortcut.group)) errors.push('invalid_shortcut_group');
  });
  response.sectionAdaptations.forEach((section) => {
    if (isUnsupportedComponent(section.component, clientCapabilities)) errors.push('unsupported_component');
    if (isForbiddenComponent(section.component, clientCapabilities)) errors.push('forbidden_component');
  });
  if (isUnsupportedComponent(response.focus?.component, clientCapabilities)) {
    errors.push('unsupported_focus_component');
  }
  if (isForbiddenComponent(response.focus?.component, clientCapabilities)) {
    errors.push('forbidden_focus_component');
  }
  if ((response.uiTreatment?.showProgressBar ?? false) !== false) {
    errors.push('progress_bar_requested');
  }
  if (response.infoRecommendation) {
    validateInfoRecommendation(response.infoRecommendation, clientCapabilities).forEach((error) => errors.push(error));
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
  const infoRecommendation = response.infoRecommendation
    && validateInfoRecommendation(response.infoRecommendation, clientCapabilities || {}).length === 0
    ? response.infoRecommendation
    : buildInfoRecommendationFallback({ signals, clientCapabilities });

  const maxShortcuts = Math.max(1, clientCapabilities.maxShortcuts || 3);
  const normalizedShortcuts = (response.shortcuts || []).slice(0, maxShortcuts).map((sc) => {
    const description = sc.description || sc.reason || '';
    return {
      ...sc,
      description,
      group: SHORTCUT_GROUPS.includes(sc.group) ? sc.group : 'contextual',
      reason: sc.reason || description,
    };
  });

  const stepId = signals?.stepId || response.nextStepPrediction?.stepId || '';
  const resolved = resolveRouteConflicts(
    stepId,
    response.nextStepPrediction?.targetRoute || infoRecommendation.ctaRoute,
    infoRecommendation ? infoRecommendation.ctaRoute : null,
    normalizedShortcuts,
  );

  return {
    ...response,
    nextStepPrediction: {
      ...response.nextStepPrediction,
      targetRoute: resolved.nextStepRoute,
    },
    shortcuts: resolved.shortcuts,
    mode: ADAPTIVE_MODES.INSTANT,
    source: ADAPTIVE_SOURCES.ADAPTIVE,
    visualPriority: VISUAL_PRIORITIES.MODERATE,
    rulesApplied: [...new Set([...(response.rulesApplied || []), RULE_IDS.NO_PROGRESS_BAR])],
    fallback: {
      used: false,
      reason: null,
    },
    infoRecommendation: resolved.infoCtaRoute && infoRecommendation
      ? { ...infoRecommendation, ctaRoute: resolved.infoCtaRoute }
      : infoRecommendation,
  };
}

module.exports = {
  validateRawInstantResponse,
  validateInstantResponse,
  validateInfoRecommendation,
  finalizeValidInstantResponse,
};
