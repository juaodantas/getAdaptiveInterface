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
  const nextActivity = agendaState.nextActivity || {};
  const productionState = operationalContext.productionState || {};
  const cultivationState = operationalContext.cultivationState || {};
  const teamState = operationalContext.teamState || {};
  const alertState = operationalContext.alertState || {};
  const reservoirState = operationalContext.reservoirState || {};
  const fieldNotebookState = operationalContext.fieldNotebookState || {};
  const infoCardsState = operationalContext.infoCardsState || {};
  const todayCultivation = infoCardsState.todayCultivation || {};
  const reservoirReport = infoCardsState.reservoirReport || {};
  const dayProgress = infoCardsState.dayProgress || {};
  const fieldNotesSummary = infoCardsState.fieldNotesSummary || {};
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
      pendingActivitiesTodayCount: agendaState.pendingActivitiesTodayCount || 0,
      pendingActivitiesWeekCount: agendaState.pendingActivitiesWeekCount || 0,
      overdueActivitiesCount: agendaState.overdueActivitiesCount || 0,
      completedActivitiesTodayCount: agendaState.completedActivitiesTodayCount || 0,
      dueBuckets: agendaState.dueBuckets || {},
      priorityBuckets: agendaState.priorityBuckets || {},
      lastInteractionType: agendaState.lastInteractionType || null,
      nextActivity: {
        title: nextActivity.title || null,
        description: nextActivity.description || null,
        type: nextActivity.type || null,
        status: nextActivity.status || null,
        dueLabel: nextActivity.dueLabel || null,
        overdue: nextActivity.overdue === true,
      },
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
      culturesCount: (cultivationState.cultures || []).length,
      dominantCulture: cultivationState.dominantCulture || null,
      speciesInProgressCount: (cultivationState.speciesInProgress || []).length,
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
      hasRecentNutritionAdjustmentRecord: fieldNotebookState.hasRecentNutritionAdjustmentRecord === true,
      hasRecentFieldNotes: fieldNotebookState.hasRecentFieldNotes === true,
      totalRecentNotes: fieldNotebookState.totalRecentNotes || 0,
      latestRecordType: fieldNotebookState.latestRecordType || null,
      latestNotesCount: (fieldNotebookState.latestNotes || []).length,
      sowingNotePresent: fieldNotebookState.sowingNotePresent === true,
    },
    infoCardsState: {
      todayCultivation: {
        tasksToday: todayCultivation.tasksToday || 0,
        overdueTasks: todayCultivation.overdueTasks || 0,
        nextTasksCount: (todayCultivation.nextTasks || []).length,
        pendingToday: todayCultivation.pendingToday || 0,
        overdue: todayCultivation.overdue || 0,
        activeLots: todayCultivation.activeLots || 0,
        upcomingHarvests: todayCultivation.upcomingHarvests || 0,
        alerts: todayCultivation.alerts || 0,
      },
      reservoirReport: {
        totalCount: reservoirReport.totalCount || 0,
        withSolutionCount: reservoirReport.withSolutionCount || 0,
        withoutSolutionCount: reservoirReport.withoutSolutionCount || 0,
      },
      dayProgress: {
        totalTasksToday: dayProgress.totalTasksToday || 0,
        completedTasksToday: dayProgress.completedTasksToday || 0,
        pendingTasksToday: dayProgress.pendingTasksToday || 0,
        total: dayProgress.total || 0,
        completed: dayProgress.completed || 0,
        pending: dayProgress.pending || 0,
        overdue: dayProgress.overdue || 0,
      },
      fieldNotesSummary: {
        totalRecentNotes: fieldNotesSummary.totalRecentNotes || fieldNotesSummary.total || 0,
        latestNotesCount: (fieldNotesSummary.latestNotes || []).length,
      },
    },
    testSequenceSignals: operationalContext.testSequenceSignals || {},
  };
}

function buildInstantPrompt({ navigationContext, sessionNavigations, operationalContext, clientCapabilities, signals }) {
  const dashboards = Object.values(DASHBOARD_CONFIG).map((dashboard) => ({
    id: dashboard.id,
    displayName: dashboard.displayName,
    cardType: dashboard.cardType,
  }));

  const agendaState = operationalContext.agendaState || {};
  const currentActivity = agendaState.nextActivity || {};
  const maxShortcuts = Math.max(1, clientCapabilities.maxShortcuts || 3);

  const promptPayload = {
    navigationContext,
    sessionNavigations,
    operationalContext: buildPromptOperationalContext(operationalContext),
    currentActivityContext: {
      title: currentActivity.title || null,
      description: currentActivity.description || null,
      type: currentActivity.type || null,
      status: currentActivity.status || null,
      dueLabel: currentActivity.dueLabel || null,
    },
    stepContext: {
      stepId: signals.stepId,
      targetRoute: signals.targetRoute,
      description: (signals.rulesApplied || []).join(', '),
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

OBSERVAÇÃO IMPORTANTE: targetRoute, ctaRoute e cada shortcut.route devem ser TODOS DIFERENTES entre si.
Nenhuma rota pode se repetir. Se uma rota já foi usada em targetRoute ou ctaRoute, escolha outra para os shortcuts.

Contexto da atividade atual disponível em currentActivityContext.
Use title e description para contextualizar as recomendações (title, description, actionLabel, reason).
NÃO repita o título da atividade como texto livre se ele contiver dados identificáveis.
Prefira generalizar: "Aplicação de nutrientes" → "atividade de aplicação".

Retorne APENAS JSON válido, sem markdown, seguindo o schema obrigatório:
{
  "responseVersion":"1.0",
  "confidence":0.0,
  "nextStepPrediction":{"stepId":"id do passo","targetRoute":"/rota","title":"texto curto","description":"texto curto","actionLabel":"texto curto"},
  "infoRecommendation":{"type":"${INFO_RECOMMENDATION_TYPES.join('|')}","source":"${INFO_RECOMMENDATION_SOURCES.join('|')}","priority":"${INFO_RECOMMENDATION_PRIORITIES.join('|')}","title":"texto curto","reason":"texto curto","ctaRoute":"/rota","category":"${INFO_RECOMMENDATION_CATEGORIES.join('|')}"},
  "shortcuts":[{"route":"/rota","confidence":0.0,"label":"texto curto","reason":"texto curto"}],
  "reason":"texto curto ou null",
  "reasonDetails":{"summary":"texto curto","details":["sinais técnicos"],"display":"info_icon"},
  "rulesApplied":["RULE-010"]
}

REGRAS:
- nextStepPrediction.targetRoute deve ser a rota MAIS importante para o passo atual.
- infoRecommendation.ctaRoute deve ser DIFERENTE de targetRoute.
- shortcuts deve respeitar clientCapabilities.maxShortcuts. Cada shortcut.route deve ser DIFERENTE de targetRoute e de ctaRoute.
- infoRecommendation.type deve usar um dos tipos permitidos.
- infoRecommendation.ctaRoute deve estar na allowlist da Info.
- shortcuts[].route deve estar em allowedRoutes.

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt, buildPromptOperationalContext };
