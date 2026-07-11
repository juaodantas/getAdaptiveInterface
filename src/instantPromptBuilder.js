const {
  ALLOWED_INSTANT_ROUTES,
  ALLOWED_INFO_CTA_ROUTES,
  DASHBOARD_CONFIG,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_TYPES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_CATEGORIES,
} = require('./adaptiveContract');
const { DOMAIN_RULES } = require('./instantDomainRules');

const PROMPT_ALERT_TYPES = ['critical', 'operational', 'agenda', 'production', 'protocol', 'nutrition'];
const PROMPT_SEVERITIES = ['low', 'medium', 'high', 'critical'];

function buildPromptOperationalContext(operationalContext = {}) {
  const dashboardState = operationalContext.dashboardState || {};
  const agendaState = operationalContext.agendaState || {};
  const productionState = operationalContext.productionState || {};
  const cultivationState = operationalContext.cultivationState || {};
  const teamState = operationalContext.teamState || {};
  const alertState = operationalContext.alertState || {};
  const reservoirState = operationalContext.reservoirState || {};
  const fieldNotebookState = operationalContext.fieldNotebookState || {};
  return {
    generatedAt: operationalContext.generatedAt || null,
    dashboardState: {
      hasActiveLots: dashboardState.hasActiveLots === true,
      totalLots: dashboardState.totalLots || 0,
      activeLotsCount: dashboardState.activeLotsCount || 0,
      hasProtocolLinkedToLatestLot: dashboardState.hasProtocolLinkedToLatestLot === true,
      hasUpcomingHarvests: dashboardState.hasUpcomingHarvests === true,
      speciesInProgressCount: (dashboardState.speciesInProgress || []).length,
    },
    agendaState: {
      hasGeneratedActivities: agendaState.hasGeneratedActivities === true,
      pendingToday: agendaState.pendingToday || 0,
      pendingActivitiesWeekCount: agendaState.pendingActivitiesWeekCount || 0,
      overdueCount: agendaState.overdueCount || 0,
      hasOverdue: agendaState.hasOverdue === true,
      completedActivitiesTodayCount: agendaState.completedActivitiesTodayCount || 0,
      priorityBuckets: agendaState.priorityBuckets || {},
      lastAgendaInteraction: agendaState.lastAgendaInteraction || null,
      nextActivityType: agendaState.nextActivityType || null,
      nextActivityStatus: agendaState.nextActivityStatus || null,
      nextActivityDueLabel: agendaState.nextActivityDueLabel || null,
      nextActivityOverdue: agendaState.nextActivityOverdue === true,
      hasProtocolTasks: agendaState.hasProtocolTasks === true,
    },
    productionState: {
      hasProductionData: productionState.hasProductionData === true,
      harvestedPlantsLast30d: productionState.harvestedPlantsLast30d || 0,
      producedPackagesLast30d: productionState.producedPackagesLast30d || 0,
      upcomingHarvestLots: productionState.upcomingHarvestLots || 0,
      monthlyProductionCount: (productionState.monthlyProduction || []).length,
      topCulture: productionState.topCulture || null,
    },
    cultivationState: {
      culturesCount: cultivationState.culturesCount || 0,
      dominantCulture: cultivationState.dominantCulture || null,
      speciesInProgressCount: cultivationState.speciesInProgressCount || 0,
    },
    teamState: {
      activeMembers: teamState.activeMembers || 0,
      averageCompletionRate: teamState.averageCompletionRate || 0,
      onTimeActivities: teamState.onTimeActivities || 0,
      overdueActivities: teamState.overdueActivities || 0,
    },
    alertState: {
      hasCriticalAlerts: alertState.hasCriticalAlerts === true,
      criticalCount: alertState.criticalCount || 0,
      highestSeverity: PROMPT_SEVERITIES.includes(alertState.highestSeverity) ? alertState.highestSeverity : null,
      types: (alertState.types || []).filter((type) => PROMPT_ALERT_TYPES.includes(type)),
      itemsCount: (alertState.items || []).length,
    },
    reservoirState: {
      hasReservoirs: reservoirState.hasReservoirs === true,
      totalCount: reservoirState.totalCount || 0,
      withSolutionCount: reservoirState.withSolutionCount || 0,
      withoutSolutionCount: reservoirState.withoutSolutionCount || 0,
      lowLevelCount: reservoirState.lowLevelCount || 0,
      criticalLevelCount: reservoirState.criticalLevelCount || 0,
      highlightedReservoirsCount: (reservoirState.highlightedReservoirs || []).length,
    },
    fieldNotebookState: {
      hasNutritionAdjustmentRecord: fieldNotebookState.hasNutritionAdjustmentRecord === true,
      hasRecentNotes: fieldNotebookState.hasRecentNotes === true,
      totalRecentNotes: fieldNotebookState.totalRecentNotes || 0,
      latestRecordType: fieldNotebookState.latestRecordType || null,
      latestNotesCount: (fieldNotebookState.latestNotes || []).length,
      hasSowingNote: fieldNotebookState.hasSowingNote === true,
    },
    recentUserActions: (operationalContext.recentUserActions || []).map((action) => ({
      entityType: action.entityType,
      action: action.action,
      timestamp: action.timestamp,
    })),
  };
}

function buildInstantPrompt({ navigationContext, sessionNavigations, operationalContext, clientCapabilities, signals }) {
  const dashboards = Object.values(DASHBOARD_CONFIG).map((dashboard) => ({
    id: dashboard.id,
    displayName: dashboard.displayName,
    cardType: dashboard.cardType,
  }));

  const agendaState = operationalContext.agendaState || {};
  const maxShortcuts = Math.max(1, clientCapabilities.maxShortcuts || 3);
  const shouldNullInfoRecommendation = signals.stepId === 'create_lot_with_protocol'
    && clientCapabilities.supportedComponents.includes('OperationalOnboardingCard');
  const onboardingInfoRecommendationRule = shouldNullInfoRecommendation
    ? '- Se stepContext.stepId === "create_lot_with_protocol" e OperationalOnboardingCard estiver suportado, retorne infoRecommendation: null porque operationalOnboarding ocupa o slot do card informativo.'
    : '- Retorne infoRecommendation válido conforme o schema obrigatório.';

  const promptPayload = {
    navigationContext,
    sessionNavigations,
    operationalContext: buildPromptOperationalContext(operationalContext),
    currentActivityContext: {
      type: agendaState.nextActivityType || null,
      status: agendaState.nextActivityStatus || null,
      dueLabel: agendaState.nextActivityDueLabel || null,
      overdue: agendaState.nextActivityOverdue === true,
    },
    stepContext: {
      stepId: signals.stepId,
      targetRoute: signals.targetRoute,
      description: (signals.rulesApplied || []).join(', '),
      focusMessage: signals.focusMessage || null,
      expectedInfoType: signals.expectedInfoType || null,
      requiredShortcutRoutes: signals.requiredShortcutRoutes || [],
      forbiddenRoutes: signals.forbiddenRoutes || [],
      priority: signals.priority || 'normal',
    },
    clientCapabilities: {
      supportedComponents: clientCapabilities.supportedComponents,
      maxShortcuts,
      maxSectionAdaptations: clientCapabilities.maxSectionAdaptations,
      supportsInfoIconExplanation: clientCapabilities.supportsInfoIconExplanation,
      supportsHighlightFrame: clientCapabilities.supportsHighlightFrame,
      supportedInfoTypes: clientCapabilities.supportedInfoTypes,
    },
    allowedRoutes: ALLOWED_INSTANT_ROUTES,
    dashboards,
    forbiddenComponents: FORBIDDEN_COMPONENTS,
    domainRules: DOMAIN_RULES,
  };

  return `Você é um recomendador conservador para um app agrícola.
Use somente flags, contagens, rotas e categorias técnicas do JSON abaixo.
Não invente entidades, nomes de lotes, usuários, tarefas ou textos livres identificáveis.
Não retorne progress bar, stepper, checklist nem componente equivalente.
Rotas permitidas são somente as listadas em allowedRoutes.
Componentes permitidos são somente os suportados pelo cliente e não proibidos.

REGRAS DE ROTAS:
- shortcuts[0] é a ação principal (PODE ter a mesma rota de nextStepPrediction.targetRoute).
- shortcuts[1..N] DEVEM ter rotas diferentes entre si e de shortcuts[0].
- infoRecommendation.ctaRoute DEVE ser diferente de nextStepPrediction.targetRoute.

Contexto técnico da próxima atividade disponível em currentActivityContext.
Use apenas tipo, status, prazo e flags; não invente nem repita nomes de entidades.

Retorne APENAS JSON válido, sem markdown, seguindo o schema obrigatório:
{
  "responseVersion":"1.0",
  "confidence":0.0,
  "nextStepPrediction":{"stepId":"id do passo","targetRoute":"/rota","title":"texto curto","description":"texto curto","actionLabel":"texto curto"},
  "infoRecommendation":{"type":"${INFO_RECOMMENDATION_TYPES.join('|')}","source":"${INFO_RECOMMENDATION_SOURCES.join('|')}","priority":"${INFO_RECOMMENDATION_PRIORITIES.join('|')}","title":"texto curto","reason":"texto curto","ctaRoute":"/rota","category":"${INFO_RECOMMENDATION_CATEGORIES.join('|')}"},
  "shortcuts":[{"route":"/rota","confidence":0.0,"label":"texto curto","reason":"texto curto"}],
  "reason":"texto curto ou null",
  "reasonDetails":{"summary":"texto curto","details":["sinais técnicos"],"display":"info_icon"},
  "rulesApplied":["RULE-010"],
  "sectionAdaptations":[{"sectionId":"recommended_actions","component":"NextStepCard","priority":"high","treatment":"prominent","title":"texto curto","description":"texto curto"}],
  "focus":{"component":"AdaptiveFocusBanner","message":"texto curto","targetSectionId":"recommended_actions","priority":"high"},
  "uiTreatment":{"density":"comfortable","emphasis":"moderate","animation":"subtle","explanationVisibility":"low","showProgressBar":false}
}

REGRAS:
- nextStepPrediction.targetRoute deve ser a rota MAIS importante para o passo atual.
- infoRecommendation.ctaRoute DEVE ser diferente de nextStepPrediction.targetRoute.
- shortcuts deve respeitar clientCapabilities.maxShortcuts. shortcuts[0] é a ação principal (PODE repetir targetRoute). shortcuts[1..N] DEVEM ter rotas únicas entre si e diferentes de shortcuts[0].
- infoRecommendation.type deve usar um dos tipos permitidos.
- infoRecommendation.ctaRoute deve estar na allowlist da Info.
- shortcuts[].route deve estar em allowedRoutes.
${onboardingInfoRecommendationRule}

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt, buildPromptOperationalContext };
