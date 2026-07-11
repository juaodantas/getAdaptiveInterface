const {
  ALLOWED_INFO_CTA_ROUTES,
  INFO_RECOMMENDATION_CATEGORIES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_TYPES,
} = require('./adaptiveContract');
const { RULE_IDS, ROUTE_CONFLICT_RESOLVER } = require('./instantDomainRules');
const { ROUTE_DEFAULT_LABELS } = require('./instantRouteDistributor');

const FALLBACK_TYPE_ORDER = ['basic_tip', 'day_progress', 'today_cultivation', 'field_notes_summary', 'reservoir_report'];
const SAFE_TEXT_PATTERN = /(?:\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|@|https?:\/\/|resourceName|cpf|cnpj)/i;

const INFO_TEMPLATES = {
  today_cultivation: {
    title: 'Cultivo de hoje',
    reason: 'Há uma ação de cultivo para priorizar agora.',
  },
  reservoir_report: {
    title: 'Resumo de reservatórios',
    reason: 'Há sinais de reservatório para acompanhar com atenção.',
  },
  day_progress: {
    title: 'Resumo do dia',
    reason: 'Há atividades do dia para acompanhar.',
  },
  field_notes_summary: {
    title: 'Resumo do caderno',
    reason: 'Há registros operacionais recentes para conferir.',
  },
  basic_tip: {
    title: 'Dica operacional',
    reason: 'Há um próximo passo seguro para continuar o fluxo.',
  },
};

const INFO_BY_RULE = {
  [RULE_IDS.NO_PROTOCOL_LOT]: {
    type: 'basic_tip', category: 'protocolo', source: 'local_tip', priority: 'high', ctaRoute: '/protocoloPage',
  },
  [RULE_IDS.CHECK_GENERATED_ACTIVITIES]: {
    type: 'today_cultivation', category: 'agenda', source: 'isis', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.RECORD_CADERNO_ADJUSTMENT]: {
    type: 'today_cultivation', category: 'caderno_campo', source: 'isis', priority: 'high', ctaRoute: '/cadernoCampoPage',
  },
  [RULE_IDS.FINISH_AGENDA_ACTIVITIES]: {
    type: 'field_notes_summary', category: 'agenda', source: 'isis', priority: 'medium', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.REVIEW_FINAL_HOME]: {
    type: 'basic_tip', category: 'geral', source: 'local_tip', priority: 'low', ctaRoute: '/relatoriosPage',
  },
  [RULE_IDS.OVERDUE_TASKS]: {
    type: 'day_progress', category: 'agenda', source: 'isis', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.CRITICAL_ALERTS]: {
    type: 'basic_tip', category: 'agenda', source: 'fallback', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.TODAY_TASKS]: {
    type: 'today_cultivation', category: 'agenda', source: 'isis', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.FIELD_NOTEBOOK]: {
    type: 'field_notes_summary', category: 'caderno_campo', source: 'isis', priority: 'medium', ctaRoute: '/cadernoCampoPage',
  },
  [RULE_IDS.RESERVOIR_ATTENTION]: {
    type: 'reservoir_report', category: 'reservatorio', source: 'isis', priority: 'medium', ctaRoute: '/reservatoriosPage',
  },
  [RULE_IDS.PRODUCTION_CONTEXT]: {
    type: 'today_cultivation', category: 'cultivo', source: 'isis', priority: 'medium', ctaRoute: '/relatoriosPage',
  },
  [RULE_IDS.TEAM_CONTEXT]: {
    type: 'day_progress', category: 'agenda', source: 'local_tip', priority: 'low', ctaRoute: '/agendaPage',
  },
};

function supportedInfoTypesFromCapabilities(clientCapabilities = {}) {
  const supportedInfoTypes = Array.isArray(clientCapabilities.supportedInfoTypes)
    ? clientCapabilities.supportedInfoTypes.filter((type) => INFO_RECOMMENDATION_TYPES.includes(type))
    : [];

  return supportedInfoTypes.length > 0 ? [...new Set(supportedInfoTypes)] : INFO_RECOMMENDATION_TYPES;
}

function trimSafeText(value, maxLength) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength && !SAFE_TEXT_PATTERN.test(trimmed) ? trimmed : null;
}

function localTemplateForType(type) {
  return INFO_TEMPLATES[type] || INFO_TEMPLATES.basic_tip;
}

function hasRecentAgendaInteraction(agendaState) {
  return agendaState && (typeof agendaState.lastAgendaInteraction === 'string' || typeof agendaState.lastInteractionType === 'string');
}

function isValidInfoRecommendation(infoRecommendation, clientCapabilities = {}) {
  if (!infoRecommendation || typeof infoRecommendation !== 'object' || Array.isArray(infoRecommendation)) {
    return false;
  }

  const supportedInfoTypes = supportedInfoTypesFromCapabilities(clientCapabilities);
  return INFO_RECOMMENDATION_TYPES.includes(infoRecommendation.type)
    && supportedInfoTypes.includes(infoRecommendation.type)
    && INFO_RECOMMENDATION_SOURCES.includes(infoRecommendation.source)
    && INFO_RECOMMENDATION_PRIORITIES.includes(infoRecommendation.priority)
    && INFO_RECOMMENDATION_CATEGORIES.includes(infoRecommendation.category)
    && ALLOWED_INFO_CTA_ROUTES.includes(infoRecommendation.ctaRoute)
    && trimSafeText(infoRecommendation.title, 80) !== null
    && trimSafeText(infoRecommendation.reason, 160) !== null;
}

function normalizeInfoRecommendation(raw, clientCapabilities = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const type = typeof raw.type === 'string' ? raw.type.trim() : null;
  const template = localTemplateForType(type);
  const normalized = {
    type,
    source: typeof raw.source === 'string' ? raw.source.trim() : null,
    priority: typeof raw.priority === 'string' ? raw.priority.trim() : null,
    title: template.title,
    reason: template.reason,
    ctaRoute: typeof raw.ctaRoute === 'string' ? raw.ctaRoute.trim() : null,
    category: typeof raw.category === 'string' ? raw.category.trim() : null,
  };

  return isValidInfoRecommendation(normalized, clientCapabilities) ? normalized : null;
}

function selectSupportedType(type, supportedInfoTypes) {
  if (supportedInfoTypes.includes(type)) {
    return type;
  }

  return FALLBACK_TYPE_ORDER.find((candidate) => supportedInfoTypes.includes(candidate)) || 'basic_tip';
}

function inferRuleId(signals = {}) {
  if (Array.isArray(signals.rulesApplied)) {
    return signals.rulesApplied.find((ruleId) => INFO_BY_RULE[ruleId]);
  }

  return null;
}

function buildInfoRecommendationFallback({ signals = {}, clientCapabilities = {}, operationalContext = {} } = {}) {
  const supportedInfoTypes = supportedInfoTypesFromCapabilities(clientCapabilities);
  const ruleId = inferRuleId(signals);
  let base = ruleId ? INFO_BY_RULE[ruleId] : null;
  let template = null;

  const agendaState = operationalContext.agendaState || {};
  if (!base && hasRecentAgendaInteraction(agendaState)) {
    const interactionType = agendaState.lastAgendaInteraction || agendaState.lastInteractionType;
    const activityTitle = agendaState.lastActivityTitle;

    if (interactionType === 'completed') {
      base = {
        type: 'day_progress',
        category: 'agenda',
        source: 'isis',
        priority: 'medium',
        ctaRoute: '/agendaPage',
      };
      const titleHint = activityTitle ? `"${activityTitle}"` : 'a atividade';
      template = { title: 'Atividade concluída', reason: `${titleHint} foi concluída. Confira os próximos passos na Agenda.` };
    } else if (interactionType === 'created') {
      base = {
        type: 'day_progress',
        category: 'agenda',
        source: 'isis',
        priority: 'medium',
        ctaRoute: '/agendaPage',
      };
      const titleHint = activityTitle ? `"${activityTitle}"` : 'Nova atividade';
      template = { title: 'Atividade criada', reason: `${titleHint} foi criada. Veja as atividades do dia na Agenda.` };
    } else if (interactionType === 'viewed' || interactionType === 'edited') {
      base = {
        type: 'today_cultivation',
        category: 'cultivo',
        source: 'local_tip',
        priority: 'low',
        ctaRoute: '/agendaPage',
      };
    }
  }

  if (!base) {
    base = {
      type: 'basic_tip',
      category: 'geral',
      source: 'local_tip',
      priority: 'low',
      ctaRoute: '/areaCultivoPage',
    };
  }

  const type = selectSupportedType(base.type, supportedInfoTypes);
  const resolvedTemplate = template || localTemplateForType(type);

  return {
    type,
    source: type === base.type ? base.source : 'fallback',
    priority: type === base.type ? base.priority : 'low',
    title: resolvedTemplate.title,
    reason: resolvedTemplate.reason,
    ctaRoute: type === base.type ? base.ctaRoute : '/areaCultivoPage',
    category: type === base.type ? base.category : 'geral',
  };
}

function normalizeInfoWithSignal(raw, clientCapabilities, signals, operationalContext) {
  const normalized = normalizeInfoRecommendation(raw, clientCapabilities);
  if (!normalized) {
    return buildInfoRecommendationFallback({ signals, clientCapabilities, operationalContext });
  }

  const ruleId = inferRuleId(signals);
  if (!ruleId) {
    return normalized;
  }

  const expected = INFO_BY_RULE[ruleId];
  if (!expected) {
    return normalized;
  }

  if (normalized.type !== expected.type) {
    return buildInfoRecommendationFallback({ signals, clientCapabilities, operationalContext });
  }

  return normalized;
}

function remapShortcutRoute(shortcut, route) {
  const defaults = ROUTE_DEFAULT_LABELS[route] || { title: route, description: '', actionLabel: 'Abrir' };
  const label = defaults.actionLabel || defaults.title || 'Abrir';
  const description = defaults.description || '';

  return {
    ...shortcut,
    route,
    label,
    description,
    reason: description || label,
  };
}

function resolveRouteConflicts(stepId, nextStepRoute, infoCtaRoute, shortcuts) {
  const resolver = ROUTE_CONFLICT_RESOLVER[stepId];
  if (!resolver) return { nextStepRoute, infoCtaRoute, shortcuts };

  const usedRoutes = new Set();
  const resolvedInfoCta = (infoCtaRoute && (infoCtaRoute === nextStepRoute || usedRoutes.has(infoCtaRoute)))
    ? (resolver ? (resolver[infoCtaRoute] || infoCtaRoute) : infoCtaRoute)
    : infoCtaRoute;
  if (resolvedInfoCta) usedRoutes.add(resolvedInfoCta);
  if (nextStepRoute) usedRoutes.add(nextStepRoute);

  const resolvedShortcuts = (shortcuts || []).map((sc) => {
    if (!sc || !sc.route) return sc;
    if (!usedRoutes.has(sc.route)) {
      usedRoutes.add(sc.route);
      return sc;
    }
    const alternative = resolver ? (resolver[sc.route] || null) : null;
    if (alternative && !usedRoutes.has(alternative)) {
      usedRoutes.add(alternative);
      return remapShortcutRoute(sc, alternative);
    }
    return null;
  }).filter(Boolean);

  return {
    nextStepRoute,
    infoCtaRoute: resolvedInfoCta || infoCtaRoute,
    shortcuts: resolvedShortcuts,
  };
}

module.exports = {
  buildInfoRecommendationFallback,
  isValidInfoRecommendation,
  normalizeInfoRecommendation,
  normalizeInfoWithSignal,
  supportedInfoTypesFromCapabilities,
  resolveRouteConflicts,
};
