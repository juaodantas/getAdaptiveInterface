const {
  ALLOWED_INFO_CTA_ROUTES,
  INFO_RECOMMENDATION_CATEGORIES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_TYPES,
} = require('./adaptiveContract');
const { RULE_IDS } = require('./instantDomainRules');

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
  [RULE_IDS.AGENDA_AFTER_LOT_WITH_PROTOCOL]: {
    type: 'day_progress', category: 'agenda', source: 'isis', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.PENDING_NUTRITION_ADJUSTMENT]: {
    type: 'today_cultivation', category: 'solucao', source: 'isis', priority: 'high', ctaRoute: '/solucaoPage',
  },
  [RULE_IDS.FIELD_NOTEBOOK_AFTER_ADJUSTMENT]: {
    type: 'field_notes_summary', category: 'caderno_campo', source: 'isis', priority: 'medium', ctaRoute: '/cadernoCampoPage',
  },
  [RULE_IDS.FINISH_AGENDA_AFTER_NOTEBOOK]: {
    type: 'day_progress', category: 'agenda', source: 'isis', priority: 'medium', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.FINAL_HOME_CHECK]: {
    type: 'day_progress', category: 'geral', source: 'local_tip', priority: 'low', ctaRoute: '/relatoriosPage',
  },
  [RULE_IDS.OVERDUE_TASKS]: {
    type: 'day_progress', category: 'agenda', source: 'isis', priority: 'high', ctaRoute: '/agendaPage',
  },
  [RULE_IDS.CRITICAL_ALERTS]: {
    type: 'basic_tip', category: 'agenda', source: 'fallback', priority: 'high', ctaRoute: '/agendaPage',
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

function buildInfoRecommendationFallback({ signals = {}, clientCapabilities = {} } = {}) {
  const supportedInfoTypes = supportedInfoTypesFromCapabilities(clientCapabilities);
  const ruleId = inferRuleId(signals);
  const base = ruleId ? INFO_BY_RULE[ruleId] : {
    type: 'basic_tip',
    category: 'geral',
    source: 'local_tip',
    priority: 'low',
    ctaRoute: '/areaCultivoPage',
  };
  const type = selectSupportedType(base.type, supportedInfoTypes);
  const template = localTemplateForType(type);

  return {
    type,
    source: type === base.type ? base.source : 'fallback',
    priority: type === base.type ? base.priority : 'low',
    title: template.title,
    reason: template.reason,
    ctaRoute: type === base.type ? base.ctaRoute : '/areaCultivoPage',
    category: type === base.type ? base.category : 'geral',
  };
}

module.exports = {
  buildInfoRecommendationFallback,
  isValidInfoRecommendation,
  normalizeInfoRecommendation,
  supportedInfoTypesFromCapabilities,
};
