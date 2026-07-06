const {
  ALLOWED_INSTANT_ROUTES,
  ALLOWED_INFO_CTA_ROUTES,
  DASHBOARD_CONFIG,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_CATEGORIES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_TYPES,
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
      supportedInfoTypes: clientCapabilities.supportedInfoTypes,
    },
    deterministicSignals: signals,
    allowedRoutes: ALLOWED_INSTANT_ROUTES,
    infoRecommendationContract: {
      required: true,
      types: INFO_RECOMMENDATION_TYPES,
      supportedInfoTypes: clientCapabilities.supportedInfoTypes,
      sources: INFO_RECOMMENDATION_SOURCES,
      priorities: INFO_RECOMMENDATION_PRIORITIES,
      categories: INFO_RECOMMENDATION_CATEGORIES,
      allowedCtaRoutes: ALLOWED_INFO_CTA_ROUTES,
    },
    dashboards,
    forbiddenComponents: FORBIDDEN_COMPONENTS,
    domainRules: DOMAIN_RULES,
  };

  // If agenda has last interaction context, include it (sanitized)
  if (operationalContext.agendaState && operationalContext.agendaState.lastInteractionType) {
    promptPayload.lastAgendaInteraction = {
      type: operationalContext.agendaState.lastInteractionType,
      title: operationalContext.agendaState.lastActivityTitle || null,
      description: operationalContext.agendaState.lastActivityDescription || null,
    };
  }

  return `Você é um recomendador conservador para um app agrícola.
Use somente flags, contagens, rotas e categorias técnicas do JSON abaixo.
Não invente entidades, nomes de lotes, usuários, tarefas ou textos livres identificáveis.
Não retorne progress bar, stepper, checklist nem componente equivalente.
Rotas permitidas são somente as listadas em allowedRoutes.
Componentes permitidos são somente os suportados pelo cliente e não proibidos.
infoRecommendation é obrigatório, deve usar somente enums/rotas allowlisted do contrato e não pode usar dados identificáveis.
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
  "rulesApplied":["RULE-010"],
  "infoRecommendation":{"type":"today_cultivation|reservoir_report|day_progress|field_notes_summary|basic_tip","source":"isis|local_tip|fallback","priority":"low|medium|high","title":"texto curto genérico","reason":"texto curto genérico","ctaRoute":"/rota allowlisted","category":"geral|agenda|lote|protocolo|solucao|reservatorio|caderno_campo|cultivo"}
}

Se disponível, a última interação na Agenda foi:
  tipo=<tipo>
  título="<título>"

Use essa informação para contextualizar a infoRecommendation (title e reason),
mas NÃO repita o título da atividade como texto livre no title/reason se ele
contiver dados sensíveis. Prefira generalizar: "Aplicação de nutrientes" →
"atividade de aplicação".

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt };
