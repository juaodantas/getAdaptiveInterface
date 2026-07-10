const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  ALLOWED_INFO_CTA_ROUTES,
  ALLOWED_INSTANT_ROUTES,
  DASHBOARD_CONFIG,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_CATEGORIES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_TYPES,
  SHORTCUT_GROUPS,
  VISUAL_PRIORITIES,
  hasValidCardType,
} = require('./adaptiveContract');
const { RULE_IDS } = require('./instantDomainRules');
const {
  buildInfoRecommendationFallback,
  supportedInfoTypesFromCapabilities,
  resolveRouteConflicts,
} = require('./instantInfoRecommendationBuilder');
const {
  buildOperationalOnboardingFallback,
  validateOperationalOnboarding,
} = require('./instantOperationalOnboardingBuilder');

const UNSAFE_INFO_TEXT_PATTERN = /(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|@|https?:\/\/|resourceName|cpf|cnpj)/i;
const FINAL_INSTANT_RESPONSE_KEYS = [
  'responseVersion',
  'mode',
  'source',
  'dashboard',
  'dashboardId',
  'cardType',
  'confidence',
  'visualPriority',
  'nextStepPrediction',
  'sectionAdaptations',
  'shortcuts',
  'focus',
  'uiTreatment',
  'reason',
  'reasonDetails',
  'rulesApplied',
  'fallback',
  'infoRecommendation',
  'operationalOnboarding',
];
const PRIORITIES = ['low', 'medium', 'high'];
const SECTION_TREATMENTS = ['prominent', 'standard', 'subtle'];
const UI_DENSITIES = ['comfortable', 'compact'];
const UI_ANIMATIONS = ['subtle', 'none'];
const UI_EXPLANATION_VISIBILITIES = ['low', 'medium', 'high'];

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNumberInRange(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isString(value) {
  return typeof value === 'string';
}

function hasOnlyStrings(value) {
  return Array.isArray(value) && value.every(isString);
}

function pickFinalInstantResponseFields(response) {
  return Object.fromEntries(FINAL_INSTANT_RESPONSE_KEYS.map((key) => [key, response[key]]));
}

function plainObjectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function sanitizeFinalNextStepPrediction(value) {
  const nextStep = plainObjectOrEmpty(value);
  return {
    stepId: nextStep.stepId,
    confidence: nextStep.confidence,
    title: nextStep.title,
    description: nextStep.description,
    targetRoute: nextStep.targetRoute,
    actionLabel: nextStep.actionLabel,
  };
}

function sanitizeFinalSectionAdaptation(value) {
  const section = plainObjectOrEmpty(value);
  return {
    sectionId: section.sectionId,
    component: section.component,
    priority: section.priority,
    treatment: section.treatment,
    title: section.title,
    description: section.description,
  };
}

function sanitizeFinalShortcut(value) {
  const shortcut = plainObjectOrEmpty(value);
  return {
    route: shortcut.route,
    confidence: shortcut.confidence,
    label: shortcut.label,
    description: shortcut.description,
    group: shortcut.group,
    reason: shortcut.reason,
  };
}

function sanitizeFinalFocus(value) {
  const focus = plainObjectOrEmpty(value);
  return {
    component: focus.component,
    message: focus.message,
    targetSectionId: focus.targetSectionId,
    priority: focus.priority,
  };
}

function sanitizeFinalUiTreatment(value) {
  const uiTreatment = plainObjectOrEmpty(value);
  return {
    density: uiTreatment.density,
    emphasis: uiTreatment.emphasis,
    animation: uiTreatment.animation,
    explanationVisibility: uiTreatment.explanationVisibility,
    showProgressBar: uiTreatment.showProgressBar,
  };
}

function sanitizeFinalReasonDetails(value) {
  const reasonDetails = plainObjectOrEmpty(value);
  return {
    summary: reasonDetails.summary,
    details: Array.isArray(reasonDetails.details) ? [...reasonDetails.details] : reasonDetails.details,
    display: reasonDetails.display,
  };
}

function sanitizeFinalFallback(value) {
  const fallback = plainObjectOrEmpty(value);
  return {
    used: fallback.used,
    reason: fallback.reason,
  };
}

function sanitizeFinalInfoRecommendation(value) {
  const infoRecommendation = plainObjectOrEmpty(value);
  return {
    type: infoRecommendation.type,
    source: infoRecommendation.source,
    priority: infoRecommendation.priority,
    title: infoRecommendation.title,
    reason: infoRecommendation.reason,
    ctaRoute: infoRecommendation.ctaRoute,
    category: infoRecommendation.category,
  };
}

function sanitizeFinalOperationalOnboarding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return {
    title: value.title,
    message: value.message,
    steps: Array.isArray(value.steps) ? [...value.steps] : value.steps,
    ctaLabel: value.ctaLabel,
    targetRoute: value.targetRoute,
    reason: value.reason,
    priority: value.priority,
  };
}

function sanitizeFinalInstantResponseFields(response) {
  const sanitized = pickFinalInstantResponseFields(response);
  return {
    ...sanitized,
    nextStepPrediction: sanitizeFinalNextStepPrediction(response.nextStepPrediction),
    sectionAdaptations: Array.isArray(response.sectionAdaptations)
      ? response.sectionAdaptations.map(sanitizeFinalSectionAdaptation)
      : response.sectionAdaptations,
    shortcuts: Array.isArray(response.shortcuts)
      ? response.shortcuts.map(sanitizeFinalShortcut)
      : response.shortcuts,
    focus: sanitizeFinalFocus(response.focus),
    uiTreatment: sanitizeFinalUiTreatment(response.uiTreatment),
    reasonDetails: sanitizeFinalReasonDetails(response.reasonDetails),
    rulesApplied: Array.isArray(response.rulesApplied) ? [...response.rulesApplied] : response.rulesApplied,
    fallback: sanitizeFinalFallback(response.fallback),
    infoRecommendation: sanitizeFinalInfoRecommendation(response.infoRecommendation),
    operationalOnboarding: sanitizeFinalOperationalOnboarding(response.operationalOnboarding),
  };
}

function hasValidFinalNestedContract(response, clientCapabilities) {
  const dashboardConfig = DASHBOARD_CONFIG[response.dashboardId];
  if (response.responseVersion !== '1.0'
    || response.mode !== ADAPTIVE_MODES.INSTANT
    || response.source !== ADAPTIVE_SOURCES.ADAPTIVE
    || response.visualPriority !== VISUAL_PRIORITIES.MODERATE
    || !dashboardConfig
    || dashboardConfig.displayName !== response.dashboard
    || !hasValidCardType(response.cardType)
    || dashboardConfig.cardType !== response.cardType
    || !isNumberInRange(response.confidence)) {
    return false;
  }

  const nextStep = response.nextStepPrediction;
  if (!isPlainObject(nextStep)
    || !isString(nextStep.stepId)
    || !isNumberInRange(nextStep.confidence)
    || !isString(nextStep.title)
    || !isString(nextStep.description)
    || !isAllowedRoute(nextStep.targetRoute)
    || !isString(nextStep.actionLabel)) {
    return false;
  }

  if (!Array.isArray(response.sectionAdaptations)
    || response.sectionAdaptations.length === 0
    || response.sectionAdaptations.length > clientCapabilities.maxSectionAdaptations
    || response.sectionAdaptations.some((section) => !isPlainObject(section)
      || !isString(section.sectionId)
      || !isString(section.component)
      || !PRIORITIES.includes(section.priority)
      || !SECTION_TREATMENTS.includes(section.treatment)
      || !isString(section.title)
      || !isString(section.description))) {
    return false;
  }

  if (!Array.isArray(response.shortcuts)
    || response.shortcuts.length === 0
    || response.shortcuts.length > (clientCapabilities.maxShortcuts || 3)
    || response.shortcuts.some((shortcut) => !isPlainObject(shortcut)
      || !isAllowedRoute(shortcut.route)
      || !isNumberInRange(shortcut.confidence)
      || !isString(shortcut.label)
      || !isString(shortcut.description)
      || !SHORTCUT_GROUPS.includes(shortcut.group)
      || !isString(shortcut.reason))) {
    return false;
  }

  const focus = response.focus;
  if (!isPlainObject(focus)
    || !isString(focus.component)
    || !isString(focus.message)
    || !isString(focus.targetSectionId)
    || !PRIORITIES.includes(focus.priority)) {
    return false;
  }

  const uiTreatment = response.uiTreatment;
  if (!isPlainObject(uiTreatment)
    || !UI_DENSITIES.includes(uiTreatment.density)
    || uiTreatment.emphasis !== VISUAL_PRIORITIES.MODERATE
    || !UI_ANIMATIONS.includes(uiTreatment.animation)
    || !UI_EXPLANATION_VISIBILITIES.includes(uiTreatment.explanationVisibility)
    || uiTreatment.showProgressBar !== false) {
    return false;
  }

  const reasonDetails = response.reasonDetails;
  if (!(isString(response.reason) || response.reason === null)
    || !isPlainObject(reasonDetails)
    || !isString(reasonDetails.summary)
    || !hasOnlyStrings(reasonDetails.details)
    || reasonDetails.display !== 'info_icon'
    || !hasOnlyStrings(response.rulesApplied)
    || !isPlainObject(response.fallback)
    || response.fallback.used !== false
    || response.fallback.reason !== null) {
    return false;
  }

  const opOnboarding = response.operationalOnboarding;
  if (opOnboarding !== null) {
    if (!isPlainObject(opOnboarding)
      || validateOperationalOnboarding(opOnboarding).length > 0) {
      return false;
    }
  }

  return validateInfoRecommendation(response.infoRecommendation, clientCapabilities).length === 0;
}

function sanitizeFinalInstantResponse(response, clientCapabilities) {
  if (!isPlainObject(response)) {
    return null;
  }

  const sanitized = sanitizeFinalInstantResponseFields(response);
  if (!hasValidFinalNestedContract(sanitized, clientCapabilities || {})) {
    return null;
  }
  if (!validateInstantResponse(sanitized, clientCapabilities || {}).valid) {
    return null;
  }

  return sanitized;
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
    operationalOnboarding: response.operationalOnboarding || null,
  };
}

module.exports = {
  validateRawInstantResponse,
  validateInstantResponse,
  validateInfoRecommendation,
  finalizeValidInstantResponse,
  sanitizeFinalInstantResponse,
  FINAL_INSTANT_RESPONSE_KEYS,
};
