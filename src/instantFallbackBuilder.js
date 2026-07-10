const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  DASHBOARD_CONFIG,
  SHORTCUT_GROUPS,
  VISUAL_PRIORITIES,
} = require('./adaptiveContract');
const { deriveInstantSignals } = require('./instantDomainRules');
const { buildInfoRecommendationFallback, resolveRouteConflicts } = require('./instantInfoRecommendationBuilder');
const { buildOperationalOnboardingFallback } = require('./instantOperationalOnboardingBuilder');

const STEP_COPY = {
  create_lot_with_protocol: {
    title: 'Cadastre um lote com protocolo',
    description: 'Comece vinculando um protocolo ao lote para gerar as primeiras atividades.',
    actionLabel: 'Abrir Protocolos',
  },
  check_generated_activities: {
    title: 'Verifique as atividades geradas na Agenda',
    description: 'O lote com protocolo já foi criado. Confira as atividades geradas para o primeiro dia.',
    actionLabel: 'Abrir Agenda',
  },
  record_caderno_adjustment: {
    title: 'Registre o ajuste no Caderno de Campo',
    description: 'As atividades foram verificadas. Agora registre a execução do ajuste no caderno de campo.',
    actionLabel: 'Abrir Caderno',
  },
  finish_agenda_activities: {
    title: 'Conclua as pendências na Agenda',
    description: 'O ajuste foi registrado. Finalize as atividades do primeiro dia na Agenda.',
    actionLabel: 'Abrir Agenda',
  },
  review_final_home: {
    title: 'Confira o resumo final do fluxo',
    description: 'Todas as atividades foram concluídas. Revise o resumo final pela Home.',
    actionLabel: 'Ver Relatórios',
  },
  test_complete: {
    title: 'Roteiro de teste concluído',
    description: 'Você completou todas as etapas do roteiro. Confira o resumo nos relatórios.',
    actionLabel: 'Ver Relatórios',
  },
  review_critical_alerts: {
    title: 'Revise alertas operacionais críticos',
    description: 'Há alertas críticos que devem receber prioridade antes de continuar.',
    actionLabel: 'Abrir Agenda',
  },
  resolve_overdue_tasks: {
    title: 'Resolva tarefas atrasadas',
    description: 'Existem atividades atrasadas e a Agenda deve ser priorizada.',
    actionLabel: 'Abrir Agenda',
  },
  review_today_tasks: {
    title: 'Priorize as atividades de hoje',
    description: 'Há tarefas de hoje ou uma próxima atividade pendente para acompanhar na Agenda.',
    actionLabel: 'Abrir Agenda',
  },
  review_protocol_tasks: {
    title: 'Confira tarefas geradas por protocolo',
    description: 'Há sinais de protocolo vinculado e atividades operacionais para revisar.',
    actionLabel: 'Abrir Agenda',
  },
  review_field_notes: {
    title: 'Confira registros recentes do Caderno',
    description: 'Há anotações recentes de campo que podem orientar o próximo passo operacional.',
    actionLabel: 'Abrir Caderno',
  },
  review_reservoirs: {
    title: 'Revise reservatórios e solução',
    description: 'Há sinais de reservatório ou solução nutritiva para acompanhar.',
    actionLabel: 'Abrir Reservatórios',
  },
  review_production: {
    title: 'Veja o resumo de produção',
    description: 'Há dados de produção ou cultivo para revisar no resumo operacional.',
    actionLabel: 'Ver Relatórios',
  },
  review_team: {
    title: 'Revise a saúde da equipe',
    description: 'Há sinais operacionais de equipe para acompanhar.',
    actionLabel: 'Abrir Equipe',
  },
  test_create_lot_with_protocol: {
    title: 'Cadastre um lote com protocolo',
    description: 'Comece criando seu primeiro lote vinculando um protocolo.',
    actionLabel: 'Criar Lote',
  },
  test_check_generated_activities: {
    title: 'Verifique as atividades na Agenda',
    description: 'Confira na Agenda as atividades geradas para o primeiro dia.',
    actionLabel: 'Abrir Agenda',
  },
  test_record_adjustment: {
    title: 'Registre atividade no Caderno de Campo',
    description: 'Registre a execução da atividade no caderno de campo.',
    actionLabel: 'Abrir Caderno',
  },
  test_finish_agenda: {
    title: 'Conclua as pendências na Agenda',
    description: 'O registro foi feito. Finalize as atividades do dia na Agenda.',
    actionLabel: 'Abrir Agenda',
  },
  test_review_final_home: {
    title: 'Revise o lote em acompanhamento',
    description: 'Todas as atividades foram concluídas. Acompanhe o lote.',
    actionLabel: 'Ver Lote',
  },
  test_complete: {
    title: 'Roteiro de teste concluído',
    description: 'Você completou todas as etapas do roteiro de teste.',
    actionLabel: 'Ver Relatórios',
  },
};

function buildEnhancedInstantFallback({ operationalContext, clientCapabilities, reason = 'deterministic_fallback' }) {
  const signals = deriveInstantSignals(operationalContext);
  const dashboard = DASHBOARD_CONFIG[signals.dashboardId] || DASHBOARD_CONFIG.TAREFAS_PENDENTES;
  const copy = STEP_COPY[signals.stepId] || STEP_COPY.create_lot_with_protocol;
  const confidence = reason === 'gemini_invalid_response' ? 0.68 : 0.64;

  const infoRec = buildInfoRecommendationFallback({ signals, clientCapabilities: clientCapabilities || {}, operationalContext });
  const maxShortcuts = Math.max(1, (clientCapabilities && clientCapabilities.maxShortcuts) || 3);

  const rawShortcuts = (signals.shortcuts || []).slice(0, maxShortcuts).map((sc, index) => ({
    route: sc.route,
    confidence: sc.confidence || (confidence * (index === 0 ? 1.0 : index === 1 ? 0.85 : 0.75)),
    label: sc.label || copy.actionLabel,
    description: sc.description || copy.description,
    group: sc.group || (index === 0 ? 'primary' : index === 1 ? 'secondary' : 'contextual'),
    reason: sc.description || copy.description,
  }));

  const resolved = resolveRouteConflicts(signals.stepId, signals.targetRoute, infoRec.ctaRoute, rawShortcuts);

  const finalInfoRec = resolved.infoCtaRoute && infoRec
    ? { ...infoRec, ctaRoute: resolved.infoCtaRoute }
    : infoRec;

  return {
    responseVersion: '1.0',
    mode: ADAPTIVE_MODES.INSTANT,
    source: ADAPTIVE_SOURCES.FALLBACK,
    dashboard: dashboard.displayName,
    dashboardId: dashboard.id,
    cardType: dashboard.cardType,
    confidence,
    visualPriority: VISUAL_PRIORITIES.MODERATE,
    nextStepPrediction: {
      stepId: signals.stepId,
      confidence,
      title: copy.title,
      description: copy.description,
      targetRoute: resolved.nextStepRoute || signals.targetRoute,
      actionLabel: copy.actionLabel,
    },
    sectionAdaptations: [
      {
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: copy.title,
        description: copy.description,
      },
    ],
    shortcuts: resolved.shortcuts,
    focus: {
      component: 'AdaptiveFocusBanner',
      message: `Próximo foco: ${copy.title}.`,
      targetSectionId: 'recommended_actions',
      priority: 'high',
    },
    uiTreatment: {
      density: 'comfortable',
      emphasis: 'moderate',
      animation: 'subtle',
      explanationVisibility: 'low',
      showProgressBar: false,
    },
    reason: copy.description,
    reasonDetails: {
      summary: copy.description,
      details: signals.rulesApplied,
      display: 'info_icon',
    },
    rulesApplied: signals.rulesApplied,
    infoRecommendation: finalInfoRec,
    operationalOnboarding: clientCapabilities?.supportedComponents?.includes('OperationalOnboardingCard')
      ? buildOperationalOnboardingFallback({ signals })
      : null,
    fallback: {
      used: true,
      reason,
    },
  };
}

module.exports = { buildEnhancedInstantFallback };
