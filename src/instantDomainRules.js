const RULE_IDS = {
  NO_PROTOCOL_LOT: 'RULE-001',
  CHECK_GENERATED_ACTIVITIES: 'RULE-002',
  RECORD_CADERNO_ADJUSTMENT: 'RULE-003',
  FINISH_AGENDA_ACTIVITIES: 'RULE-004',
  REVIEW_FINAL_HOME: 'RULE-005',
  TEST_COMPLETE: 'RULE-006',
  OVERDUE_TASKS: 'RULE-007',
  CRITICAL_ALERTS: 'RULE-008',
  AVOID_EMPTY_PRODUCTION: 'RULE-009',
  NO_PROGRESS_BAR: 'RULE-010',
};

const DOMAIN_RULES = [
  { id: RULE_IDS.NO_PROTOCOL_LOT, description: 'Não há lote com protocolo: recomendar cadastro de lote com protocolo.' },
  { id: RULE_IDS.CHECK_GENERATED_ACTIVITIES, description: 'Lote com protocolo criado e atividades geradas não conferidas: recomendar Agenda.' },
  { id: RULE_IDS.RECORD_CADERNO_ADJUSTMENT, description: 'Atividades vistas e ajuste não registrado: recomendar Caderno de Campo.' },
  { id: RULE_IDS.FINISH_AGENDA_ACTIVITIES, description: 'Ajuste registrado e atividades pendentes: recomendar conclusão na Agenda.' },
  { id: RULE_IDS.REVIEW_FINAL_HOME, description: 'Atividades concluídas: recomendar conferência final pela Home.' },
  { id: RULE_IDS.TEST_COMPLETE, description: 'Roteiro concluído: exibir estado de conclusão.' },
  { id: RULE_IDS.OVERDUE_TASKS, description: 'Há tarefas atrasadas: priorizar Agenda/tarefas sobre produção.' },
  { id: RULE_IDS.CRITICAL_ALERTS, description: 'Há alertas críticos: priorizar atenção operacional.' },
  { id: RULE_IDS.AVOID_EMPTY_PRODUCTION, description: 'Não há dados de produção: usar contexto/onboarding, não destacar produção vazia.' },
  { id: RULE_IDS.NO_PROGRESS_BAR, description: 'Componente de progresso, stepper ou checklist é proibido.' },
];

const STEP_ROUTE_RANKING = {
  create_lot_with_protocol: [
    '/protocoloPage',
    '/lotePage',
    '/areaCultivoPage',
    '/agendaPage',
    '/solucaoPage',
    '/relatoriosPage',
  ],
  check_generated_activities: [
    '/agendaPage',
    '/lotePage',
    '/protocoloPage',
    '/cadernoCampoPage',
    '/relatoriosPage',
    '/solucaoPage',
  ],
  record_caderno_adjustment: [
    '/cadernoCampoPage',
    '/solucaoPage',
    '/agendaPage',
    '/relatoriosPage',
    '/protocoloPage',
    '/historicoPage',
  ],
  finish_agenda_activities: [
    '/agendaPage',
    '/cadernoCampoPage',
    '/relatoriosPage',
    '/solucaoPage',
    '/gerenciarEquipePage',
    '/historicoPage',
  ],
  review_final_home: [
    '/relatoriosPage',
    '/agendaPage',
    '/solucaoPage',
    '/historicoPage',
    '/gerenciarEquipePage',
    '/cadernoCampoPage',
  ],
  test_complete: [
    '/relatoriosPage',
    '/agendaPage',
    '/protocoloPage',
    '/historicoPage',
    '/gerenciarEquipePage',
    '/cadernoCampoPage',
  ],
  review_critical_alerts: [
    '/agendaPage',
    '/gerenciarEquipePage',
    '/relatoriosPage',
    '/historicoPage',
    '/cadernoCampoPage',
    '/solucaoPage',
  ],
  resolve_overdue_tasks: [
    '/agendaPage',
    '/gerenciarEquipePage',
    '/relatoriosPage',
    '/cadernoCampoPage',
    '/historicoPage',
    '/solucaoPage',
  ],
};

function deriveInstantSignals(context) {
  const dashboard = context.dashboardState;
  const agenda = context.agendaState;
  const notebook = context.fieldNotebookState;
  const production = context.productionState;
  const alerts = context.alertState;
  const sequence = context.testSequenceSignals;
  const rulesApplied = [RULE_IDS.NO_PROGRESS_BAR];

  // Priority 1: Critical alerts override sequence
  if (alerts.hasCriticalAlerts || alerts.criticalCount > 0) {
    rulesApplied.push(RULE_IDS.CRITICAL_ALERTS);
    return { stepId: 'review_critical_alerts', targetRoute: '/agendaPage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, ranking: STEP_ROUTE_RANKING.review_critical_alerts };
  }

  // Priority 2: Overdue tasks with no sequence
  if (agenda.overdueActivitiesCount > 0 && !sequence.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.OVERDUE_TASKS);
    return { stepId: 'resolve_overdue_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.resolve_overdue_tasks };
  }

  // Step 1: No protocol lot
  if (!dashboard.hasProtocolLinkedToLatestLot && !sequence.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.NO_PROTOCOL_LOT);
    return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied, ranking: STEP_ROUTE_RANKING.create_lot_with_protocol };
  }

  // Step 2: Protocol created, activities not yet seen
  if ((dashboard.hasProtocolLinkedToLatestLot || sequence.lotWithProtocolCreated) && !sequence.generatedActivitiesSeen) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'check_generated_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.check_generated_activities };
  }

  // Step 3: Activities seen, adjustment not yet recorded in caderno
  if (sequence.generatedActivitiesSeen && !sequence.adjustmentRecorded) {
    rulesApplied.push(RULE_IDS.RECORD_CADERNO_ADJUSTMENT);
    return { stepId: 'record_caderno_adjustment', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.record_caderno_adjustment };
  }

  // Step 4: Adjustment recorded, agenda activities pending
  if (sequence.adjustmentRecorded && agenda.pendingActivitiesTodayCount > 0 && !sequence.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_ACTIVITIES);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.finish_agenda_activities };
  }

  // Step 5: All done, final home review
  if (sequence.agendaActivitiesCompleted && !sequence.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.REVIEW_FINAL_HOME);
    return { stepId: 'review_final_home', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.review_final_home };
  }

  // Step 6 (terminal): Test complete
  if (sequence.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.TEST_COMPLETE);
    return { stepId: 'test_complete', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, ranking: STEP_ROUTE_RANKING.test_complete };
  }

  // No production data - avoid empty production
  if (!production.hasProductionData) {
    rulesApplied.push(RULE_IDS.AVOID_EMPTY_PRODUCTION);
  }

  return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied, ranking: STEP_ROUTE_RANKING.create_lot_with_protocol };
}

module.exports = {
  RULE_IDS,
  DOMAIN_RULES,
  deriveInstantSignals,
  STEP_ROUTE_RANKING,
};
