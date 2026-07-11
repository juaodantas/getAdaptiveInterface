function toBoolean(value) {
  return value === true;
}

function toSafeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 999) : 0;
}

function toSafeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 999999) : 0;
}

function toSafePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 100) : 0;
}

function toSafeText(value, maxLength = 120) {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) return null;

  return normalized.slice(0, maxLength);
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const NEXT_ACTIVITY_TYPES = ['nutritional_adjustment', 'harvest', 'inspection', 'irrigation', 'protocol_activity', 'sowing', 'task_review', 'task'];
const ACTIVITY_STATUSES = ['pending', 'completed', 'overdue', 'cancelled'];
const AGENDA_INTERACTION_TYPES = ['created', 'viewed', 'edited', 'completed', 'deleted'];
const DUE_LABELS = {
  hoje: 'today',
  today: 'today',
  amanha: 'tomorrow',
  amanhã: 'tomorrow',
  tomorrow: 'tomorrow',
  atrasado: 'overdue',
  overdue: 'overdue',
};
const RECORD_TYPES = ['nutrition_adjustment', 'nutritional_adjustment', 'harvest', 'inspection', 'irrigation', 'field_note'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ALERT_TYPES = ['critical', 'operational', 'agenda', 'production', 'protocol', 'nutrition'];
const RESERVOIR_LEVELS = ['unknown', 'low', 'normal', 'high', 'critical'];
const INFO_CONTEXT_TYPES = ['today_cultivation', 'reservoir_report', 'day_progress', 'field_notes_summary', 'basic_tip'];
const INFO_CONTEXT_CATEGORIES = ['geral', 'agenda', 'lote', 'protocolo', 'solucao', 'reservatorio', 'caderno_campo', 'cultivo'];
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function normalizeStringArray(values, maxItems = 8, maxLength = 80) {
  return Array.isArray(values)
    ? values.map((value) => toSafeText(value, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeTextOrObjectArray(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];

  return values.map((value) => {
    if (typeof value === 'string') return toSafeText(value, 80);
    const item = objectOrEmpty(value);
    if (Object.keys(item).length === 0) return null;
    return {
      id: toSafeText(item.id, 80),
      name: toSafeText(item.name || item.label || item.species, 80),
      quantity: toSafeCount(item.quantity || item.count),
      color: toSafeText(item.color, 30),
    };
  }).filter(Boolean).slice(0, maxItems);
}

function normalizeCultureReference(value) {
  if (typeof value === 'string') return toSafeText(value, 80);

  const item = objectOrEmpty(value);
  if (Object.keys(item).length === 0) return null;

  return {
    id: toSafeText(item.id, 80),
    name: toSafeText(item.name || item.label || item.culture, 80),
    quantity: toSafeCount(item.quantity || item.count),
    color: toSafeText(item.color, 30),
  };
}

function normalizeObjects(values, mapper, maxItems = 5) {
  return Array.isArray(values) ? values.map((item) => mapper(objectOrEmpty(item))).slice(0, maxItems) : [];
}

function normalizeBuckets(value, keys) {
  const input = objectOrEmpty(value);
  return Object.fromEntries(keys.map((key) => [key, toSafeCount(input[key])]));
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value.trim())) {
    return null;
  }

  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAllowedString(value, allowedValues) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : null;
}

function normalizeAllowedOrSafeString(value, allowedValues, maxLength = 60) {
  const allowed = normalizeAllowedString(value, allowedValues);
  return allowed || toSafeText(value, maxLength);
}

function normalizeMappedString(value, allowedMap) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return allowedMap[normalized] || null;
}

function normalizeSafeDimension(value, maxLength = 40) {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > maxLength) return null;

  return /^[a-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function firstSafeCount(...values) {
  for (const value of values) {
    if (Number.isInteger(value) && value >= 0) {
      return toSafeCount(value);
    }
  }

  return 0;
}

function normalizeRecentUserActions(values) {
  if (!Array.isArray(values)) return [];

  return values.map((value) => {
    const item = objectOrEmpty(value);
    const entityType = normalizeSafeDimension(item.entityType);
    const action = normalizeSafeDimension(item.action);
    const timestamp = normalizeIsoTimestamp(item.timestamp);

    if (!entityType || !action || !timestamp) return null;

    const normalized = { entityType, action, timestamp };
    const entityId = toSafeText(item.entityId, 80);
    if (entityId) normalized.entityId = entityId;

    return normalized;
  }).filter(Boolean).slice(0, 10);
}

function normalizeOperationalContext(raw) {
  const context = objectOrEmpty(raw);
  const dashboardState = objectOrEmpty(context.dashboardState);
  const agendaState = objectOrEmpty(context.agendaState);
  const fieldNotebookState = objectOrEmpty(context.fieldNotebookState);
  const reservoirState = objectOrEmpty(context.reservoirState);
  const infoContextState = objectOrEmpty(context.infoContextState);
  const infoCardsState = objectOrEmpty(context.infoCardsState);
  const productionState = objectOrEmpty(context.productionState);
  const cultivationState = objectOrEmpty(context.cultivationState);
  const teamState = objectOrEmpty(context.teamState);
  const alertState = objectOrEmpty(context.alertState);
  const testSequenceSignals = objectOrEmpty(context.testSequenceSignals);
  const nextActivity = objectOrEmpty(agendaState.nextActivity);
  const dueBuckets = normalizeBuckets(agendaState.dueBuckets, ['overdue', 'today', 'thisWeek', 'nextWeek']);
  const latestTasks = normalizeObjects(agendaState.latestTasks, (item) => ({
    id: toSafeText(item.id, 80),
    title: toSafeText(item.title, 100),
    type: normalizeAllowedString(item.type, NEXT_ACTIVITY_TYPES),
    status: normalizeAllowedString(item.status, ACTIVITY_STATUSES),
    dueLabel: normalizeMappedString(item.dueLabel, DUE_LABELS),
    lotId: toSafeText(item.lotId, 80),
    lotName: toSafeText(item.lotName, 80),
    overdue: toBoolean(item.overdue),
  }));
  const normalizedNextActivity = {
    id: toSafeText(nextActivity.id, 80),
    title: toSafeText(nextActivity.title, 100),
    description: toSafeText(nextActivity.description, 180),
    type: normalizeAllowedString(nextActivity.type, NEXT_ACTIVITY_TYPES),
    status: normalizeAllowedString(nextActivity.status, ACTIVITY_STATUSES),
    dueLabel: normalizeMappedString(nextActivity.dueLabel, DUE_LABELS),
    lotId: toSafeText(nextActivity.lotId, 80),
    lotName: toSafeText(nextActivity.lotName, 80),
    overdue: toBoolean(nextActivity.overdue),
  };
  const pendingToday = firstSafeCount(agendaState.pendingToday, agendaState.pendingActivitiesTodayCount, dueBuckets.today);
  const overdueCount = firstSafeCount(agendaState.overdueCount, agendaState.overdueActivitiesCount, dueBuckets.overdue);
  const hasOverdue = agendaState.hasOverdue === true || overdueCount > 0;
  const lastAgendaInteraction = normalizeAllowedString(agendaState.lastAgendaInteraction, AGENDA_INTERACTION_TYPES)
    || normalizeAllowedString(agendaState.lastInteractionType, AGENDA_INTERACTION_TYPES);
  const nextActivityType = normalizeAllowedString(agendaState.nextActivityType, NEXT_ACTIVITY_TYPES) || normalizedNextActivity.type;
  const nextActivityStatus = normalizeAllowedString(agendaState.nextActivityStatus, ACTIVITY_STATUSES) || normalizedNextActivity.status;
  const nextActivityDueLabel = normalizeMappedString(agendaState.nextActivityDueLabel, DUE_LABELS) || normalizedNextActivity.dueLabel;
  const nextActivityOverdue = agendaState.nextActivityOverdue === true || normalizedNextActivity.overdue;
  const hasProtocolTasks = agendaState.hasProtocolTasks === true || latestTasks.some((task) => task.type === 'protocol_activity');
  const hasRecentNotes = fieldNotebookState.hasRecentNotes === true || fieldNotebookState.hasRecentFieldNotes === true;
  const hasNutritionAdjustmentRecord = fieldNotebookState.hasNutritionAdjustmentRecord === true || fieldNotebookState.hasRecentNutritionAdjustmentRecord === true;
  const hasSowingNote = fieldNotebookState.hasSowingNote === true || fieldNotebookState.sowingNotePresent === true;
  const cultures = normalizeObjects(cultivationState.cultures, (item) => ({
    name: toSafeText(item.name, 80),
    quantity: toSafeCount(item.quantity),
    color: toSafeText(item.color, 30),
  }));
  const speciesInProgress = normalizeTextOrObjectArray(cultivationState.speciesInProgress);
  const culturesCount = firstSafeCount(cultivationState.culturesCount, cultures.length);
  const speciesInProgressCount = firstSafeCount(cultivationState.speciesInProgressCount, speciesInProgress.length);

  return {
    generatedAt: normalizeIsoTimestamp(context.generatedAt),
    dashboardState: {
      hasActiveLots: toBoolean(dashboardState.hasActiveLots),
      totalLots: toSafeCount(dashboardState.totalLots),
      activeLotsCount: toSafeCount(dashboardState.activeLotsCount),
      finishedLotsCount: toSafeCount(dashboardState.finishedLotsCount),
      completionRate: toSafePercent(dashboardState.completionRate),
      lotsByStatus: normalizeObjects(dashboardState.lotsByStatus, (item) => ({
        status: toSafeText(item.status, 40),
        count: toSafeCount(item.count),
      })),
      speciesInProgress: normalizeTextOrObjectArray(dashboardState.speciesInProgress),
      hasProtocolLinkedToLatestLot: toBoolean(dashboardState.hasProtocolLinkedToLatestLot),
      hasUpcomingHarvests: toBoolean(dashboardState.hasUpcomingHarvests),
    },
    agendaState: {
      hasGeneratedActivities: toBoolean(agendaState.hasGeneratedActivities),
      pendingToday,
      overdueCount,
      hasOverdue,
      nextActivityType,
      nextActivityStatus,
      nextActivityDueLabel,
      nextActivityOverdue,
      hasProtocolTasks,
      lastAgendaInteraction,
      pendingActivitiesTodayCount: toSafeCount(agendaState.pendingActivitiesTodayCount),
      pendingActivitiesWeekCount: toSafeCount(agendaState.pendingActivitiesWeekCount),
      overdueActivitiesCount: toSafeCount(agendaState.overdueActivitiesCount),
      completedActivitiesTodayCount: toSafeCount(agendaState.completedActivitiesTodayCount),
      dueBuckets,
      priorityBuckets: normalizeBuckets(agendaState.priorityBuckets, ['high', 'medium', 'low']),
      latestTasks,
      nextActivity: normalizedNextActivity,
      lastInteractionType: normalizeAllowedString(agendaState.lastInteractionType, AGENDA_INTERACTION_TYPES),
      lastActivityTitle: toSafeText(agendaState.lastActivityTitle, 100),
      lastActivityDescription: toSafeText(agendaState.lastActivityDescription, 180),
    },
    fieldNotebookState: {
      hasRecentNotes,
      hasNutritionAdjustmentRecord,
      hasSowingNote,
      hasRecentNutritionAdjustmentRecord: toBoolean(fieldNotebookState.hasRecentNutritionAdjustmentRecord),
      hasRecentFieldNotes: toBoolean(fieldNotebookState.hasRecentFieldNotes),
      totalRecentNotes: toSafeCount(fieldNotebookState.totalRecentNotes),
      uncheckedNotesCount: toSafeCount(fieldNotebookState.uncheckedNotesCount),
      latestRecordType: normalizeAllowedString(fieldNotebookState.latestRecordType, RECORD_TYPES),
      latestNotes: normalizeObjects(fieldNotebookState.latestNotes, (item) => ({
        id: toSafeText(item.id, 80),
        title: toSafeText(item.title, 100),
        description: toSafeText(item.description, 160),
        lotId: toSafeText(item.lotId, 80),
        lotName: toSafeText(item.lotName, 80),
        createdAt: normalizeIsoTimestamp(item.createdAt),
      })),
      sowingNotePresent: toBoolean(fieldNotebookState.sowingNotePresent),
    },
    reservoirState: {
      hasReservoirs: toBoolean(reservoirState.hasReservoirs),
      totalCount: toSafeCount(reservoirState.totalCount),
      totalVolume: toSafeNumber(reservoirState.totalVolume),
      withSolutionCount: toSafeCount(reservoirState.withSolutionCount),
      withoutSolutionCount: toSafeCount(reservoirState.withoutSolutionCount),
      activeLotsLinked: toSafeCount(reservoirState.activeLotsLinked),
      lowLevelCount: toSafeCount(reservoirState.lowLevelCount),
      criticalLevelCount: toSafeCount(reservoirState.criticalLevelCount),
      currentLevel: normalizeAllowedString(reservoirState.currentLevel, RESERVOIR_LEVELS),
      highlightedReservoirs: normalizeObjects(reservoirState.highlightedReservoirs, (item) => ({
        id: toSafeText(item.id, 80),
        name: toSafeText(item.name, 80),
        volume: toSafeNumber(item.volume),
        solutionName: toSafeText(item.solutionName, 80),
        electricalConductivity: toSafeNumber(item.electricalConductivity),
        level: normalizeAllowedString(item.level, RESERVOIR_LEVELS),
        hasSolution: toBoolean(item.hasSolution),
        linkedLotsCount: toSafeCount(item.linkedLotsCount),
      })),
    },
    infoContextState: {
      lastShownType: normalizeAllowedString(infoContextState.lastShownType, INFO_CONTEXT_TYPES),
      lastShownCategory: normalizeAllowedString(infoContextState.lastShownCategory, INFO_CONTEXT_CATEGORIES),
      dismissedTodayCount: toSafeCount(infoContextState.dismissedTodayCount),
      hasSeenInfoToday: toBoolean(infoContextState.hasSeenInfoToday),
    },
    productionState: {
      hasProductionData: toBoolean(productionState.hasProductionData),
      harvestedPlantsLast30d: toSafeCount(productionState.harvestedPlantsLast30d),
      producedPackagesLast30d: toSafeCount(productionState.producedPackagesLast30d),
      upcomingHarvestLots: toSafeCount(productionState.upcomingHarvestLots),
      periodStart: normalizeIsoTimestamp(productionState.periodStart),
      periodEnd: normalizeIsoTimestamp(productionState.periodEnd),
      monthlyProduction: normalizeObjects(productionState.monthlyProduction, (item) => ({
        month: toSafeText(item.month, 40),
        quantity: toSafeCount(item.quantity),
        label: toSafeText(item.label, 40),
        harvestedPlants: toSafeCount(item.harvestedPlants),
        producedPackages: toSafeCount(item.producedPackages),
      }), 6),
      averageRates: {
        plants: toSafeNumber(objectOrEmpty(productionState.averageRates).plants),
        packages: toSafeNumber(objectOrEmpty(productionState.averageRates).packages),
        germination: toSafeNumber(objectOrEmpty(productionState.averageRates).germination),
        transplant: toSafeNumber(objectOrEmpty(productionState.averageRates).transplant),
        packaging: toSafeNumber(objectOrEmpty(productionState.averageRates).packaging),
        global: toSafeNumber(objectOrEmpty(productionState.averageRates).global),
      },
      periodComparison: {
        harvestedPlantsDelta: toSafeNumber(objectOrEmpty(productionState.periodComparison).harvestedPlantsDelta),
        producedPackagesDelta: toSafeNumber(objectOrEmpty(productionState.periodComparison).producedPackagesDelta),
        harvestedPlants: toSafeCount(objectOrEmpty(productionState.periodComparison).harvestedPlants),
        percentageVariation: toSafeNumber(objectOrEmpty(productionState.periodComparison).percentageVariation),
      },
      topCulture: normalizeCultureReference(productionState.topCulture),
    },
    cultivationState: {
      culturesCount,
      speciesInProgressCount,
      cultures,
      dominantCulture: normalizeCultureReference(cultivationState.dominantCulture),
      speciesInProgress,
    },
    teamState: {
      activeMembers: toSafeCount(teamState.activeMembers),
      averageCompletionRate: toSafePercent(teamState.averageCompletionRate),
      onTimeActivities: toSafeCount(teamState.onTimeActivities),
      overdueActivities: toSafeCount(teamState.overdueActivities),
    },
    alertState: {
      hasCriticalAlerts: toBoolean(alertState.hasCriticalAlerts),
      criticalCount: toSafeCount(alertState.criticalCount),
      highestSeverity: normalizeAllowedString(alertState.highestSeverity, SEVERITIES),
      types: Array.isArray(alertState.types)
        ? alertState.types.map((type) => normalizeAllowedOrSafeString(type, ALERT_TYPES, 40)).filter(Boolean).slice(0, 10)
        : [],
      items: normalizeObjects(alertState.items, (item) => ({
        type: normalizeAllowedOrSafeString(item.type, ALERT_TYPES, 40),
        message: toSafeText(item.message, 140),
        lotId: toSafeText(item.lotId, 80),
        lotName: toSafeText(item.lotName, 80),
        severity: normalizeAllowedOrSafeString(item.severity, SEVERITIES, 40),
        date: normalizeIsoTimestamp(item.date),
      })),
    },
    infoCardsState: {
      todayCultivation: {
        tasksToday: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).tasksToday),
        overdueTasks: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).overdueTasks),
        nextTasks: normalizeObjects(objectOrEmpty(infoCardsState.todayCultivation).nextTasks, (item) => ({
          title: toSafeText(item.title, 100),
          type: normalizeAllowedOrSafeString(item.type, NEXT_ACTIVITY_TYPES, 40),
          dueLabel: normalizeMappedString(item.dueLabel, DUE_LABELS),
        })),
        pendingToday: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).pendingToday),
        overdue: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).overdue),
        activeLots: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).activeLots),
        upcomingHarvests: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).upcomingHarvests),
        alerts: toSafeCount(objectOrEmpty(infoCardsState.todayCultivation).alerts),
      },
      reservoirReport: {
        totalCount: toSafeCount(objectOrEmpty(infoCardsState.reservoirReport).totalCount),
        withSolutionCount: toSafeCount(objectOrEmpty(infoCardsState.reservoirReport).withSolutionCount),
        withoutSolutionCount: toSafeCount(objectOrEmpty(infoCardsState.reservoirReport).withoutSolutionCount),
      },
      dayProgress: {
        totalTasksToday: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).totalTasksToday),
        completedTasksToday: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).completedTasksToday),
        pendingTasksToday: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).pendingTasksToday),
        completionLabel: toSafeText(objectOrEmpty(infoCardsState.dayProgress).completionLabel, 80),
        nextTask: toSafeText(objectOrEmpty(infoCardsState.dayProgress).nextTask, 100),
        total: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).total),
        completed: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).completed),
        pending: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).pending),
        overdue: toSafeCount(objectOrEmpty(infoCardsState.dayProgress).overdue),
        label: toSafeText(objectOrEmpty(infoCardsState.dayProgress).label, 80),
      },
      fieldNotesSummary: {
        totalRecentNotes: toSafeCount(objectOrEmpty(infoCardsState.fieldNotesSummary).totalRecentNotes),
        total: toSafeCount(objectOrEmpty(infoCardsState.fieldNotesSummary).total),
        latestNotes: normalizeObjects(objectOrEmpty(infoCardsState.fieldNotesSummary).latestNotes, (item) => ({
          title: toSafeText(item.title, 100),
          createdAt: normalizeIsoTimestamp(item.createdAt),
        })),
      },
    },
    testSequenceSignals: {
      lotWithProtocolCreated: toBoolean(testSequenceSignals.lotWithProtocolCreated),
      generatedActivitiesSeen: toBoolean(testSequenceSignals.generatedActivitiesSeen),
      adjustmentRecorded: toBoolean(testSequenceSignals.adjustmentRecorded || testSequenceSignals.nutritionAdjustmentExecuted),
      fieldNotebookChecked: toBoolean(testSequenceSignals.fieldNotebookChecked),
      agendaActivitiesCompleted: toBoolean(testSequenceSignals.agendaActivitiesCompleted),
      finalHomeChecked: toBoolean(testSequenceSignals.finalHomeChecked),
      lastRelevantEvent: toSafeText(testSequenceSignals.lastRelevantEvent, 80),
      changedAt: normalizeIsoTimestamp(testSequenceSignals.changedAt),
    },
    recentUserActions: normalizeRecentUserActions(context.recentUserActions),
  };
}

module.exports = { normalizeOperationalContext, normalizeIsoTimestamp };
