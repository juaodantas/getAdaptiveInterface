const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  ALLOWED_INSTANT_ROUTES,
  FORBIDDEN_COMPONENTS,
  VISUAL_PRIORITIES,
} = require('./adaptiveContract');
const { RULE_IDS } = require('./instantDomainRules');

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

function hasForbiddenUiEquivalentOutsideExplicitFields(value) {
  if (containsForbiddenUiEquivalent(value)) {
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
      || hasForbiddenUiEquivalentOutsideExplicitFields(entry);
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
  if (Array.isArray(response.shortcuts) && response.shortcuts.length > clientCapabilities.maxShortcuts) {
    errors.push('too_many_shortcuts');
  }
  if (Array.isArray(response.sectionAdaptations)
    && response.sectionAdaptations.length > clientCapabilities.maxSectionAdaptations) {
    errors.push('too_many_sections');
  }
  if (response.nextStepPrediction?.targetRoute && !isAllowedRoute(response.nextStepPrediction.targetRoute)) {
    errors.push('invalid_next_step_route');
  }
  if (Array.isArray(response.shortcuts)) {
    response.shortcuts.forEach((shortcut) => {
      if (shortcut?.route && !isAllowedRoute(shortcut.route)) errors.push('invalid_shortcut_route');
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
  if (response.shortcuts.length > clientCapabilities.maxShortcuts) {
    errors.push('too_many_shortcuts');
  }
  if (response.sectionAdaptations.length > clientCapabilities.maxSectionAdaptations) {
    errors.push('too_many_sections');
  }

  response.shortcuts.forEach((shortcut) => {
    if (!isAllowedRoute(shortcut.route)) errors.push('invalid_shortcut_route');
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
  if (response.uiTreatment?.showProgressBar !== false) {
    errors.push('progress_bar_requested');
  }

  return { valid: errors.length === 0, errors };
}

function finalizeValidInstantResponse(response) {
  return {
    ...response,
    mode: ADAPTIVE_MODES.INSTANT,
    source: ADAPTIVE_SOURCES.ADAPTIVE,
    visualPriority: VISUAL_PRIORITIES.MODERATE,
    rulesApplied: [...new Set([...(response.rulesApplied || []), RULE_IDS.NO_PROGRESS_BAR])],
    fallback: {
      used: false,
      reason: null,
    },
  };
}

module.exports = {
  validateRawInstantResponse,
  validateInstantResponse,
  finalizeValidInstantResponse,
};
