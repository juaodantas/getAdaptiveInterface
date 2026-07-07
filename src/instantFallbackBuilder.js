const {
  ADAPTIVE_MODES,
  ADAPTIVE_SOURCES,
  DASHBOARD_CONFIG,
  VISUAL_PRIORITIES,
} = require('./adaptiveContract');
const { deriveInstantSignals } = require('./instantDomainRules');
const { distributeFromRanking } = require('./instantRouteDistributor');

function buildEnhancedInstantFallback({ operationalContext, clientCapabilities, reason = 'deterministic_fallback' }) {
  const signals = deriveInstantSignals(operationalContext);
  const dashboard = DASHBOARD_CONFIG[signals.dashboardId] || DASHBOARD_CONFIG.TAREFAS_PENDENTES;
  const confidence = reason === 'gemini_invalid_response' ? 0.68 : 0.64;

  const { nextStep, infoRec, shortcuts } = distributeFromRanking({
    ranking: signals.ranking || [],
    enrichedRoutes: null,
    clientCapabilities,
    stepId: signals.stepId,
    confidence,
  });

  return {
    responseVersion: '1.0',
    mode: ADAPTIVE_MODES.INSTANT,
    source: ADAPTIVE_SOURCES.FALLBACK,
    dashboard: dashboard.displayName,
    dashboardId: dashboard.id,
    cardType: dashboard.cardType,
    confidence,
    visualPriority: VISUAL_PRIORITIES.MODERATE,
    nextStepPrediction: nextStep,
    sectionAdaptations: [
      {
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: nextStep.title,
        description: nextStep.description,
      },
    ],
    shortcuts,
    focus: {
      component: 'AdaptiveFocusBanner',
      message: `Próximo foco: ${nextStep.title}.`,
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
    reason: nextStep.description,
    reasonDetails: {
      summary: nextStep.description,
      details: signals.rulesApplied,
      display: 'info_icon',
    },
    rulesApplied: signals.rulesApplied,
    infoRecommendation: infoRec,
    fallback: {
      used: true,
      reason,
    },
  };
}

module.exports = { buildEnhancedInstantFallback };
