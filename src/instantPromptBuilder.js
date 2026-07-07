const {
  ALLOWED_INSTANT_ROUTES,
  ALLOWED_INFO_CTA_ROUTES,
  DASHBOARD_CONFIG,
  FORBIDDEN_COMPONENTS,
  INFO_RECOMMENDATION_TYPES,
  INFO_RECOMMENDATION_SOURCES,
  INFO_RECOMMENDATION_PRIORITIES,
  INFO_RECOMMENDATION_CATEGORIES,
} = require('./adaptiveContract');
const { DOMAIN_RULES } = require('./instantDomainRules');

function buildInstantPrompt({ navigationContext, sessionNavigations, operationalContext, clientCapabilities, signals }) {
  const dashboards = Object.values(DASHBOARD_CONFIG).map((dashboard) => ({
    id: dashboard.id,
    displayName: dashboard.displayName,
    cardType: dashboard.cardType,
  }));

  const agendaState = operationalContext.agendaState || {};
  const currentActivity = agendaState.nextActivity || {};

  const promptPayload = {
    navigationContext,
    sessionNavigations,
    operationalContext,
    currentActivityContext: {
      title: currentActivity.title || null,
      description: currentActivity.description || null,
      type: currentActivity.type || null,
      status: currentActivity.status || null,
      dueLabel: currentActivity.dueLabel || null,
    },
    stepContext: {
      stepId: signals.stepId,
      targetRoute: signals.targetRoute,
      description: (signals.rulesApplied || []).join(', '),
    },
    clientCapabilities: {
      supportedComponents: clientCapabilities.supportedComponents,
      maxShortcuts: Math.min(clientCapabilities.maxShortcuts || 3, 3),
      maxSectionAdaptations: clientCapabilities.maxSectionAdaptations,
      supportsInfoIconExplanation: clientCapabilities.supportsInfoIconExplanation,
      supportsHighlightFrame: clientCapabilities.supportsHighlightFrame,
      supportedInfoTypes: clientCapabilities.supportedInfoTypes,
    },
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

OBSERVAÇÃO IMPORTANTE: targetRoute, ctaRoute e cada shortcut.route devem ser TODOS DIFERENTES entre si.
Nenhuma rota pode se repetir. Se uma rota já foi usada em targetRoute ou ctaRoute, escolha outra para os shortcuts.

Contexto da atividade atual disponível em currentActivityContext.
Use title e description para contextualizar as recomendações (title, description, actionLabel, reason).
NÃO repita o título da atividade como texto livre se ele contiver dados identificáveis.
Prefira generalizar: "Aplicação de nutrientes" → "atividade de aplicação".

Retorne APENAS JSON válido, sem markdown, seguindo o schema obrigatório:
{
  "responseVersion":"1.0",
  "confidence":0.0,
  "nextStepPrediction":{"stepId":"id do passo","targetRoute":"/rota","title":"texto curto","description":"texto curto","actionLabel":"texto curto"},
  "infoRecommendation":{"type":"${INFO_RECOMMENDATION_TYPES.join('|')}","source":"${INFO_RECOMMENDATION_SOURCES.join('|')}","priority":"${INFO_RECOMMENDATION_PRIORITIES.join('|')}","title":"texto curto","reason":"texto curto","ctaRoute":"/rota","category":"${INFO_RECOMMENDATION_CATEGORIES.join('|')}"},
  "shortcuts":[{"route":"/rota","confidence":0.0,"label":"texto curto","reason":"texto curto"}],
  "reason":"texto curto ou null",
  "reasonDetails":{"summary":"texto curto","details":["sinais técnicos"],"display":"info_icon"},
  "rulesApplied":["RULE-010"]
}

REGRAS:
- nextStepPrediction.targetRoute deve ser a rota MAIS importante para o passo atual.
- infoRecommendation.ctaRoute deve ser DIFERENTE de targetRoute.
- shortcuts deve ter no MÁXIMO 3 itens. Cada shortcut.route deve ser DIFERENTE de targetRoute e de ctaRoute.
- infoRecommendation.type deve usar um dos tipos permitidos.
- infoRecommendation.ctaRoute deve estar na allowlist da Info.
- shortcuts[].route deve estar em allowedRoutes.

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt };
