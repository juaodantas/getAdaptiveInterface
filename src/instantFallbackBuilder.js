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
const {
  canonicalizeOnboardingSecondaryShortcuts,
  shouldUseOnboardingInfoSlot,
} = require('./instantOnboardingInfoSlot');

const STEP_COPY = {
  create_lot_with_protocol: {
    title: 'Comece criando seu primeiro lote',
    description: 'Crie o primeiro lote com protocolo para iniciar o acompanhamento.',
    actionLabel: 'Criar primeiro lote',
  },
  plan_next_lot: {
    title: 'Planejar próximo lote',
    description: 'Seu lote ativo está em acompanhamento. Planeje o próximo lote para manter a produção organizada.',
    actionLabel: 'Planejar próximo lote',
  },
  check_generated_activities: {
    title: 'Confira a Agenda antes de seguir.',
    description: 'O lote com protocolo já foi criado. Confira as atividades geradas para o primeiro dia.',
    actionLabel: 'Abrir Agenda',
  },
  record_caderno_adjustment: {
    title: 'Caderno de campo - Registrar atividade',
    description: 'As atividades foram verificadas. Agora registre a execução do ajuste no caderno de campo.',
    actionLabel: 'Abrir Caderno',
  },
  finish_agenda_activities: {
    title: 'Concluir na Agenda',
    description: 'O ajuste foi registrado. Finalize as atividades do primeiro dia na Agenda.',
    actionLabel: 'Abrir Agenda',
  },
  review_final_home: {
    title: 'Revisar Agenda - lote segue em acompanhamento',
    description: 'Todas as atividades foram concluídas. Revise o lote em acompanhamento.',
    actionLabel: 'Ver Lote',
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
};

function usesOperationalOnboardingInfoSlot(stepId, operationalOnboarding) {
  return shouldUseOnboardingInfoSlot(stepId, operationalOnboarding);
}

function supportsOperationalOnboarding(clientCapabilities) {
  return clientCapabilities?.supportedComponents?.includes('OperationalOnboardingCard') === true;
}

function buildEnhancedInstantFallback({ operationalContext, clientCapabilities, reason = 'deterministic_fallback' }) {
  const supportsOnboarding = supportsOperationalOnboarding(clientCapabilities);
  const signals = deriveInstantSignals(operationalContext, { supportsOperationalOnboarding: supportsOnboarding });
  const dashboard = DASHBOARD_CONFIG[signals.dashboardId] || DASHBOARD_CONFIG.TAREFAS_PENDENTES;
  const copy = STEP_COPY[signals.stepId] || STEP_COPY.create_lot_with_protocol;
  const confidence = reason === 'gemini_invalid_response' ? 0.68 : 0.64;
  const operationalOnboarding = supportsOnboarding
    ? buildOperationalOnboardingFallback({ signals })
    : null;
  const onboardingOwnsInfoSlot = usesOperationalOnboardingInfoSlot(signals.stepId, operationalOnboarding);

  const infoRec = onboardingOwnsInfoSlot
    ? null
    : buildInfoRecommendationFallback({ signals, clientCapabilities: clientCapabilities || {}, operationalContext });
  const maxShortcuts = Math.max(1, (clientCapabilities && clientCapabilities.maxShortcuts) || 3);

  const rawShortcuts = (signals.shortcuts || []).slice(0, maxShortcuts).map((sc, index) => ({
    route: sc.route,
    confidence: sc.confidence || (confidence * (index === 0 ? 1.0 : index === 1 ? 0.85 : 0.75)),
    label: sc.label || copy.actionLabel,
    description: sc.description || copy.description,
    group: sc.group || (index === 0 ? 'primary' : index === 1 ? 'secondary' : 'contextual'),
    reason: sc.description || copy.description,
  }));

  const resolved = resolveRouteConflicts(signals.stepId, signals.targetRoute, infoRec ? infoRec.ctaRoute : null, rawShortcuts);
  const resolvedShortcuts = canonicalizeOnboardingSecondaryShortcuts(signals.stepId, operationalOnboarding, resolved.shortcuts);

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
    shortcuts: resolvedShortcuts,
    focus: {
      component: 'AdaptiveFocusBanner',
      message: signals.focusMessage || copy.title,
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
    operationalOnboarding,
    fallback: {
      used: true,
      reason,
    },
  };
}

module.exports = { buildEnhancedInstantFallback };
