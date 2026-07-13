const RULE_IDS = {
  NO_PROTOCOL_LOT: 'RULE-001',
  CHECK_GENERATED_ACTIVITIES: 'RULE-002',
  RECORD_CADERNO_ADJUSTMENT: 'RULE-003',
  FINISH_AGENDA_ACTIVITIES: 'RULE-004',
  REVIEW_FINAL_HOME: 'RULE-005',
  OVERDUE_TASKS: 'RULE-007',
  CRITICAL_ALERTS: 'RULE-008',
  AVOID_EMPTY_PRODUCTION: 'RULE-009',
  NO_PROGRESS_BAR: 'RULE-010',
  TODAY_TASKS: 'RULE-011',
  FIELD_NOTEBOOK: 'RULE-012',
  RESERVOIR_ATTENTION: 'RULE-013',
  PRODUCTION_CONTEXT: 'RULE-014',
  TEAM_CONTEXT: 'RULE-015',
  PLAN_NEXT_LOT: 'RULE-016',
};

const DOMAIN_RULES = [
  { id: RULE_IDS.NO_PROTOCOL_LOT, description: 'Não há lote com protocolo: recomendar cadastro de lote com protocolo.' },
  { id: RULE_IDS.CHECK_GENERATED_ACTIVITIES, description: 'Lote com protocolo criado e atividades geradas não conferidas: recomendar Agenda.' },
  { id: RULE_IDS.RECORD_CADERNO_ADJUSTMENT, description: 'Atividades vistas e ajuste não registrado: recomendar Caderno de Campo.' },
  { id: RULE_IDS.FINISH_AGENDA_ACTIVITIES, description: 'Ajuste registrado e atividades pendentes: recomendar conclusão na Agenda.' },
  { id: RULE_IDS.REVIEW_FINAL_HOME, description: 'Atividades concluídas: recomendar conferência final pela Home.' },
  { id: RULE_IDS.OVERDUE_TASKS, description: 'Há tarefas atrasadas: priorizar Agenda/tarefas sobre produção.' },
  { id: RULE_IDS.CRITICAL_ALERTS, description: 'Há alertas críticos: priorizar atenção operacional.' },
  { id: RULE_IDS.AVOID_EMPTY_PRODUCTION, description: 'Não há dados de produção: usar contexto/onboarding, não destacar produção vazia.' },
  { id: RULE_IDS.NO_PROGRESS_BAR, description: 'Componente de progresso, stepper ou checklist é proibido.' },
  { id: RULE_IDS.TODAY_TASKS, description: 'Há tarefas de hoje ou próxima tarefa: priorizar Agenda.' },
  { id: RULE_IDS.FIELD_NOTEBOOK, description: 'Há registros recentes no Caderno de Campo: recomendar conferência do caderno.' },
  { id: RULE_IDS.RESERVOIR_ATTENTION, description: 'Há sinais de reservatório ou solução nutritiva: recomendar reservatórios/solução.' },
  { id: RULE_IDS.PRODUCTION_CONTEXT, description: 'Há dados de produção ou cultivo: recomendar resumo operacional.' },
  { id: RULE_IDS.TEAM_CONTEXT, description: 'Há sinais de equipe: recomendar saúde da equipe.' },
  { id: RULE_IDS.PLAN_NEXT_LOT, description: 'Há lote ativo com protocolo e nenhuma urgência operacional no momento.' },
];

const ROUTE_CONFLICT_RESOLVER = {
  create_lot_with_protocol: {
    '/lotePage': '/protocoloPage',
    '/protocoloPage': '/areaCultivoPage',
    '/areaCultivoPage': '/protocoloPage',
  },
  plan_next_lot: {
    '/lotePage': '/protocoloPage',
    '/protocoloPage': '/areaCultivoPage',
    '/areaCultivoPage': '/relatoriosPage',
  },
  check_generated_activities: {
    '/agendaPage': '/lotePage',
    '/lotePage': '/cadernoCampoPage',
    '/cadernoCampoPage': '/protocoloPage',
  },
  record_caderno_adjustment: {
    '/cadernoCampoPage': '/agendaPage',
    '/agendaPage': '/lotePage',
    '/lotePage': '/relatoriosPage',
  },
  finish_agenda_activities: {
    '/agendaPage': '/cadernoCampoPage',
    '/cadernoCampoPage': '/lotePage',
    '/lotePage': '/historicoPage',
  },
  review_final_home: {
    '/lotePage': '/cadernoCampoPage',
    '/cadernoCampoPage': '/agendaPage',
    '/agendaPage': '/relatoriosPage',
  },
  review_critical_alerts: {
    '/agendaPage': '/gerenciarEquipePage',
    '/gerenciarEquipePage': '/relatoriosPage',
    '/relatoriosPage': '/agendaPage',
  },
  resolve_overdue_tasks: {
    '/agendaPage': '/gerenciarEquipePage',
    '/gerenciarEquipePage': '/relatoriosPage',
    '/relatoriosPage': '/agendaPage',
  },
  review_today_tasks: { '/agendaPage': '/cadernoCampoPage', '/cadernoCampoPage': '/solucaoPage', '/solucaoPage': '/relatoriosPage' },
  review_protocol_tasks: { '/agendaPage': '/lotePage', '/lotePage': '/protocoloPage', '/protocoloPage': '/areaCultivoPage' },
  review_field_notes: { '/cadernoCampoPage': '/agendaPage', '/agendaPage': '/lotePage', '/lotePage': '/relatoriosPage' },
  review_reservoirs: { '/reservatoriosPage': '/solucaoPage', '/solucaoPage': '/agendaPage', '/agendaPage': '/relatoriosPage' },
  review_production: { '/relatoriosPage': '/lotePage', '/lotePage': '/areaCultivoPage', '/areaCultivoPage': '/agendaPage' },
  review_team: { '/gerenciarEquipePage': '/agendaPage', '/agendaPage': '/relatoriosPage', '/relatoriosPage': '/areaCultivoPage' },
};

const STEP_SHORTCUTS = {
  create_lot_with_protocol: [
    { route: '/lotePage', label: 'Criar primeiro lote', description: 'Comece vinculando um protocolo ao lote', group: 'primary' },
    { route: '/protocoloPage', label: 'Ver protocolos de cultivo', description: 'Consulte os protocolos de cultivo disponíveis', group: 'secondary' },
    { route: '/areaCultivoPage', label: 'Configurar estrutura', description: 'Configure a estrutura de áreas de cultivo', group: 'contextual' },
  ],
  plan_next_lot: [
    { route: '/lotePage', label: 'Planejar próximo lote', description: 'Prepare a criação do próximo lote', group: 'primary' },
    { route: '/protocoloPage', label: 'Ver protocolos', description: 'Revise protocolos disponíveis antes de iniciar', group: 'secondary' },
    { route: '/areaCultivoPage', label: 'Revisar estrutura', description: 'Confira a capacidade disponível para o próximo lote', group: 'contextual' },
  ],
  check_generated_activities: [
    { route: '/agendaPage', label: 'Ver Agenda', description: 'Confira as atividades geradas para o primeiro dia', group: 'primary' },
    { route: '/lotePage', label: 'Ver Lote', description: 'Consulte o lote vinculado ao protocolo', group: 'secondary' },
    { route: '/cadernoCampoPage', label: 'Abrir caderno de campo', description: 'Acesse o caderno de campo', group: 'contextual' },
  ],
  record_caderno_adjustment: [
    { route: '/cadernoCampoPage', label: 'Caderno de Campo', description: 'Registre a atividade no caderno de campo', group: 'primary' },
    { route: '/agendaPage', label: 'Ver Agenda', description: 'Consulte a programação de atividades', group: 'secondary' },
    { route: '/lotePage', label: 'Ver Lote', description: 'Veja os detalhes do lote', group: 'contextual' },
  ],
  finish_agenda_activities: [
    { route: '/agendaPage', label: 'Concluir na Agenda', description: 'Finalize as atividades pendentes na agenda', group: 'primary' },
    { route: '/cadernoCampoPage', label: 'Caderno de Campo', description: 'Confira os últimos registros no caderno', group: 'secondary' },
    { route: '/lotePage', label: 'Ver Lote', description: 'Acompanhe o lote em produção', group: 'contextual' },
  ],
  review_final_home: [
    { route: '/lotePage', label: 'Ver Lote', description: 'Revise o lote em acompanhamento', group: 'primary' },
    { route: '/cadernoCampoPage', label: 'Caderno de Campo', description: 'Confira os registros do caderno', group: 'secondary' },
    { route: '/agendaPage', label: 'Ver Agenda', description: 'Acompanhe o histórico de atividades', group: 'contextual' },
  ],
  review_critical_alerts: [
    { route: '/agendaPage', label: 'Ver Alertas', description: 'Revise os alertas críticos operacionais', group: 'primary' },
    { route: '/gerenciarEquipePage', label: 'Gerenciar Equipe', description: 'Verifique a alocação da equipe', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Relatórios', description: 'Acesse relatórios de ocorrências', group: 'contextual' },
  ],
  resolve_overdue_tasks: [
    { route: '/agendaPage', label: 'Ver Tarefas', description: 'Resolva as tarefas atrasadas na agenda', group: 'primary' },
    { route: '/gerenciarEquipePage', label: 'Equipe', description: 'Atribua tarefas à equipe', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Relatórios', description: 'Veja o relatório de atrasos', group: 'contextual' },
  ],
  review_today_tasks: [{ route: '/agendaPage', label: 'Ver Agenda', description: 'Priorize as atividades de hoje', group: 'primary' }, { route: '/cadernoCampoPage', label: 'Caderno', description: 'Registre evidências das atividades', group: 'secondary' }, { route: '/solucaoPage', label: 'Solução', description: 'Confira ajustes ligados ao cultivo', group: 'contextual' }, { route: '/relatoriosPage', label: 'Resumo', description: 'Acompanhe o andamento do dia', group: 'contextual' }],
  review_protocol_tasks: [{ route: '/agendaPage', label: 'Atividades', description: 'Confira tarefas geradas por protocolo', group: 'primary' }, { route: '/lotePage', label: 'Lote', description: 'Revise o lote vinculado', group: 'secondary' }, { route: '/protocoloPage', label: 'Protocolo', description: 'Consulte o protocolo aplicado', group: 'contextual' }, { route: '/areaCultivoPage', label: 'Área Cultivo', description: 'Veja o contexto do cultivo', group: 'contextual' }],
  review_field_notes: [{ route: '/cadernoCampoPage', label: 'Caderno', description: 'Confira registros recentes do campo', group: 'primary' }, { route: '/agendaPage', label: 'Agenda', description: 'Relacione registros com atividades', group: 'secondary' }, { route: '/lotePage', label: 'Lote', description: 'Veja o lote relacionado', group: 'contextual' }],
  review_reservoirs: [{ route: '/reservatoriosPage', label: 'Reservatórios', description: 'Revise reservatórios e níveis', group: 'primary' }, { route: '/solucaoPage', label: 'Solução', description: 'Confira solução nutritiva', group: 'secondary' }, { route: '/agendaPage', label: 'Agenda', description: 'Planeje ações relacionadas', group: 'contextual' }],
  review_production: [{ route: '/relatoriosPage', label: 'Produção', description: 'Veja o resumo de produção', group: 'primary' }, { route: '/lotePage', label: 'Lotes', description: 'Confira lotes em produção', group: 'secondary' }, { route: '/areaCultivoPage', label: 'Cultivo', description: 'Acompanhe culturas em andamento', group: 'contextual' }],
  review_team: [{ route: '/gerenciarEquipePage', label: 'Equipe', description: 'Revise saúde operacional da equipe', group: 'primary' }, { route: '/agendaPage', label: 'Agenda', description: 'Acompanhe atividades da equipe', group: 'secondary' }, { route: '/relatoriosPage', label: 'Relatórios', description: 'Veja indicadores da equipe', group: 'contextual' }],
};

function applyShortcutConfidence(shortcuts, baseConfidence) {
  return shortcuts.map((shortcut, index) => {
    const multiplier = index === 0 ? 1.0 : index === 1 ? 0.85 : 0.75;
    return {
      ...shortcut,
      confidence: Math.round(baseConfidence * multiplier * 100) / 100,
    };
  });
}

function hasRecentUserAction(actions, entityTypes, actionTypes) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return false;
  }

  return actions.some((item) => entityTypes.includes(item.entityType) && actionTypes.includes(item.action));
}

function hasSafeProtocolId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasProtocolIdEvidence(dashboard) {
  return hasSafeProtocolId(dashboard.latestLotProtocolId)
    || hasSafeProtocolId(dashboard.selectedLotProtocolId)
    || (Array.isArray(dashboard.activeLotProtocolIds) && dashboard.activeLotProtocolIds.some(hasSafeProtocolId));
}

function deriveInstantSignals(context, options = {}) {
  const dashboard = context.dashboardState;
  const agenda = context.agendaState;
  const notebook = context.fieldNotebookState;
  const reservoir = context.reservoirState;
  const production = context.productionState;
  const cultivation = context.cultivationState || {};
  const team = context.teamState || {};
  const alerts = context.alertState;
  const testSequence = context.testSequenceSignals || {};
  const recentUserActions = context.recentUserActions || [];
  const rulesApplied = [RULE_IDS.NO_PROGRESS_BAR];
  const hasActiveLot = dashboard.hasActiveLots || dashboard.activeLotsCount > 0;
  const positiveProtocolEvidence = dashboard.hasProtocolLinkedToLatestLot
    || dashboard.hasProtocolLinkedToActiveLot
    || hasProtocolIdEvidence(dashboard)
    || agenda.hasProtocolTasks
    || agenda.nextActivityType === 'protocol_activity'
    || (agenda.latestTasks || []).some((task) => task.type === 'protocol_activity')
    || testSequence.lotWithProtocolCreated === true;

  const effective = {
    lotWithProtocolCreated: positiveProtocolEvidence
      || (hasActiveLot && agenda.hasGeneratedActivities),
    generatedActivitiesSeen: agenda.hasGeneratedActivities && (positiveProtocolEvidence || hasActiveLot),
    adjustmentRecorded: notebook.hasNutritionAdjustmentRecord,
    agendaActivitiesCompleted: agenda.lastAgendaInteraction === 'completed' && agenda.pendingToday === 0,
    finalHomeChecked: false,
  };

  const hasTodayTasks = agenda.pendingToday > 0
    || agenda.nextActivityDueLabel === 'today';
  const hasProtocolTask = agenda.hasGeneratedActivities
    || agenda.hasProtocolTasks
    || agenda.nextActivityType === 'protocol_activity';
  const hasFieldNotebookSignal = notebook.hasRecentNotes
    || notebook.totalRecentNotes > 0
    || notebook.hasSowingNote
    || (notebook.latestNotes || []).length > 0;
  const hasReservoirSignal = reservoir.hasReservoirs
    || reservoir.criticalLevelCount > 0
    || reservoir.lowLevelCount > 0
    || reservoir.withSolutionCount > 0
    || reservoir.withoutSolutionCount > 0
    || reservoir.currentLevel === 'critical'
    || reservoir.currentLevel === 'low';
  const hasProductionOrCultivation = production.hasProductionData
    || production.harvestedPlantsLast30d > 0
    || production.producedPackagesLast30d > 0
    || production.upcomingHarvestLots > 0
    || cultivation.culturesCount > 0
    || cultivation.speciesInProgressCount > 0
    || dashboard.hasUpcomingHarvests;
  const hasTeamSignal = team.activeMembers > 0 || team.overdueActivities > 0 || team.onTimeActivities > 0;
  const hasContinuityContext = hasActiveLot
    && effective.lotWithProtocolCreated
    && !hasTodayTasks
    && !hasProtocolTask;
  const hasRecentLotCreated = hasRecentUserAction(recentUserActions, ['lot'], ['created']);
  const hasRecentAgendaChecked = hasRecentUserAction(recentUserActions, ['agenda', 'agenda_activity'], ['viewed', 'opened', 'edited']);
  const hasRecentFieldRecord = hasRecentUserAction(recentUserActions, ['field_note', 'nutrition_adjustment'], ['created']);
  const hasRecentAgendaCompleted = hasRecentUserAction(recentUserActions, ['agenda', 'agenda_activity'], ['completed']);

  // Sinal derivado: lote com protocolo ativo + atividades vistas + sem registro no caderno.
  // Indica que o usuário precisa registrar o trabalho de campo associado ao lote.
  const needsFieldNote =
    effective.lotWithProtocolCreated
    && effective.generatedActivitiesSeen
    && !notebook.hasRecentNotes
    && !notebook.hasNutritionAdjustmentRecord;

  // Priority 1: Critical alerts
  if (alerts.hasCriticalAlerts || alerts.criticalCount > 0) {
    rulesApplied.push(RULE_IDS.CRITICAL_ALERTS);
    return { stepId: 'review_critical_alerts', targetRoute: '/agendaPage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_critical_alerts, 0.85) };
  }

  // Priority 2: Overdue tasks
  if (agenda.hasOverdue || agenda.overdueCount > 0 || agenda.nextActivityOverdue === true) {
    rulesApplied.push(RULE_IDS.OVERDUE_TASKS);
    return { stepId: 'resolve_overdue_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.resolve_overdue_tasks, 0.85) };
  }

  if (hasRecentLotCreated && agenda.hasGeneratedActivities) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'check_generated_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Confira a Agenda antes de seguir.', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_generated_activities, 0.8) };
  }

  if (hasRecentAgendaChecked && !effective.adjustmentRecorded) {
    rulesApplied.push(RULE_IDS.RECORD_CADERNO_ADJUSTMENT);
    return { stepId: 'record_caderno_adjustment', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Caderno de campo - Registrar atividade', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.record_caderno_adjustment, 0.8) };
  }

  if (hasRecentFieldRecord && agenda.pendingToday > 0 && !effective.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_ACTIVITIES);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Concluir na Agenda', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.finish_agenda_activities, 0.8) };
  }

  if (hasRecentAgendaCompleted || effective.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.REVIEW_FINAL_HOME);
    return { stepId: 'review_final_home', targetRoute: '/lotePage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Revisar Agenda - lote segue em acompanhamento', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_final_home, 0.75) };
  }

  if (!dashboard.hasProtocolLinkedToLatestLot && !effective.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.NO_PROTOCOL_LOT);
    return { stepId: 'create_lot_with_protocol', targetRoute: '/lotePage', dashboardId: 'LOTE_PRODUCAO', focusMessage: 'Comece criando seu primeiro lote', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.create_lot_with_protocol, 0.85) };
  }

  if (needsFieldNote) {
    rulesApplied.push(RULE_IDS.RECORD_CADERNO_ADJUSTMENT);
    return { stepId: 'record_caderno_adjustment', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Caderno de campo - Registrar atividade', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.record_caderno_adjustment, 0.8) };
  }

  // Priority 3: Today tasks / next task
  if (hasTodayTasks) {
    rulesApplied.push(RULE_IDS.TODAY_TASKS);
    return { stepId: 'review_today_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_today_tasks, 0.8) };
  }

  if (hasContinuityContext && options.supportsOperationalOnboarding !== false) {
    rulesApplied.push(RULE_IDS.PLAN_NEXT_LOT);
    return { stepId: 'plan_next_lot', targetRoute: '/lotePage', dashboardId: 'LOTE_PRODUCAO', focusMessage: 'Planejar próximo lote', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.plan_next_lot, 0.75) };
  }

  // Priority 4: Protocol tasks or recent protocol lot
  if (hasProtocolTask && effective.lotWithProtocolCreated && !effective.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'check_generated_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Confira a Agenda antes de seguir.', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_generated_activities, 0.75) };
  }

  // Step 2: Protocol created, activities not yet seen
  if ((dashboard.hasProtocolLinkedToLatestLot || effective.lotWithProtocolCreated) && !effective.generatedActivitiesSeen) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'check_generated_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Confira a Agenda antes de seguir.', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_generated_activities, 0.75) };
  }

  // Step 3: Activities seen, adjustment not yet recorded
  if (effective.generatedActivitiesSeen && !effective.adjustmentRecorded) {
    rulesApplied.push(RULE_IDS.RECORD_CADERNO_ADJUSTMENT);
    return { stepId: 'record_caderno_adjustment', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Caderno de campo - Registrar atividade', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.record_caderno_adjustment, 0.75) };
  }

  // Step 4: Adjustment recorded, agenda activities pending
  if (effective.adjustmentRecorded && agenda.pendingToday > 0 && !effective.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_ACTIVITIES);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Concluir na Agenda', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.finish_agenda_activities, 0.65) };
  }

  // Step 5: All done, final home review
  if (effective.agendaActivitiesCompleted && !effective.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.REVIEW_FINAL_HOME);
    return { stepId: 'review_final_home', targetRoute: '/lotePage', dashboardId: 'TAREFAS_PENDENTES', focusMessage: 'Revisar Agenda - lote segue em acompanhamento', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_final_home, 0.65) };
  }

  // Priority 7: Field notebook / recent note
  if (hasFieldNotebookSignal) {
    rulesApplied.push(RULE_IDS.FIELD_NOTEBOOK);
    return { stepId: 'review_field_notes', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_field_notes, 0.7) };
  }

  // Priority 9: Reservoir / nutrient solution
  if (hasReservoirSignal) {
    rulesApplied.push(RULE_IDS.RESERVOIR_ATTENTION);
    return { stepId: 'review_reservoirs', targetRoute: '/reservatoriosPage', dashboardId: 'PRODUCAO_TOTAL', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_reservoirs, 0.65) };
  }

  // Priority 10: Production / cultivation
  if (hasProductionOrCultivation) {
    rulesApplied.push(RULE_IDS.PRODUCTION_CONTEXT);
    return { stepId: 'review_production', targetRoute: '/relatoriosPage', dashboardId: 'PRODUCAO_TOTAL', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_production, 0.6) };
  }

  // Priority 11: Team
  if (hasTeamSignal) {
    rulesApplied.push(RULE_IDS.TEAM_CONTEXT);
    return { stepId: 'review_team', targetRoute: '/gerenciarEquipePage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_team, 0.6) };
  }

  // No production data - avoid empty production
  if (!production.hasProductionData) {
    rulesApplied.push(RULE_IDS.AVOID_EMPTY_PRODUCTION);
  }

  return { stepId: 'create_lot_with_protocol', targetRoute: '/lotePage', dashboardId: 'LOTE_PRODUCAO', focusMessage: 'Comece criando seu primeiro lote', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.create_lot_with_protocol, 0.65) };
}

module.exports = {
  RULE_IDS,
  DOMAIN_RULES,
  deriveInstantSignals,
  STEP_SHORTCUTS,
  ROUTE_CONFLICT_RESOLVER,
};
