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

const STEP_SHORTCUTS = {
  review_critical_alerts: [
    { route: '/agendaPage', label: 'Ver Alertas', description: 'Revise os alertas críticos operacionais', group: 'primary' },
    { route: '/gerenciarEquipePage', label: 'Gerenciar Equipe', description: 'Verifique a alocação da equipe', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Relatórios', description: 'Acesse relatórios de ocorrências', group: 'contextual' },
  ],
  resolve_overdue_agenda_tasks: [
    { route: '/agendaPage', label: 'Ver Tarefas', description: 'Resolva as tarefas atrasadas na agenda', group: 'primary' },
    { route: '/gerenciarEquipePage', label: 'Equipe', description: 'Atribua tarefas à equipe', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Relatórios', description: 'Veja o relatório de atrasos', group: 'contextual' },
  ],
  create_lot_with_protocol: [
    { route: '/protocoloPage', label: 'Criar Protocolo', description: 'Vincule um protocolo ao lote ativo', group: 'primary' },
    { route: '/lotePage', label: 'Ver Lotes', description: 'Revise os lotes que precisam de protocolo', group: 'secondary' },
    { route: '/areaCultivoPage', label: 'Área Cultivo', description: 'Gerencie as áreas de cultivo', group: 'contextual' },
  ],
  check_generated_agenda_activities: [
    { route: '/agendaPage', label: 'Ver Atividades', description: 'Confira as atividades geradas na agenda', group: 'primary' },
    { route: '/lotePage', label: 'Ver Lote', description: 'Consulte o lote vinculado ao protocolo', group: 'secondary' },
    { route: '/protocoloPage', label: 'Protocolo', description: 'Revise o protocolo criado para o lote', group: 'contextual' },
  ],
  execute_nutrition_adjustment: [
    { route: '/solucaoPage', label: 'Ajustar Nutrição', description: 'Execute o ajuste nutricional pendente', group: 'primary' },
    { route: '/agendaPage', label: 'Ver Agenda', description: 'Consulte a programação de atividades', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Histórico', description: 'Veja o histórico de ajustes nutricionais', group: 'contextual' },
  ],
  check_field_notebook: [
    { route: '/cadernoCampoPage', label: 'Ver Caderno', description: 'Confira os registros no caderno de campo', group: 'primary' },
    { route: '/solucaoPage', label: 'Solução', description: 'Acesse a solução aplicada ao cultivo', group: 'secondary' },
    { route: '/agendaPage', label: 'Próximos', description: 'Veja os próximos passos na agenda', group: 'contextual' },
  ],
  finish_agenda_activities: [
    { route: '/agendaPage', label: 'Concluir Tarefas', description: 'Finalize as atividades pendentes na agenda', group: 'primary' },
    { route: '/cadernoCampoPage', label: 'Caderno', description: 'Confira os últimos registros no caderno', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Resumo', description: 'Veja o resumo das atividades do dia', group: 'contextual' },
  ],
  review_final_home_context: [
    { route: '/relatoriosPage', label: 'Ver Relatórios', description: 'Confira o resumo final do fluxo operacional', group: 'primary' },
    { route: '/agendaPage', label: 'Histórico', description: 'Veja o histórico de atividades concluídas', group: 'secondary' },
    { route: '/solucaoPage', label: 'Soluções', description: 'Revise as soluções aplicadas', group: 'contextual' },
  ],
  review_agenda_context: [
    { route: '/agendaPage', label: 'Abrir Agenda', description: 'Revise o próximo contexto na agenda', group: 'primary' },
    { route: '/gerenciarEquipePage', label: 'Equipe', description: 'Gerencie a alocação da equipe', group: 'secondary' },
    { route: '/relatoriosPage', label: 'Relatórios', description: 'Acesse relatórios operacionais', group: 'contextual' },
  ],
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
  const production = context.productionState;
  const alerts = context.alertState;
  const sequence = context.testSequenceSignals;
  const rulesApplied = [RULE_IDS.NO_PROGRESS_BAR];

  if (alerts.hasCriticalAlerts || alerts.criticalCount > 0) {
    rulesApplied.push(RULE_IDS.CRITICAL_ALERTS);
    return { stepId: 'review_critical_alerts', targetRoute: '/agendaPage', dashboardId: 'SAUDE_EQUIPES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_critical_alerts, 0.85) };
  }

  if (agenda.overdueActivitiesCount > 0) {
    rulesApplied.push(RULE_IDS.OVERDUE_TASKS);
    return { stepId: 'resolve_overdue_agenda_tasks', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.resolve_overdue_agenda_tasks, 0.85) };
  }

  if (!dashboard.hasProtocolLinkedToLatestLot && !sequence.lotWithProtocolCreated) {
    rulesApplied.push(RULE_IDS.NO_PROTOCOL_LOT);
    return { stepId: 'create_lot_with_protocol', targetRoute: '/protocoloPage', dashboardId: 'LOTE_PRODUCAO', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.create_lot_with_protocol, 0.85) };
  }

  if ((dashboard.hasProtocolLinkedToLatestLot || sequence.lotWithProtocolCreated) && !sequence.generatedActivitiesSeen) {
    rulesApplied.push(RULE_IDS.AGENDA_AFTER_LOT_WITH_PROTOCOL);
    return { stepId: 'check_generated_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_generated_agenda_activities, 0.75) };
  }

  if (agenda.nextActivity.type === 'nutritional_adjustment' && !sequence.nutritionAdjustmentExecuted) {
    rulesApplied.push(RULE_IDS.PENDING_NUTRITION_ADJUSTMENT);
    return { stepId: 'execute_nutrition_adjustment', targetRoute: '/solucaoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.execute_nutrition_adjustment, 0.75) };
  }

  if (sequence.nutritionAdjustmentExecuted && notebook.hasRecentNutritionAdjustmentRecord && !sequence.fieldNotebookChecked) {
    rulesApplied.push(RULE_IDS.FIELD_NOTEBOOK_AFTER_ADJUSTMENT);
    return { stepId: 'check_field_notebook', targetRoute: '/cadernoCampoPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.check_field_notebook, 0.75) };
  }

  if (sequence.fieldNotebookChecked && agenda.pendingActivitiesTodayCount > 0 && !sequence.agendaActivitiesCompleted) {
    rulesApplied.push(RULE_IDS.FINISH_AGENDA_AFTER_NOTEBOOK);
    return { stepId: 'finish_agenda_activities', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.finish_agenda_activities, 0.65) };
  }

  if (sequence.agendaActivitiesCompleted || sequence.finalHomeChecked) {
    rulesApplied.push(RULE_IDS.FINAL_HOME_CHECK);
    return { stepId: 'review_final_home_context', targetRoute: '/relatoriosPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_final_home_context, 0.65) };
  }

  if (!production.hasProductionData) {
    rulesApplied.push(RULE_IDS.AVOID_EMPTY_PRODUCTION);
  }

  return { stepId: 'review_agenda_context', targetRoute: '/agendaPage', dashboardId: 'TAREFAS_PENDENTES', rulesApplied, shortcuts: applyShortcutConfidence(STEP_SHORTCUTS.review_agenda_context, 0.65) };
}

module.exports = {
  RULE_IDS,
  DOMAIN_RULES,
  deriveInstantSignals,
  STEP_SHORTCUTS,
};
