function toBoolean(value) {
  return value === true;
}

function toSafeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 999) : 0;
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const NEXT_ACTIVITY_TYPES = ['nutritional_adjustment', 'harvest', 'inspection', 'irrigation', 'protocol_activity'];
const ACTIVITY_STATUSES = ['pending', 'completed', 'overdue', 'cancelled'];
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
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

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

function normalizeMappedString(value, allowedMap) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return allowedMap[normalized] || null;
}

function normalizeOperationalContext(raw) {
  const context = objectOrEmpty(raw);
  const dashboardState = objectOrEmpty(context.dashboardState);
  const agendaState = objectOrEmpty(context.agendaState);
  const fieldNotebookState = objectOrEmpty(context.fieldNotebookState);
  const reservoirState = objectOrEmpty(context.reservoirState);
  const infoContextState = objectOrEmpty(context.infoContextState);
  const productionState = objectOrEmpty(context.productionState);
  const alertState = objectOrEmpty(context.alertState);
  const testSequenceSignals = objectOrEmpty(context.testSequenceSignals);
  const nextActivity = objectOrEmpty(agendaState.nextActivity);

  return {
    generatedAt: normalizeIsoTimestamp(context.generatedAt),
    dashboardState: {
      hasActiveLots: toBoolean(dashboardState.hasActiveLots),
      activeLotsCount: toSafeCount(dashboardState.activeLotsCount),
      finishedLotsCount: toSafeCount(dashboardState.finishedLotsCount),
      hasProtocolLinkedToLatestLot: toBoolean(dashboardState.hasProtocolLinkedToLatestLot),
      hasUpcomingHarvests: toBoolean(dashboardState.hasUpcomingHarvests),
    },
    agendaState: {
      hasGeneratedActivities: toBoolean(agendaState.hasGeneratedActivities),
      pendingActivitiesTodayCount: toSafeCount(agendaState.pendingActivitiesTodayCount),
      overdueActivitiesCount: toSafeCount(agendaState.overdueActivitiesCount),
      completedActivitiesTodayCount: toSafeCount(agendaState.completedActivitiesTodayCount),
      nextActivity: {
        type: normalizeAllowedString(nextActivity.type, NEXT_ACTIVITY_TYPES),
        status: normalizeAllowedString(nextActivity.status, ACTIVITY_STATUSES),
        dueLabel: normalizeMappedString(nextActivity.dueLabel, DUE_LABELS),
      },
    },
    fieldNotebookState: {
      hasRecentNutritionAdjustmentRecord: toBoolean(fieldNotebookState.hasRecentNutritionAdjustmentRecord),
      hasRecentFieldNotes: toBoolean(fieldNotebookState.hasRecentFieldNotes),
      uncheckedNotesCount: toSafeCount(fieldNotebookState.uncheckedNotesCount),
      latestRecordType: normalizeAllowedString(fieldNotebookState.latestRecordType, RECORD_TYPES),
    },
    reservoirState: {
      hasReservoirs: toBoolean(reservoirState.hasReservoirs),
      totalCount: toSafeCount(reservoirState.totalCount),
      lowLevelCount: toSafeCount(reservoirState.lowLevelCount),
      criticalLevelCount: toSafeCount(reservoirState.criticalLevelCount),
      currentLevel: normalizeAllowedString(reservoirState.currentLevel, RESERVOIR_LEVELS),
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
    },
    alertState: {
      hasCriticalAlerts: toBoolean(alertState.hasCriticalAlerts),
      criticalCount: toSafeCount(alertState.criticalCount),
      highestSeverity: normalizeAllowedString(alertState.highestSeverity, SEVERITIES),
      types: Array.isArray(alertState.types)
        ? alertState.types.map((type) => normalizeAllowedString(type, ALERT_TYPES)).filter(Boolean).slice(0, 10)
        : [],
    },
    testSequenceSignals: {
      lotWithProtocolCreated: toBoolean(testSequenceSignals.lotWithProtocolCreated),
      generatedActivitiesSeen: toBoolean(testSequenceSignals.generatedActivitiesSeen),
      nutritionAdjustmentExecuted: toBoolean(testSequenceSignals.nutritionAdjustmentExecuted),
      fieldNotebookChecked: toBoolean(testSequenceSignals.fieldNotebookChecked),
      agendaActivitiesCompleted: toBoolean(testSequenceSignals.agendaActivitiesCompleted),
      finalHomeChecked: toBoolean(testSequenceSignals.finalHomeChecked),
    },
  };
}

module.exports = { normalizeOperationalContext, normalizeIsoTimestamp };
