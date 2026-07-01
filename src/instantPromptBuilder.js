const {
  ALLOWED_INSTANT_ROUTES,
  DASHBOARD_CONFIG,
  FORBIDDEN_COMPONENTS,
} = require('./adaptiveContract');
const { DOMAIN_RULES } = require('./instantDomainRules');

function buildInstantPrompt({ navigationContext, sessionNavigations, operationalContext, clientCapabilities, signals }) {
  const dashboards = Object.values(DASHBOARD_CONFIG).map((dashboard) => ({
    id: dashboard.id,
    displayName: dashboard.displayName,
    cardType: dashboard.cardType,
  }));

  const promptPayload = {
    navigationContext,
    sessionNavigations,
    operationalContext,
    clientCapabilities: {
      supportedComponents: clientCapabilities.supportedComponents,
      maxShortcuts: clientCapabilities.maxShortcuts,
      maxSectionAdaptations: clientCapabilities.maxSectionAdaptations,
      supportsInfoIconExplanation: clientCapabilities.supportsInfoIconExplanation,
      supportsHighlightFrame: clientCapabilities.supportsHighlightFrame,
    },
    deterministicSignals: signals,
    allowedRoutes: ALLOWED_INSTANT_ROUTES,
    dashboards,
    forbiddenComponents: FORBIDDEN_COMPONENTS,
    domainRules: DOMAIN_RULES,
  };

  return `Você é um recomendador conservador para um app agrícola.
Use somente flags, contagens, rotas e categorias técnicas do JSON abaixo.
Não invente entidades, nomes de lotes, usuários, tarefas ou textos livres identificáveis.
Não retorne progress bar, stepper, checklist nem componente equivalente.
Rotas permitidas são somente as listadas em allowedRoutes.
Componentes permitidos são somente os suportados pelo cliente e não proibidos.
Retorne APENAS JSON válido, sem markdown, seguindo o schema obrigatório:
{
  "responseVersion":"1.0",
  "dashboard":"nome ou null",
  "dashboardId":"ID ou null",
  "cardType":"tipo ou null",
  "confidence":0.0,
  "nextStepPrediction":{"stepId":"id","confidence":0.0,"title":"texto curto","description":"texto curto","targetRoute":"/rota","actionLabel":"texto curto"},
  "sectionAdaptations":[{"sectionId":"recommended_actions","component":"NextStepCard","priority":"high","treatment":"prominent","title":"texto curto","description":"texto curto"}],
  "shortcuts":[{"route":"/rota","confidence":0.0,"label":"texto curto","reason":"texto curto"}],
  "focus":{"component":"AdaptiveFocusBanner","message":"texto curto","targetSectionId":"recommended_actions","priority":"high"},
  "uiTreatment":{"density":"comfortable","emphasis":"moderate","animation":"subtle","explanationVisibility":"low","showProgressBar":false},
  "reason":"texto curto ou null",
  "reasonDetails":{"summary":"texto curto","details":["sinais técnicos"],"display":"info_icon"},
  "rulesApplied":["RULE-010"]
}

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt };
