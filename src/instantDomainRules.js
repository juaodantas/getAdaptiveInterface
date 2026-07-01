const RULE_IDS = {
  NO_PROTOCOL_LOT: 'RULE-001',
  AGENDA_AFTER_LOT_WITH_PROTOCOL: 'RULE-002',
  PENDING_NUTRITION_ADJUSTMENT: 'RULE-003',
  FIELD_NOTEBOOK_AFTER_ADJUSTMENT: 'RULE-004',
  FINISH_AGENDA_AFTER_NOTEBOOK: 'RULE-005',
  FINAL_HOME_CHECK: 'RULE-006',
  OVERDUE_TASKS: 'RULE-007',
  CRITICAL_ALERTS: 'RULE-008',
  AVOID_EMPTY_PRODUCTION: 'RULE-009',
  NO_PROGRESS_BAR: 'RULE-010',
};

const DOMAIN_RULES = [
  { id: RULE_IDS.NO_PROTOCOL_LOT, description: 'Não há lote com protocolo: recomendar cadastro de lote com protocolo.' },
  { id: RULE_IDS.AGENDA_AFTER_LOT_WITH_PROTOCOL, description: 'Lote com protocolo criado e atividades geradas não conferidas: recomendar Agenda.' },
  { id: RULE_IDS.PENDING_NUTRITION_ADJUSTMENT, description: 'Próxima atividade é ajuste nutricional e ainda não foi executada: recomendar execução do ajuste.' },
  { id: RULE_IDS.FIELD_NOTEBOOK_AFTER_ADJUSTMENT, description: 'Ajuste executado e registro recente existe: recomendar Caderno de Campo.' },
  { id: RULE_IDS.FINISH_AGENDA_AFTER_NOTEBOOK, description: 'Caderno conferido e ainda há pendências: recomendar conclusão na Agenda.' },
  { id: RULE_IDS.FINAL_HOME_CHECK, description: 'Atividades concluídas: recomendar conferência final sem destacar progresso visual.' },
  { id: RULE_IDS.OVERDUE_TASKS, description: 'Há tarefas atrasadas: priorizar Agenda/tarefas sobre produção.' },
  { id: RULE_IDS.CRITICAL_ALERTS, description: 'Há alertas críticos: priorizar atenção operacional.' },
  { id: RULE_IDS.AVOID_EMPTY_PRODUCTION, description: 'Não há dados de produção: usar contexto/onboarding, não destacar produção vazia.' },
  { id: RULE_IDS.NO_PROGRESS_BAR, description: 'Componente de progresso, stepper ou checklist é proibido.' },
];

function deriveInstantSignals(context) {
  const dashboard = context.dashboardState;
  const agenda = context.agendaState;
  const notebook = context.fieldNotebookState;
  const production = context.productionState;
  const alerts = context.alertState;
  const sequence = context.testSequenceSignals;
  const rulesApplied = [RULE_IDS.NO_PROGRESS_BAR];

  if (alerts.hasCriticalAlerts || alerts.criticalCount > 0) {
    rulesApplied.push(RULE_IDS.CRITICAL_ALERTS);
    return { stepId: 'review_critical_alerts', targetRoute: '/agendaPage', dashboardId: 'SAUDE_EQUIPES', rulesApplied };
  }

  if (agenda.overdueActivitiesCount > 0) {
    rulesApplied.push(RULE_IDS.OVERDUE_TASKS);
    return { stepId: 'resolve_overdue_agenda_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (!dashboard.hasProtocolLinkedToLatestLot && !sequence.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.NO_PROTOCOL_LOT);
    return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied };
  }

  if ((dashboard.hasProtocolLinkedToLatestLot || sequence.lotWithProtocolCreated) && !sequence.generatedActivitiesSeen) {
    rulesApplied.push(RULE_IDS.AGENDA_AFTER_LOT_WITH_PROTOCOL);
    return { stepId: 'check_generated_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (agenda.nextActivity.type === 'nutritional_adjustment' && !sequence.nutritionAdjustmentExecuted) {
    rulesApplied.push(RULE_IDS.PENDING_NUTRITION_ADJUSTMENT);
    return { stepId: 'execute_nutrition_adjustment', targetRoute: '/solucaoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (sequence.nutritionAdjustmentExecuted && notebook.hasRecentNutritionAdjustmentRecord && !sequence.fieldNotebookChecked) {
    rulesApplied.push(RULE_IDS.FIELD_NOTEBOOK_AFTER_ADJUSTMENT);
    return { stepId: 'check_field_notebook', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (sequence.fieldNotebookChecked && agenda.pendingActivitiesTodayCount > 0 && !sequence.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_AFTER_NOTEBOOK);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (sequence.agendaActivitiesCompleted || sequence.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.FINAL_HOME_CHECK);
    return { stepId: 'review_final_home_context', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
  }

  if (!production.hasProductionData) {
    rulesApplied.push(RULE_IDS.AVOID_EMPTY_PRODUCTION);
  }

  return { stepId: 'review_agenda_context', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied };
}

module.exports = {
  RULE_IDS,
  DOMAIN_RULES,
  deriveInstantSignals,
};
