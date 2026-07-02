const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  DASHBOARD_CONFIG,
  VISUAL_PRIORITIES,
} = require('./adaptiveContract');
const { deriveInstantSignals } = require('./instantDomainRules');
const { buildInfoRecommendationFallback } = require('./instantInfoRecommendationBuilder');

const STEP_COPY = {
  create_lot_with_protocol: {
    title: 'Cadastre um lote com protocolo',
    description: 'Comece vinculando um protocolo ao lote para gerar próximas atividades.',
    actionLabel: 'Abrir Protocolos',
  },
  check_generated_agenda_activities: {
    title: 'Verifique as atividades geradas na Agenda',
    description: 'O lote com protocolo já foi criado. Agora confira as atividades geradas para continuar o fluxo.',
    actionLabel: 'Abrir Agenda',
  },
  execute_nutrition_adjustment: {
    title: 'Execute o ajuste nutricional pendente',
    description: 'Há um ajuste nutricional pendente para manter o roteiro operacional.',
    actionLabel: 'Abrir Solução',
  },
  check_field_notebook: {
    title: 'Confira o registro no Caderno de Campo',
    description: 'Depois do ajuste, valide o registro operacional no caderno.',
    actionLabel: 'Abrir Caderno',
  },
  finish_agenda_activities: {
    title: 'Conclua as pendências na Agenda',
    description: 'Ainda há atividades pendentes após a conferência do caderno.',
    actionLabel: 'Abrir Agenda',
  },
  review_final_home_context: {
    title: 'Confira o resumo final do fluxo',
    description: 'As atividades principais foram concluídas. Revise o contexto final.',
    actionLabel: 'Ver Relatórios',
  },
  review_critical_alerts: {
    title: 'Revise alertas operacionais críticos',
    description: 'Há alertas críticos que devem receber prioridade antes de produção.',
    actionLabel: 'Abrir Agenda',
  },
  resolve_overdue_agenda_tasks: {
    title: 'Resolva tarefas atrasadas',
    description: 'Existem atividades atrasadas e a Agenda deve ser priorizada.',
    actionLabel: 'Abrir Agenda',
  },
  review_agenda_context: {
    title: 'Revise o próximo contexto na Agenda',
    description: 'A Agenda é o caminho seguro para continuar o roteiro operacional.',
    actionLabel: 'Abrir Agenda',
  },
};

function buildEnhancedInstantFallback({ operationalContext, clientCapabilities, reason = 'deterministic_fallback' }) {
  const signals = deriveInstantSignals(operationalContext);
  const dashboard = DASHBOARD_CONFIG[signals.dashboardId] || DASHBOARD_CONFIG.TAREFAS_PENDENTES;
  const copy = STEP_COPY[signals.stepId] || STEP_COPY.review_agenda_context;
  const confidence = reason === 'gemini_invalid_response' ? 0.68 : 0.64;

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
      targetRoute: signals.targetRoute,
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
    shortcuts: [
      {
        route: signals.targetRoute,
        confidence,
        label: copy.actionLabel,
        reason: copy.description,
      },
    ],
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
    infoRecommendation: buildInfoRecommendationFallback({ signals, clientCapabilities }),
    fallback: {
      used: true,
      reason,
    },
  };
}

module.exports = { buildEnhancedInstantFallback };
