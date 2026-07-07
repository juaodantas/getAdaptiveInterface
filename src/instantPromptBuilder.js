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

  const ranking = Array.isArray(signals.ranking) ? signals.ranking : [];
  const rankingLabels = ranking.map((route, i) => {
    const slot = i === 0 ? 'Card principal (próximo passo)' : i === 1 ? 'Card informativo' : `Atalho ${i - 1}`;
    return `${i + 1}. ${route} → ${slot}`;
  }).join('\n');

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

Aqui está o ranking de rotas recomendadas para o passo atual:
${rankingLabels}

Para cada rota, forneça title (título curto), description (descrição), actionLabel (rótulo do botão)
e reason (justificativa opcional ou null). Seja genérico e evite dados identificáveis.

Retorne APENAS JSON válido, sem markdown, seguindo o schema obrigatório:
{
  "responseVersion":"1.0",
  "confidence":0.0,
  "enrichedRoutes":[
    {"title":"texto curto","description":"texto curto","actionLabel":"texto curto","reason":"texto curto ou null"},
    {"title":"texto curto","description":"texto curto","actionLabel":"texto curto","reason":"texto curto ou null"},
    ...
  ],
  "reason":"texto curto ou null",
  "reasonDetails":{"summary":"texto curto","details":["sinais técnicos"],"display":"info_icon"},
  "rulesApplied":["RULE-010"]
}

O array enrichedRoutes deve ter exatamente ${ranking.length} entradas, uma para cada rota no ranking acima.

JSON de contexto sanitizado:
${JSON.stringify(promptPayload)}`;
}

module.exports = { buildInstantPrompt };
