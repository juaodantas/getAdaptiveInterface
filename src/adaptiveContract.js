const ADAPTIVE_MODES = {
  STATIC: 'STATIC',
  INSTANT: 'INSTANT',
  GRADUAL: 'GRADUAL',
};

const VISUAL_PRIORITIES = {
  NONE: 'none',
  WEAK: 'weak',
  MODERATE: 'moderate',
  STRONG: 'strong',
};

const ADAPTIVE_SOURCES = {
  ADAPTIVE: 'adaptive',
  SYSTEM: 'system',
  FALLBACK: 'fallback',
  INSUFFICIENT_DATA: 'insufficient_data',
};

const DASHBOARD_CONFIG = {
  LOTE_PRODUCAO: {
    id: 'LOTE_PRODUCAO',
    displayName: 'Lotes em Produção',
    cardType: 'lotes',
    screens: ['/lotePage', '/setorPage'],
  },
  TAREFAS_PENDENTES: {
    id: 'TAREFAS_PENDENTES',
    displayName: 'Tarefas Pendentes',
    cardType: 'tarefas',
    screens: ['/agendaPage', '/gerenciarEquipePage'],
  },
  PRODUCAO_TOTAL: {
    id: 'PRODUCAO_TOTAL',
    displayName: 'Produção Total',
    cardType: 'producao',
    screens: ['/solucaoPage', '/reservatoriosPage', '/historicoPage'],
  },
  SAUDE_EQUIPES: {
    id: 'SAUDE_EQUIPES',
    displayName: 'Saúde das Equipes',
    cardType: 'saude',
    screens: ['/gerenciarEquipePage', '/agendaPage'],
  },
};

const DASHBOARD_MAP = Object.fromEntries(
  Object.values(DASHBOARD_CONFIG).map((config) => [config.displayName, config.screens]),
);

const ALLOWED_INSTANT_ROUTES = [
  '/areaCultivoPage',
  '/setorPage',
  '/lotePage',
  '/reservatoriosPage',
  '/solucaoPage',
  '/agendaPage',
  '/cadernoCampoPage',
  '/gerenciarEquipePage',
  '/relatoriosPage',
  '/historicoPage',
  '/ajustesPage',
  '/protocoloPage',
];

const INFO_RECOMMENDATION_TYPES = [
  'today_cultivation',
  'reservoir_report',
  'day_progress',
  'field_notes_summary',
  'basic_tip',
];

const INFO_RECOMMENDATION_SOURCES = ['isis', 'local_tip', 'fallback'];
const INFO_RECOMMENDATION_PRIORITIES = ['low', 'medium', 'high'];
const INFO_RECOMMENDATION_CATEGORIES = [
  'geral',
  'agenda',
  'lote',
  'protocolo',
  'solucao',
  'reservatorio',
  'caderno_campo',
  'cultivo',
];

const ALLOWED_INFO_CTA_ROUTES = [
  '/agendaPage',
  '/lotePage',
  '/protocoloPage',
  '/solucaoPage',
  '/reservatoriosPage',
  '/cadernoCampoPage',
  '/relatoriosPage',
  '/areaCultivoPage',
];

const EXCLUDED_PAGES_ARRAY = [
  '/modulosPage', '/splashPage', '/loginPage', '/homePage',
  '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
  '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage',
];

const FORBIDDEN_COMPONENTS = [
  'WorkflowProgressBar',
  'TestProgressBar',
  'ProgressStepper',
  'ProgressBar',
  'Stepper',
  'Checklist',
];

const DEFAULT_SUPPORTED_COMPONENTS = [
  'OperationalOnboardingCard',
  'NextStepCard',
  'ContextualOnboardingCard',
  'ActivityFeedCard',
  'AdaptiveFocusBanner',
  'AdaptiveReasonChip',
  'AdaptiveHighlightFrame',
  'EmptySectionWithAction',
  'AdaptiveRecommendedActionTile',
  'HomeInfoCard',
];

const SHORTCUT_GROUPS = ['primary', 'secondary', 'contextual'];

const SAFE_LIMITS = {
  maxShortcuts: 2,
  maxSectionAdaptations: 4,
};

const SCREEN_RESOURCE_REQUIREMENTS = {
  '/lotePage': { type: 'lote' },
  '/setorPage': { type: 'setor' },
  '/solucaoPage': { type: 'solucao' },
  '/reservatoriosPage': { type: 'reservatorio' },
};

const SAFE_LOTE_FALLBACK_ROUTE = '/areaCultivoPage';

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function hasValidCardType(cardType) {
  return Object.values(DASHBOARD_CONFIG).some((config) => config.cardType === cardType);
}

module.exports = {
  ADAPTIVE_MODES,
  VISUAL_PRIORITIES,
  ADAPTIVE_SOURCES,
  DASHBOARD_CONFIG,
  DASHBOARD_MAP,
  ALLOWED_INSTANT_ROUTES,
  INFO_RECOMMENDATION_TYPES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_CATEGORIES,
  ALLOWED_INFO_CTA_ROUTES,
  EXCLUDED_PAGES_ARRAY,
  FORBIDDEN_COMPONENTS,
  DEFAULT_SUPPORTED_COMPONENTS,
  SAFE_LIMITS,
  SCREEN_RESOURCE_REQUIREMENTS,
  SHORTCUT_GROUPS,
  SAFE_LOTE_FALLBACK_ROUTE,
  normalizeNonEmptyString,
  hasValidCardType,
};
