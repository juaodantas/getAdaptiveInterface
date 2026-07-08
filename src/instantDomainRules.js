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
  TODAY_TASKS: 'RULE-011',
  FIELD_NOTEBOOK: 'RULE-012',
  RESERVOIR_ATTENTION: 'RULE-013',
  PRODUCTION_CONTEXT: 'RULE-014',
  TEAM_CONTEXT: 'RULE-015',
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
  { id: RULE_IDS.TODAY_TASKS, description: 'Há tarefas de hoje ou próxima tarefa: priorizar Agenda.' },
  { id: RULE_IDS.FIELD_NOTEBOOK, description: 'Há registros recentes no Caderno de Campo: recomendar conferência do caderno.' },
  { id: RULE_IDS.RESERVOIR_ATTENTION, description: 'Há sinais de reservatório ou solução nutritiva: recomendar reservatórios/solução.' },
  { id: RULE_IDS.PRODUCTION_CONTEXT, description: 'Há dados de produção ou cultivo: recomendar resumo operacional.' },
  { id: RULE_IDS.TEAM_CONTEXT, description: 'Há sinais de equipe: recomendar saúde da equipe.' },
];

const ROUTE_CONFLICT_RESOLVER = {
  create_lot_with_protocol: {
    '/protocoloPage': '/lotePage',
    '/lotePage': '/areaCultivoPage',
    '/areaCultivoPage': '/protocoloPage',
  },
  check_generated_activities: {
    '/agendaPage': '/lotePage',
    '/lotePage': '/protocoloPage',
    '/protocoloPage': '/areaCultivoPage',
  },
  record_caderno_adjustment: {
    '/cadernoCampoPage': '/relatoriosPage',
    '/solucaoPage': '/agendaPage',
    '/agendaPage': '/relatoriosPage',
  },
  finish_agenda_activities: {
    '/agendaPage': '/relatoriosPage',
    '/cadernoCampoPage': '/solucaoPage',
    '/relatoriosPage': '/historicoPage',
  },
  review_final_home: {
    '/relatoriosPage': '/agendaPage',
    '/agendaPage': '/solucaoPage',
    '/solucaoPage': '/relatoriosPage',
  },
  test_complete: {
    '/relatoriosPage': '/agendaPage',
    '/agendaPage': '/protocoloPage',
    '/protocoloPage': '/relatoriosPage',
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
    { route: '/protocoloPage', label: 'Criar Protocolo', description: 'Vincule um protocolo ao lote ativo', group: 'primary' },
    { route: '/lotePage', label: 'Ver Lotes', description: 'Revise os lotes que precisam de protocolo', group: 'secondary' },
    { route: '/areaCultivoPage', label: 'Área Cultivo', description: 'Gerencie as áreas de cultivo', group: 'contextual' },
  ],
  check_generated_activities: [
    { route: '/agendaPage', label: 'Ver Atividades', description: 'Confira as atividades geradas na agenda', group: 'primary' },
    { route: '/lotePage', label: 'Ver Lote', description: 'Consulte o lote vinculado ao protocolo', group: 'secondary' },
    { route: '/protocoloPage', label: 'Protocolo', description: 'Revise o protocolo criado para o lote', group: 'contextual' },
  ],
  record_caderno_adjustment: [
    { route: '/cadernoCampoPage', label: 'Registrar Ajuste', description: 'Registre a execução do ajuste no caderno de campo', group: 'primary' },
    { route: '/agendaPage', label: 'Ver Agenda', description: 'Consulte a programação de atividades', group: 'secondary' },
    { route: '/solucaoPage', label: 'Solução', description: 'Acesse a solução aplicada ao cultivo', group: 'contextual' },
  ],
  finish_agenda_activities: [
    { route: '/agendaPage', label: 'Concluir Tarefas', description: 'Finalize as atividades pendentes na agenda', group: 'primary' },
    { route: '/cadernoCampoPage', label: 'Caderno', description: 'Confira os últimos registros no caderno', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Resumo', description: 'Veja o resumo das atividades do dia', group: 'contextual' },
  ],
  review_final_home: [
    { route: '/relatoriosPage', label: 'Ver Relatórios', description: 'Confira o resumo final do fluxo operacional', group: 'primary' },
    { route: '/agendaPage', label: 'Histórico', description: 'Veja o histórico de atividades concluídas', group: 'secondary' },
    { route: '/solucaoPage', label: 'Soluções', description: 'Revise as soluções aplicadas', group: 'contextual' },
  ],
  test_complete: [
    { route: '/relatoriosPage', label: 'Ver Relatórios', description: 'Revise o resumo completo do roteiro', group: 'primary' },
    { route: '/agendaPage', label: 'Agenda', description: 'Acesse o histórico de atividades', group: 'secondary' },
    { route: '/protocoloPage', label: 'Protocolo', description: 'Consulte o protocolo utilizado', group: 'contextual' },
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

function deriveInstantSignals(context) {
  const dashboard = context.dashboardState;
  const agenda = context.agendaState;
  const notebook = context.fieldNotebookState;
  const reservoir = context.reservoirState;
  const production = context.productionState;
  const cultivation = context.cultivationState || {};
  const team = context.teamState || {};
  const alerts = context.alertState;
  const infoCards = context.infoCardsState || {};
  const sequence = context.testSequenceSignals;
  const rulesApplied = [RULE_IDS.NO_PROGRESS_BAR];

  // Sinais efetivos: combinam o que veio da sessão (testSequenceSignals)
  // com o que é objetivamente constatável do estado persistente (dashboard, agenda, notebook).
  // Isso protege contra perda de progresso quando o usuário faz logout (os sinais de sessão
  // são zerados, mas o estado do servidor permanece).
  const effective = {
    lotWithProtocolCreated: sequence.lotWithProtocolCreated
      || dashboard.hasProtocolLinkedToLatestLot
      || (dashboard.hasActiveLots && agenda.hasGeneratedActivities),
    generatedActivitiesSeen: sequence.generatedActivitiesSeen
      || (agenda.hasGeneratedActivities && (dashboard.hasProtocolLinkedToLatestLot || dashboard.hasActiveLots)),
    adjustmentRecorded: sequence.adjustmentRecorded || notebook.hasRecentNutritionAdjustmentRecord,
    agendaActivitiesCompleted: sequence.agendaActivitiesCompleted || agenda.lastInteractionType === 'completed',
    finalHomeChecked: sequence.finalHomeChecked,
  };

  const hasTodayTasks = agenda.pendingActivitiesTodayCount > 0
    || agenda.dueBuckets?.today > 0
    || agenda.nextActivity?.dueLabel === 'today'
    || agenda.nextActivity?.status === 'pending';
  const hasProtocolTask = agenda.hasGeneratedActivities
    || agenda.nextActivity?.type === 'protocol_activity'
    || (agenda.latestTasks || []).some((task) => task.type === 'protocol_activity');
  const hasFieldNotebookSignal = notebook.hasRecentFieldNotes
    || notebook.totalRecentNotes > 0
    || notebook.sowingNotePresent
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
    || (cultivation.cultures || []).length > 0
    || (cultivation.speciesInProgress || []).length > 0
    || dashboard.hasUpcomingHarvests
    || infoCards.todayCultivation?.activeLots > 0;
  const hasTeamSignal = team.activeMembers > 0 || team.overdueActivities > 0 || team.onTimeActivities > 0;

  // Sinal derivado: lote com protocolo ativo + atividades vistas + sem registro no caderno.
  // Indica que o usuário precisa registrar o trabalho de campo associado ao lote.
  const needsFieldNote =
    effective.lotWithProtocolCreated
    && effective.generatedActivitiesSeen
    && !notebook.hasRecentFieldNotes
    && !notebook.hasRecentNutritionAdjustmentRecord;

  // Priority 1: Critical alerts override sequence
  if (alerts.hasCriticalAlerts || alerts.criticalCount > 0) {
    rulesApplied.push(RULE_IDS.CRITICAL_ALERTS);
    return { stepId: 'review_critical_alerts', targetRoute: '/agendaPage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_critical_alerts, 0.85) };
  }

  // Priority 2: Overdue tasks
  if (agenda.overdueActivitiesCount > 0 || agenda.dueBuckets?.overdue > 0 || agenda.nextActivity?.overdue === true) {
    rulesApplied.push(RULE_IDS.OVERDUE_TASKS);
    return { stepId: 'resolve_overdue_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.resolve_overdue_tasks, 0.85) };
  }

  // Priority 2.5: Lote com protocolo precisa de registro em caderno de campo.
  // Elevado de priority 7 para capturar o caso em que o usuário criou lote com protocolo,
  // viu as atividades geradas, mas ainda não registrou trabalho de campo — situação comum
  // em que antes só aparecia Agenda (today tasks). Agora Caderno de Campo aparece como
  // recomendação prioritária quando há contexto de lote ativo.
  if (needsFieldNote) {
    rulesApplied.push(RULE_IDS.FIELD_NOTEBOOK);
    return { stepId: 'review_field_notes', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_field_notes, 0.8) };
  }

  // Priority 3: Today tasks / next task
  if (hasTodayTasks) {
    rulesApplied.push(RULE_IDS.TODAY_TASKS);
    return { stepId: 'review_today_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_today_tasks, 0.8) };
  }

  // Priority 4: Protocol tasks or recent protocol lot
  if (hasProtocolTask && effective.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'review_protocol_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_protocol_tasks, 0.75) };
  }

  // Step 2: Protocol created, activities not yet seen
  if ((dashboard.hasProtocolLinkedToLatestLot || effective.lotWithProtocolCreated) && !effective.generatedActivitiesSeen) {
    rulesApplied.push(RULE_IDS.CHECK_GENERATED_ACTIVITIES);
    return { stepId: 'check_generated_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_generated_activities, 0.75) };
  }

  // Step 3: Activities seen, adjustment not yet recorded
  if (effective.generatedActivitiesSeen && !effective.adjustmentRecorded) {
    rulesApplied.push(RULE_IDS.RECORD_CADERNO_ADJUSTMENT);
    return { stepId: 'record_caderno_adjustment', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.record_caderno_adjustment, 0.75) };
  }

  // Step 4: Adjustment recorded, agenda activities pending
  if (effective.adjustmentRecorded && agenda.pendingActivitiesTodayCount > 0 && !effective.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_ACTIVITIES);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.finish_agenda_activities, 0.65) };
  }

  // Step 5: All done, final home review
  if (effective.agendaActivitiesCompleted && !effective.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.REVIEW_FINAL_HOME);
    return { stepId: 'review_final_home', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_final_home, 0.65) };
  }

  // Step 6 (terminal): Test complete
  if (effective.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.TEST_COMPLETE);
    return { stepId: 'test_complete', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.test_complete, 0.5) };
  }

  // Priority 7: Field notebook / recent note
  if (hasFieldNotebookSignal) {
    rulesApplied.push(RULE_IDS.FIELD_NOTEBOOK);
    return { stepId: 'review_field_notes', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_field_notes, 0.7) };
  }

  // Priority 8: Reservoir / nutrient solution
  if (hasReservoirSignal) {
    rulesApplied.push(RULE_IDS.RESERVOIR_ATTENTION);
    return { stepId: 'review_reservoirs', targetRoute: '/reservatoriosPage', dashboardId: 'PRODUCAO_TOTAL', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_reservoirs, 0.65) };
  }

  // Priority 9: Production / cultivation
  if (hasProductionOrCultivation) {
    rulesApplied.push(RULE_IDS.PRODUCTION_CONTEXT);
    return { stepId: 'review_production', targetRoute: '/relatoriosPage', dashboardId: 'PRODUCAO_TOTAL', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_production, 0.6) };
  }

  // Priority 10: Team
  if (hasTeamSignal) {
    rulesApplied.push(RULE_IDS.TEAM_CONTEXT);
    return { stepId: 'review_team', targetRoute: '/gerenciarEquipePage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_team, 0.6) };
  }

  // Default onboarding: only after stronger enriched signals were ruled out.
  if (!dashboard.hasProtocolLinkedToLatestLot && !effective.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.NO_PROTOCOL_LOT);
    return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.create_lot_with_protocol, 0.85) };
  }

  // No production data - avoid empty production
  if (!production.hasProductionData) {
    rulesApplied.push(RULE_IDS.AVOID_EMPTY_PRODUCTION);
  }

  return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.create_lot_with_protocol, 0.65) };
}

module.exports = {
  RULE_IDS,
  DOMAIN_RULES,
  deriveInstantSignals,
  STEP_SHORTCUTS,
  ROUTE_CONFLICT_RESOLVER,
};
