const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const jwt = require('jsonwebtoken');
const {
  ADAPTIVE_MODES,
  VISUAL_PRIORITIES,
  ADAPTIVE_SOURCES,
  DASHBOARD_CONFIG,
  DASHBOARD_MAP,
  EXCLUDED_PAGES_ARRAY,
  SCREEN_RESOURCE_REQUIREMENTS,
  SAFE_LOTE_FALLBACK_ROUTE,
  normalizeNonEmptyString,
  hasValidCardType,
} = require('./src/adaptiveContract');
const { resolveRequestSessionId } = require('./src/sessionContext');
const { buildEnhancedInstantRecommendation } = require('./src/enhancedInstantMode');
const { createInstantRecommendationCacheFirestoreAdapter } = require('./src/instantRecommendationCacheFirestoreAdapter');
const { getSupportedMetricEventsSqlList } = require('./src/adaptiveMetrics');
const experimentalGroups = require('./src/experimentalGroups');

admin.initializeApp();

const db = admin.firestore();
const bigquery = new BigQuery();
const instantRecommendationCache = createInstantRecommendationCacheFirestoreAdapter(db, admin);

// ============================================
// CONFIGURAÇÃO — via variáveis de ambiente
// ============================================

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID;
const ANALYTICS_DATASET = process.env.BIGQUERY_ANALYTICS_DATASET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;

// ============================================
// ADAPTIVE MODES — configuração de modos de adaptação
// ============================================

const EXCLUDED_PAGES_SQL = `
  '/modulosPage', '/splashPage', '/loginPage', '/homePage',
  '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
  '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
`;

// ============================================
// REQUISITOS DE RECURSO POR TELA
// ============================================
// Mapeia telas que exigem um resourceId/resourceType para funcionar corretamente.
// Se uma tela está aqui e o shortcut não tem recurso, ela será descartada.
const USER_ID_SQL = `
  COALESCE(
    (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
    CAST(user_id AS STRING),
    'anonymous'
  )
`;

// ============================================
// CONFIGURAÇÃO DOS DASHBOARDS
// ============================================
// Definição centralizada com metadados técnicos para o frontend
// ============================================
// ADAPTIVE MODES — helper functions
// ============================================

async function getUserConfig(userId) {
  try {
    const doc = await db.collection('userAdaptiveConfig').doc(userId).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data();
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      return null;
    }
    return data;
  } catch (error) {
    console.error(`[CF] Erro ao buscar config do usuário "${userId}":`, error.message);
    return null;
  }
}

async function getSessionNavigations(sessionId) {
  try {
    const snapshot = await db
      .collection('sessionNavigations')
      .doc(sessionId)
      .collection('navigations')
      .orderBy('timestamp', 'asc')
      .get();
    return snapshot.docs.map((doc) => doc.data());
  } catch (error) {
    console.error(`[CF] Erro ao buscar navegações da sessão "${sessionId}":`, error.message);
    return [];
  }
}

function getDefaultShortcuts() {
  return [
    { route: SAFE_LOTE_FALLBACK_ROUTE, confidence: 0.5 },
    { route: '/solucaoPage', confidence: 0.5 },
    { route: '/agendaPage', confidence: 0.5 },
    { route: '/reservatoriosPage', confidence: 0.5 },
  ];
}

function visualPriorityForMode(mode, confidence, hasRecommendation) {
  if (!hasRecommendation || mode === ADAPTIVE_MODES.STATIC) {
    return VISUAL_PRIORITIES.NONE;
  }

  if (mode === ADAPTIVE_MODES.INSTANT) {
    return VISUAL_PRIORITIES.WEAK;
  }

  if (confidence >= 0.85) return VISUAL_PRIORITIES.STRONG;
  if (confidence >= 0.7) return VISUAL_PRIORITIES.MODERATE;
  if (confidence >= 0.4) return VISUAL_PRIORITIES.WEAK;
  return VISUAL_PRIORITIES.NONE;
}

function reasonForCardType(cardType, mode) {
  if (!hasValidCardType(cardType)) {
    return null;
  }

  const prefix = mode === ADAPTIVE_MODES.INSTANT ? 'Uso recente' : 'Padrão de uso';
  const labels = {
    tarefas: 'tarefas',
    lotes: 'cultivo',
    producao: 'produção',
    saude: 'atenção operacional',
  };

  return `${prefix}: ${labels[cardType]}`;
}

function withAdaptiveMetadata(recommendation, mode, sourceOverride) {
  const hasRecommendation = hasValidCardType(recommendation.cardType);
  const confidence = Math.max(0, Math.min(1, parseFloat(recommendation.confidence) || 0));
  let source = sourceOverride || recommendation.source;

  if (!source) {
    source = hasRecommendation ? ADAPTIVE_SOURCES.ADAPTIVE : ADAPTIVE_SOURCES.INSUFFICIENT_DATA;
  }

  return {
    ...recommendation,
    confidence,
    source,
    visualPriority: visualPriorityForMode(mode, confidence, hasRecommendation),
    reason: reasonForCardType(recommendation.cardType, mode),
  };
}

function fallbackResponse(mode, shortcuts) {
  return {
    dashboard: null,
    dashboardId: null,
    cardType: null,
    confidence: 0.0,
    shortcuts,
    mode,
    source: ADAPTIVE_SOURCES.FALLBACK,
    visualPriority: VISUAL_PRIORITIES.NONE,
    reason: null,
  };
}

function insufficientDataResponse(mode, shortcuts) {
  return {
    dashboard: null,
    dashboardId: null,
    cardType: null,
    confidence: 0.0,
    shortcuts,
    mode,
    source: ADAPTIVE_SOURCES.INSUFFICIENT_DATA,
    visualPriority: VISUAL_PRIORITIES.NONE,
    reason: null,
  };
}

function resolveEffectiveSessionId(requestSessionId, userConfig) {
  return normalizeNonEmptyString(requestSessionId) || normalizeNonEmptyString(userConfig?.sessionId);
}

function reportInstantCacheEvent(event) {
  console.log('[CF] INSTANT cache event', event);
}

function normalizeInstantNavigation(nav) {
  if (!nav || typeof nav !== 'object') {
    return null;
  }

  const screen = normalizeNonEmptyString(nav.screen)
    || normalizeNonEmptyString(nav.route)
    || normalizeNonEmptyString(nav.targetScreen);

  if (!screen) {
    return null;
  }

  const normalized = { screen };
  const resourceId = normalizeNonEmptyString(nav.resourceId);
  const resourceType = normalizeNonEmptyString(nav.resourceType);
  const resourceName = normalizeNonEmptyString(nav.resourceName);

  if (resourceId) normalized.resourceId = resourceId;
  if (resourceType) normalized.resourceType = resourceType;
  if (resourceName) normalized.resourceName = resourceName;
  if (nav.timestamp !== undefined) normalized.timestamp = nav.timestamp;

  return normalized;
}

function formatInstantResourceDetails(resource) {
  const details = [];

  if (resource.resourceType && resource.resourceId) {
    details.push(`${resource.resourceType}#${resource.resourceId}`);
  } else {
    if (resource.resourceType) details.push(`resourceType=${resource.resourceType}`);
    if (resource.resourceId) details.push(`resourceId=${resource.resourceId}`);
  }

  if (resource.resourceName) {
    details.push(`"${resource.resourceName}"`);
  }

  return details.join(' ');
}

function buildInstantHistoryText(normalizedNavigations) {
  const byScreen = new Map();

  normalizedNavigations.forEach((nav) => {
    const entry = byScreen.get(nav.screen) || { count: 0, resources: new Map() };
    entry.count += 1;

    if (nav.resourceId || nav.resourceType || nav.resourceName) {
      const details = formatInstantResourceDetails(nav);
      if (details) {
        entry.resources.set(details, details);
      }
    }

    byScreen.set(nav.screen, entry);
  });

  return [...byScreen.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([screen, entry]) => {
      const resources = [...entry.resources.values()].sort();
      const resourcesText = resources.length > 0
        ? ` | resources: ${resources.join('; ')}`
        : '';
      return `${screen} | visitas=${entry.count}x${resourcesText}`;
    })
    .join('\n');
}

function findRealLoteResourceFromInstantNavigations(normalizedNavigations) {
  const loteNavigation = normalizedNavigations.find((nav) => (
    nav.screen === '/lotePage' && hasRealLoteResource(nav)
  ));

  if (!loteNavigation) {
    return null;
  }

  const resource = {
    resourceId: loteNavigation.resourceId,
    resourceType: loteNavigation.resourceType,
  };

  if (loteNavigation.resourceName) {
    resource.resourceName = loteNavigation.resourceName;
  }

  return resource;
}

function enrichInstantLoteShortcutsWithHistory(shortcuts, normalizedNavigations) {
  const loteResource = findRealLoteResourceFromInstantNavigations(normalizedNavigations);

  if (!loteResource) {
    return shortcuts;
  }

  return shortcuts.map((shortcut) => {
    if (!shortcut || typeof shortcut !== 'object') {
      return shortcut;
    }

    if (shortcut.route !== '/lotePage' || hasRealLoteResource(shortcut)) {
      return shortcut;
    }

    return {
      ...shortcut,
      ...loteResource,
    };
  });
}

async function generateInstantRecommendation(navigations, hour, dayOfWeek) {
  const normalizedNavigations = (navigations || [])
    .map(normalizeInstantNavigation)
    .filter(Boolean);

  if (normalizedNavigations.length === 0) {
    console.log('[CF] INSTANT: Nenhuma navegação na sessão');
      return {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
        source: ADAPTIVE_SOURCES.INSUFFICIENT_DATA,
        visualPriority: VISUAL_PRIORITIES.NONE,
        reason: null,
      };
  }

  const navCount = normalizedNavigations.length;
  const maxConfidence = navCount < 10 ? Math.min(0.5, navCount * 0.05) : 0.5;
  const historyText = buildInstantHistoryText(normalizedNavigations);

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  const dashboardInfo = Object.values(DASHBOARD_CONFIG)
    .map((config) => `- "${config.displayName}" (cardType: "${config.cardType}"): ${config.screens.join(', ')}`)
    .join('\n');

  const validDashboardNames = Object.values(DASHBOARD_CONFIG)
    .map((config) => `"${config.displayName}"`)
    .join(', ');

  // Lista de telas que exigem resourceId/resourceType
  const screensRequiringResource = Object.entries(SCREEN_RESOURCE_REQUIREMENTS)
    .map(([route, req]) => `- "${route}" requer resourceId (tipo: "${req.type}")`)
    .join('\n');

  // Lista de telas proibidas
  const excludedPagesList = EXCLUDED_PAGES_ARRAY.join(', ');

  const prompt = `Você é um sistema de recomendação de navegação para um app agrícola.

Navegações desta sessão (${navCount} cliques):
${historyText}

Contexto atual: hora=${hour}h, dia_semana=${dayOfWeek} (1=Dom,2=Seg,3=Ter,4=Qua,5=Qui,6=Sex,7=Sáb)

Dashboards disponíveis e suas telas:
${dashboardInfo}

IMPORTANTE:
- Se houver menos de 3 navegações, retorne null para dashboard
- Confidence deve ser proporcional à quantidade de dados (máx ${maxConfidence.toFixed(2)})
- Priorize telas visitadas múltiplas vezes
- NUNCA retorne estas telas (são excluídas): ${excludedPagesList}
- Para as telas abaixo, só retorne se o histórico tiver resourceId/resourceType:
${screensRequiringResource}

Com base nas navegações desta sessão, retorne APENAS JSON válido sem markdown:
{"dashboard":"nome do dashboard ou null","dashboardId":"ID_TECNICO","cardType":"tipo_do_card","confidence":0.0,"shortcuts":[{"route":"/tela","confidence":0.0,"resourceId":"id opcional","resourceType":"tipo opcional","resourceName":"nome opcional"}]}

Regras:
- dashboard deve ser um dos valores válidos: ${validDashboardNames}
- dashboardId deve ser um dos valores: ${Object.keys(DASHBOARD_CONFIG).join(', ')}
- cardType deve ser um dos valores: ${[...new Set(Object.values(DASHBOARD_CONFIG).map(c => c.cardType))].join(', ')}
- confidence entre 0.0 e ${maxConfidence.toFixed(2)} (não ultrapasse este valor!)
- máximo 4 shortcuts
- priorize telas mais visitadas na sessão
- NÃO inclua telas excluídas: ${excludedPagesList}
- Só inclua telas com requisito de recurso se tiver resourceId e resourceType no histórico`;

  console.log(`[CF] INSTANT: Prompt para Gemini - navCount=${navCount}, maxConfidence=${maxConfidence.toFixed(2)}`);

  try {
    const result = await model.generateContent(prompt);
    const text = result.response
      .text()
      .trim()
      .replace(/```json?\n?/g, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      parsed.shortcuts = enrichInstantLoteShortcutsWithHistory(parsed.shortcuts || [], normalizedNavigations);
    }
    const recommendation = normalizeRecommendation(parsed);

    recommendation.confidence = Math.min(recommendation.confidence, maxConfidence);

    if (navCount < 3) {
      recommendation.dashboard = null;
      recommendation.dashboardId = null;
      recommendation.cardType = null;
    }

    console.log(`[CF] INSTANT: Recomendação gerada - dashboard="${recommendation.dashboard}", confidence=${(recommendation.confidence * 100).toFixed(1)}%`);
    return recommendation;
  } catch (error) {
    console.error('[CF] INSTANT: Erro no Gemini:', error.message);
      return {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
        source: ADAPTIVE_SOURCES.FALLBACK,
        visualPriority: VISUAL_PRIORITIES.NONE,
        reason: null,
      };
  }
}

// ============================================
// BIGQUERY — histórico de navegação
// ============================================

function buildHistoryQuery() {
  return `
    SELECT
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') AS target_screen,
      EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp)) AS hour,
      EXTRACT(DAYOFWEEK FROM TIMESTAMP_MICROS(event_timestamp)) AS day_of_week,
      COUNT(*) AS frequency
    FROM \`${PROJECT_ID}.${ANALYTICS_DATASET}.events_*\`
    WHERE event_name = 'navigation_click'
      AND ${USER_ID_SQL} = @userId
      AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
      AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
        ${EXCLUDED_PAGES_SQL}
      )
      AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    GROUP BY target_screen, hour, day_of_week
    ORDER BY frequency DESC
  `;
}

function buildActiveUsersQuery() {
  return `
    SELECT DISTINCT ${USER_ID_SQL} AS userId
    FROM \`${PROJECT_ID}.${ANALYTICS_DATASET}.events_*\`
    WHERE event_name = 'navigation_click'
      AND ${USER_ID_SQL} != 'anonymous'
      AND _TABLE_SUFFIX = FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))
  `;
}

async function fetchNavigationHistory(userId) {
  const [rows] = await bigquery.query({
    query: buildHistoryQuery(),
    location: "US",
    params: { userId },
  });
  return rows;
}

async function fetchActiveUsers() {
  const [rows] = await bigquery.query({
    query: buildActiveUsersQuery(),
    location: "US",
  });
  return rows.map((r) => r.userId);
}

// ============================================
// GEMINI — geração de recomendação via IA
// ============================================

async function generateRecommendation(hour, dayOfWeek, history) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

  const historyText =
    history.length > 0
      ? history
        .map(
          (r) =>
            `${r.target_screen} | hora=${r.hour}h | dia=${r.day_of_week} | freq=${r.frequency}x`,
        )
        .join("\n")
      : "Nenhum histórico disponível.";

  const dashboardInfo = Object.values(DASHBOARD_CONFIG)
    .map((config) => `- "${config.displayName}" (cardType: "${config.cardType}"): ${config.screens.join(", ")}`)
    .join("\n");

  const validDashboardNames = Object.values(DASHBOARD_CONFIG)
    .map((config) => `"${config.displayName}"`)
    .join(", ");

  // Lista de telas que exigem resourceId/resourceType
  const screensRequiringResource = Object.entries(SCREEN_RESOURCE_REQUIREMENTS)
    .map(([route, req]) => `- "${route}" requer resourceId (tipo: "${req.type}")`)
    .join("\n");

  // Lista de telas proibidas
  const excludedPagesList = EXCLUDED_PAGES_ARRAY.join(", ");

  const prompt = `Você é um sistema de recomendação de navegação para um app agrícola.

Histórico de navegação do usuário (últimos 30 dias):
${historyText}

Contexto atual: hora=${hour}h, dia_semana=${dayOfWeek} (1=Dom,2=Seg,3=Ter,4=Qua,5=Qui,6=Sex,7=Sáb)

Dashboards disponíveis e suas telas:
${dashboardInfo}

IMPORTANTE:
- NUNCA retorne estas telas (são excluídas): ${excludedPagesList}
- Para as telas abaixo, só retorne se o histórico tiver resourceId/resourceType:
${screensRequiringResource}

Com base no histórico e no contexto atual, retorne APENAS JSON válido sem markdown:
{"dashboard":"nome do dashboard ou null","dashboardId":"ID_TECNICO","cardType":"tipo_do_card","confidence":0.0,"shortcuts":[{"route":"/tela","confidence":0.0}]}

Regras:
- dashboard deve ser um dos valores válidos: ${validDashboardNames}
- dashboardId deve ser um dos valores: ${Object.keys(DASHBOARD_CONFIG).join(", ")}
- cardType deve ser um dos valores: ${[...new Set(Object.values(DASHBOARD_CONFIG).map(c => c.cardType))].join(", ")}
- confidence entre 0.0 e 1.0
- máximo 4 shortcuts
- priorize padrões do mesmo horário e dia da semana
- NÃO inclua telas excluídas: ${excludedPagesList}
- Só inclua telas com requisito de recurso se tiver resourceId e resourceType no histórico`;

  console.log(`[CF] Prompt para Gemini - hora=${hour}, dia=${dayOfWeek}`);

  const result = await model.generateContent(prompt);
  const text = result.response
    .text()
    .trim()
    .replace(/```json?\n?/g, "")
    .replace(/```/g, "")
    .trim();

  const parsed = JSON.parse(text);
  return normalizeRecommendation(parsed);
}

// ============================================
// FILTROS E VALIDAÇÕES DE SHORTCUTS
// ============================================

/**
 * Remove shortcuts que apontam para páginas excluídas das adaptações.
 */
function filterExcludedPages(shortcuts) {
  return shortcuts.filter((s) => {
    const route = s.route || '';
    return !EXCLUDED_PAGES_ARRAY.includes(route);
  });
}

/**
 * Valida se um shortcut que aponta para uma tela com requisito de recurso
 * possui os campos resourceId e resourceType preenchidos corretamente.
 * Retorna true se o shortcut é válido, false caso contrário.
 */
function validateShortcutResource(shortcut) {
  const route = shortcut.route || '';
  const requirement = SCREEN_RESOURCE_REQUIREMENTS[route];

  // Se a tela não tem requisito de recurso, está válida
  if (!requirement) {
    return true;
  }

  // Se tem requisito, verifica se os campos estão preenchidos
  const hasResourceId = shortcut.resourceId && String(shortcut.resourceId).trim() !== '';
  const hasResourceType = shortcut.resourceType && String(shortcut.resourceType).trim() !== '';

  if (!hasResourceId || !hasResourceType) {
    console.warn(
      `[CF] Shortcut inválido: rota "${route}" requer resourceId (${shortcut.resourceId}) ` +
      `e resourceType (${shortcut.resourceType}), mas estão faltando. Descartando.`
    );
    return false;
  }

  return true;
}

function hasRealLoteResource(shortcut) {
  return Boolean(
    normalizeNonEmptyString(shortcut.resourceId)
    && normalizeNonEmptyString(shortcut.resourceType) === 'lote'
  );
}

function sanitizeShortcutRouteResource(shortcut) {
  if (!shortcut || typeof shortcut !== 'object') {
    return shortcut;
  }

  if (shortcut.route !== '/lotePage' || hasRealLoteResource(shortcut)) {
    return shortcut;
  }

  return {
    ...shortcut,
    route: SAFE_LOTE_FALLBACK_ROUTE,
    resourceId: null,
    resourceType: null,
    resourceName: null,
  };
}

/**
 * Aplica todas as validações em uma lista de shortcuts:
 * 1. Remove páginas excluídas
 * 2. Remove páginas que exigem recurso mas não o possuem
 */
function validateShortcuts(shortcuts) {
  const sanitizedShortcuts = shortcuts.map(sanitizeShortcutRouteResource);
  const afterExclusion = filterExcludedPages(sanitizedShortcuts);
  const afterResourceValidation = afterExclusion.filter(validateShortcutResource);
  return afterResourceValidation;
}

// ============================================
// NORMALIZAÇÃO DA RECOMENDAÇÃO
// Garante que a resposta tenha todos os campos necessários
// ============================================
function normalizeRecommendation(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      dashboard: null,
      dashboardId: null,
      cardType: null,
      confidence: 0.0,
      shortcuts: [],
    };
  }

  // Tenta encontrar o dashboard nos campos possíveis
  const dashboardName = raw.dashboard || raw.dashboardName || null;
  let dashboardId = raw.dashboardId || null;
  let cardType = raw.cardType || null;

  // Se temos o nome do dashboard mas não o ID/cardType, busca na config
  if (dashboardName && (!dashboardId || !cardType)) {
    const config = Object.values(DASHBOARD_CONFIG).find(
      (c) => c.displayName === dashboardName,
    );
    if (config) {
      dashboardId = config.id;
      cardType = config.cardType;
    }
  }

  // Se temos o ID mas não o cardType, busca na config
  if (dashboardId && !cardType) {
    const config = DASHBOARD_CONFIG[dashboardId];
    if (config) {
      cardType = config.cardType;
    }
  }

  // Validação final: se não conseguimos mapear, retorna null
  if (!cardType || !DASHBOARD_CONFIG[dashboardId]) {
    console.warn(`[CF] Dashboard não mapeado: "${dashboardName}" / ID: "${dashboardId}"`);
    return {
      dashboard: null,
      dashboardId: null,
      cardType: null,
      confidence: 0.0,
      shortcuts: validateShortcuts(raw.shortcuts || []),
    };
  }

  // Normaliza os shortcuts
  const normalizedShortcuts = (raw.shortcuts || []).slice(0, 3).map((s) => ({
    route: s.route || s.predicted_target_screen || "",
    confidence: Math.max(0, Math.min(1, parseFloat(s.confidence || s.prob) || 0.5)),
    resourceId: s.resourceId || null,
    resourceType: s.resourceType || null,
    resourceName: s.resourceName || null,
  }));

  // Aplica validações: remove páginas excluídas e shortcuts sem recurso obrigatório
  const validatedShortcuts = validateShortcuts(normalizedShortcuts);

  console.log(
    `[CF] Shortcuts: ${normalizedShortcuts.length} originais → ${validatedShortcuts.length} após validação`
  );

  return {
    dashboard: dashboardName,
    dashboardId: dashboardId,
    cardType: cardType,
    confidence: Math.max(0, Math.min(1, parseFloat(raw.confidence) || 0)),
    shortcuts: validatedShortcuts,
  };
}

// ============================================
// FIRESTORE — cache diário por usuário
// ============================================

function getCacheDocRef(userId) {
  const today = new Date().toISOString().split("T")[0];
  return db.collection("adaptiveInterfaceCache").doc(`${userId}_${today}`);
}

async function getCache(userId) {
  const doc = await getCacheDocRef(userId).get();
  return doc.exists ? doc.data() : null;
}

async function setCache(userId, recommendation) {
  await getCacheDocRef(userId).set({
    ...recommendation,
    cachedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ============================================
// FUNCTION 1: serving — chamada pelo frontend
// ============================================

exports.getAdaptiveInterface = onCall(async (request) => {
  if (!PROJECT_ID || !ANALYTICS_DATASET || !GEMINI_API_KEY) {
    console.error("[CF] Variáveis de ambiente obrigatórias não configuradas");
    return fallbackResponse(ADAPTIVE_MODES.GRADUAL, []);
  }

  const data = request.data;
  const rawUserId = data.userId || request.auth?.uid;
  const userId = rawUserId ? String(rawUserId).trim() : null;

  if (!userId) {
    console.error("[CF] userId não fornecido");
    return fallbackResponse(ADAPTIVE_MODES.GRADUAL, []);
  }

  const rawHour =
    data.hour !== undefined ? Number(data.hour) : new Date().getHours();
  const currentHour =
    Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
      ? rawHour
      : new Date().getHours();
  const dayOfWeek = new Date().getDay() + 1;

  const requestMode = data.mode || null;
  const requestSessionId = resolveRequestSessionId(data);
  const requestHasSessionId = Boolean(normalizeNonEmptyString(requestSessionId));
  const shouldFetchUserConfig = !requestMode
    || (requestMode === ADAPTIVE_MODES.INSTANT && !requestHasSessionId);
  const userConfig = shouldFetchUserConfig
    ? await getUserConfig(userId)
    : null;

  let mode = requestMode || userConfig?.mode || ADAPTIVE_MODES.GRADUAL;
  const sessionId = mode === ADAPTIVE_MODES.INSTANT
    ? normalizeNonEmptyString(requestSessionId)
    : resolveEffectiveSessionId(requestSessionId, userConfig);

  if (!Object.values(ADAPTIVE_MODES).includes(mode)) {
    console.warn(`[CF] Modo inválido "${mode}", usando GRADUAL`);
    mode = ADAPTIVE_MODES.GRADUAL;
  }

  console.log(`[CF] Modo determinado: ${mode} — userId="${userId}"`);

  switch (mode) {
    case ADAPTIVE_MODES.STATIC:
      console.log(`[CF] STATIC: Retornando atalhos padrão`);
      return {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
        mode: ADAPTIVE_MODES.STATIC,
        source: ADAPTIVE_SOURCES.SYSTEM,
        visualPriority: VISUAL_PRIORITIES.NONE,
        reason: null,
      };

    case ADAPTIVE_MODES.INSTANT:
      if (!sessionId) {
        console.error(`[CF] INSTANT: sessionId obrigatório não fornecido`);
        throw new HttpsError('invalid-argument', 'sessionId é obrigatório para o modo INSTANT');
      }

      try {
        console.log(`[CF] INSTANT: Buscando navegações da sessão "${sessionId}"`);
        const navigations = await getSessionNavigations(sessionId);
        return buildEnhancedInstantRecommendation({
          data,
          sessionNavigations: navigations,
          geminiApiKey: GEMINI_API_KEY,
          instantRecommendationCache,
          cacheEventReporter: reportInstantCacheEvent,
        });
      } catch (error) {
        console.error(`[CF] INSTANT: Erro ao processar sessão:`, error.message);
        return buildEnhancedInstantRecommendation({
          data,
          sessionNavigations: [],
          geminiApiKey: GEMINI_API_KEY,
          geminiGenerateText: async () => {
            throw new Error('instant_orchestration_error');
          },
          instantRecommendationCache,
          cacheEventReporter: reportInstantCacheEvent,
        });
      }

    case ADAPTIVE_MODES.GRADUAL:
    default:
      const cached = await getCache(userId);
      if (cached) {
        console.log(`[CF] Cache hit — userId="${userId}"`);
        const normalized = normalizeRecommendation(cached);
        console.log(`[CF] Cache retornado: dashboard="${normalized.dashboard}", cardType="${normalized.cardType}"`);
        return {
          ...withAdaptiveMetadata(normalized, ADAPTIVE_MODES.GRADUAL),
          mode: ADAPTIVE_MODES.GRADUAL,
        };
      }

      console.log(
        `[CF] Cache miss — gerando para userId="${userId}" hour=${currentHour}`,
      );

      try {
        const history = await fetchNavigationHistory(userId);
        const recommendation = await generateRecommendation(currentHour, dayOfWeek, history);
        await setCache(userId, recommendation);
        console.log(`[CF] Recomendação gerada e cacheada — userId="${userId}"`);
        console.log(`[CF] Resposta: dashboard="${recommendation.dashboard}", cardType="${recommendation.cardType}", confidence=${(recommendation.confidence * 100).toFixed(1)}%`);
        return {
          ...withAdaptiveMetadata(recommendation, ADAPTIVE_MODES.GRADUAL),
          mode: ADAPTIVE_MODES.GRADUAL,
        };
      } catch (error) {
        console.error("[CF] Erro ao gerar recomendação:", error.message);
        return fallbackResponse(ADAPTIVE_MODES.GRADUAL, []);
      }
  }
}, 
);

// ============================================
// FUNCTION 2: batch — acionada pelo Cloud Scheduler
// Processa usuários ativos do dia anterior e pré-aquece o cache
// ============================================

exports.generateDailyRecommendations = onRequest(
  { timeoutSeconds: 540, memory: "256MiB" },
  async (req, res) => {
    if (req.headers["x-scheduler-secret"] !== SCHEDULER_SECRET) {
      res.status(401).send("Unauthorized");
      return;
    }

    if (!PROJECT_ID || !ANALYTICS_DATASET || !GEMINI_API_KEY) {
      res.status(500).send("Variáveis de ambiente não configuradas");
      return;
    }

    // 4100ms entre chamadas = ~14.5 req/min, dentro do limite de 15 RPM do free tier
    const RATE_LIMIT_MS = 4100;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay() + 1;
    let success = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const users = await fetchActiveUsers();
      console.log(`[Batch] ${users.length} usuários ativos encontrados`);

      for (const userId of users) {
        try {
          const cached = await getCache(userId);
          if (cached) {
            skipped++;
            continue;
          }

          const history = await fetchNavigationHistory(userId);
          const recommendation = await generateRecommendation(hour, dayOfWeek, history);
          await setCache(userId, recommendation);
          console.log(`[Batch] Processado userId="${userId}"`);
          success++;

          await sleep(RATE_LIMIT_MS);
        } catch (err) {
          console.error(`[Batch] Erro userId="${userId}":`, err.message);
          errors++;
        }
      }

      const summary = { total: users.length, success, skipped, errors };
      console.log("[Batch] Concluído —", summary);
      res.status(200).json(summary);
    } catch (error) {
      console.error("[Batch] Erro geral:", error.message);
      res.status(500).send(error.message);
    }
  },
);

exports.autoAssignAdaptiveExperiment = onCall(async (request) => {
  const { userId, isisToken } = request.data || {};
  const uid = userId ? String(userId).trim() : null;

  if (!uid || !isisToken) {
    throw new HttpsError('invalid-argument', 'userId e isisToken são obrigatórios');
  }

  if (!process.env.ISIS_JWT_SECRET) {
    throw new HttpsError('failed-precondition', 'ISIS_JWT_SECRET não configurado');
  }

  try {
    const payload = jwt.verify(isisToken, process.env.ISIS_JWT_SECRET);
    if (String(payload?.id) !== uid) {
      throw new HttpsError('permission-denied', 'Token não pertence ao usuário informado');
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unauthenticated', 'Token ISIS inválido');
  }

  try {
    return await experimentalGroups.autoAssignParticipant(db, admin, uid);
  } catch (error) {
    console.error('[ExperimentalGroups] Erro na autoatribuição:', error.message);
    throw new HttpsError(error.isValidationError ? 'invalid-argument' : 'internal', error.message);
  }
});

// ============================================
// ADMIN ADAPTIVE MODE — API HTTP para gestão
// ============================================

const ADMIN_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

/**
 * Cloud Function HTTP para gerenciamento de modos adaptativos.
 *
 * Endpoints (todos requerem ?key=<ADMIN_KEY>):
 *   GET    — lista configs ou busca por userId (?userId=xxx)
 *   POST   — configura usuário (body: {userId, mode, sessionId, testGroup, expiresAt})
 *   DELETE — encerra sessão e remove config (?userId=xxx)
 *
 * Auth: header Authorization: Bearer <key> ou query param ?key=<key>
 * Config: firebase functions:config:set admin.key="sua-chave"
 */
exports.adminAdaptiveMode = onRequest(
  { cors: true },
  async (req, res) => {
    // Auth simples via API key
    const apiKey =
      req.headers.authorization?.split('Bearer ')[1] ||
      req.query?.key ||
      req.body?.key;
    const expectedKey = process.env.ADMIN_KEY;

    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const method = req.method;
    if (!ADMIN_ALLOWED_METHODS.includes(method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      // GET — listar ou buscar config
      if (method === 'GET') {
        const collection = req.query?.collection || req.body?.collection;
        if (collection === 'experimentalGroups') {
          const experimentId = req.query?.id || req.query?.experimentId || req.body?.id || req.body?.experimentId;
          if (experimentId) {
            const experiment = await experimentalGroups.getExperiment(db, experimentId);
            return res.json(experiment);
          }

          const experiments = await experimentalGroups.listExperiments(db);
          return res.json(experiments);
        }

        const userId = req.query?.userId || req.body?.userId;

        if (userId) {
          const doc = await db.collection('userAdaptiveConfig').doc(String(userId)).get();
          if (!doc.exists) return res.json(null);
          return res.json({ id: doc.id, ...doc.data() });
        }

        const snap = await db.collection('userAdaptiveConfig')
          .orderBy('createdAt', 'desc')
          .get();
        return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }

      // POST / PUT — criar ou atualizar config
      if (method === 'POST' || method === 'PUT') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        if (body.action === 'advanceExperimentPeriod') {
          const result = await experimentalGroups.advanceExperimentPeriod(db, admin, body.experimentId);
          return res.json(result);
        }

        if (body.action === 'assignParticipantToGroup') {
          const result = await experimentalGroups.assignParticipantToGroup(db, admin, body);
          return res.json(result);
        }

        if (body.action === 'completeExperiment') {
          const result = await experimentalGroups.completeExperiment(db, admin, body.experimentId);
          return res.json(result);
        }

        if (body.action === 'autoAssignParticipant') {
          const result = await experimentalGroups.autoAssignParticipant(db, admin, body.userId);
          return res.json(result);
        }

        if (body.collection === 'experimentalGroups') {
          const result = await experimentalGroups.saveExperiment(db, admin, body);
          return res.json(result);
        }

        const { userId, mode, sessionId, testGroup, expiresAt } = body;

        if (!userId || !mode) {
          return res.status(400).json({ error: 'userId e mode são obrigatórios' });
        }
        if (!Object.values(ADAPTIVE_MODES).includes(mode)) {
          return res.status(400).json({ error: `Modo inválido. Permitidos: ${Object.values(ADAPTIVE_MODES).join(', ')}` });
        }

        const batch = db.batch();
        const configRef = db.collection('userAdaptiveConfig').doc(String(userId));

        const configData = {
          userId: String(userId),
          mode,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (sessionId) configData.sessionId = sessionId;
        if (testGroup) configData.testGroup = testGroup;
        if (expiresAt) {
          configData.expiresAt = admin.firestore.Timestamp.fromDate(new Date(expiresAt));
        }

        batch.set(configRef, configData, { merge: true });

        // Se INSTANT e sessionId informado, garante documento de sessão
        // GRADUAL e STATIC não precisam de sessão
        if (mode === ADAPTIVE_MODES.INSTANT && sessionId) {
          const sessionRef = db.collection('sessionNavigations').doc(sessionId);
          batch.set(sessionRef, {
            sessionId,
            userId: String(userId),
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
          }, { merge: true });
          console.log(`[Admin] ${userId} → modo ${mode}, sessão criada: ${sessionId}`);
        } else {
          console.log(`[Admin] ${userId} → modo ${mode} (sem sessão - apenas INSTANT cria sessão)`);
        }

        await batch.commit();
        console.log(`[Admin] Config salva: ${userId} → modo ${mode}`);
        return res.json({ success: true, userId, mode, sessionId: mode === ADAPTIVE_MODES.INSTANT ? sessionId : null });
      }

      // DELETE — encerrar sessão e remover config
      if (method === 'DELETE') {
        const collection = req.query?.collection || req.body?.collection;
        if (collection === 'experimentalGroups') {
          const experimentId = req.query?.id || req.query?.experimentId || req.body?.id || req.body?.experimentId;
          const result = await experimentalGroups.deleteExperiment(db, experimentId);
          return res.json(result);
        }

        const userId = req.query?.userId || req.body?.userId;
        if (!userId) {
          return res.status(400).json({ error: 'userId é obrigatório' });
        }

        const uid = String(userId);
        // Busca sessionId antes de deletar config
        const configDoc = await db.collection('userAdaptiveConfig').doc(uid).get();
        const sid = configDoc.exists ? configDoc.data()?.sessionId : null;

        await db.collection('userAdaptiveConfig').doc(uid).delete();

        if (sid) {
          await db.collection('sessionNavigations').doc(sid).update({
            status: 'completed',
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[Admin] Sessão encerrada: ${uid}, sessionId=${sid}`);
        } else {
          console.log(`[Admin] Config removida: ${uid} (sem sessão ativa)`);
        }

        return res.json({ success: true, userId: uid });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
      console.error('[Admin] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

// ============================================
// FUNCTION 3: batch aggregation — acionada pelo Cloud Scheduler
// Agrega métricas de eficácia do BigQuery → Firestore
// Configurar no GCP Cloud Scheduler:
//   URL: <function_url>/aggregateUserMetrics
//   Schedule: 0 3 * * * (todo dia às 3h UTC)
//   Header: x-scheduler-secret: <SCHEDULER_SECRET>
//   Method: GET
// ============================================

/**
 * Agrega métricas de eficácia do BigQuery para cada usuário
 * e salva no Firestore na collection userMetrics/{userId}.
 *
 * Eventos lidos do BigQuery:
 *   - session_start
 *   - shortcuts_shown
 *   - shortcut_clicked
 *   - dashboard_shown
 *   - dashboard_changed
 *   - first_productive_navigation
 *
 * Pode ser chamada manualmente (com ADMIN_KEY) ou via Scheduler.
 */
exports.aggregateUserMetrics = onRequest(
  { cors: true },
  async (req, res) => {
    // Auth: permite via ADMIN_KEY ou SCHEDULER_SECRET
    const apiKey =
      req.headers.authorization?.split('Bearer ')[1] ||
      req.query?.key ||
      req.body?.key;
    const schedulerSecret = req.headers['x-scheduler-secret'];
    const expectedAdminKey = process.env.ADMIN_KEY;

    const isScheduler = schedulerSecret && schedulerSecret === SCHEDULER_SECRET;
    const isAdmin = expectedAdminKey && apiKey === expectedAdminKey;

    if (!isScheduler && !isAdmin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      console.log('[Aggregate] Iniciando agregação de métricas...');

      // 1. Agrega métricas do BigQuery (eventos de analytics)
      const bqResults = await aggregateMetricsFromBigQuery();

      // 2. Agrega métricas do Firestore (sessionNavigations)
      const navMetrics = await aggregateSessionNavigationsMetrics();

      // 3. Mescla os dados: BigQuery como base, complementa com Firestore
      //    Para usuários que existem em ambas fontes, os dados do Firestore
      //    complementam (não substituem) os do BigQuery.
      const mergedMetrics = new Map();

      // Adiciona resultados do BigQuery como base
      for (const metric of bqResults) {
        mergedMetrics.set(metric.userId, { ...metric });
      }

      // Complementa/mescla com dados do Firestore
      for (const [userId, navData] of Object.entries(navMetrics)) {
        const existing = mergedMetrics.get(userId);

        if (existing) {
          // Usuário já tem dados no BigQuery — complementa apenas.
          // O mode NUNCA é sobrescrito pelo Firestore. O BigQuery é a fonte
          // primária para o modo (APPROX_TOP_COUNT dos eventos analytics).
          // Os dados do Firestore são SEMPRE de sessões INSTANT e apenas
          // enriquecem as métricas, sem alterar o modo do usuário.

          // Usa o maior sessionsCount entre as duas fontes (evita undercount)
          existing.sessionsCount = Math.max(existing.sessionsCount, navData.sessionsCount);

          // Adiciona campos específicos do Firestore (dados SEMPRE INSTANT)
          existing.navigationsFromSessions = navData.totalNavigations;
          existing.uniqueScreensFromSessions = navData.uniqueScreensCount;
          existing.avgSessionDurationMs = navData.avgSessionDurationMs;
          existing.topScreensFromSessions = navData.topScreens;
        } else {
          // Usuário só existe no Firestore (INSTANT puro, sem eventos no BigQuery)
          mergedMetrics.set(userId, {
            userId,
            mode: 'INSTANT', // mode = INSTANT apenas quando a única fonte é o Firestore
            sessionsCount: navData.sessionsCount,
            shortcutsShown: 0,
            shortcutsClicked: 0,
            acceptanceRate: null,
            dashboardShown: 0,
            dashboardChanged: 0,
            passThroughRate: null,
            avgTimeToTask: null,
            // Campos do Firestore (SEMPRE dados de sessões INSTANT)
            navigationsFromSessions: navData.totalNavigations,
            uniqueScreensFromSessions: navData.uniqueScreensCount,
            avgSessionDurationMs: navData.avgSessionDurationMs,
            topScreensFromSessions: navData.topScreens,
          });
        }
      }

      // 4. Salva tudo no Firestore
      let usersUpdated = 0;
      const batch = db.batch();

      for (const [, userMetric] of mergedMetrics) {
        const ref = db.collection('userMetrics').doc(userMetric.userId);
        const dataToSave = {
          userId: userMetric.userId,
          mode: userMetric.mode,
          sessionsCount: userMetric.sessionsCount,
          shortcutsShown: userMetric.shortcutsShown,
          shortcutsClicked: userMetric.shortcutsClicked,
          acceptanceRate: userMetric.acceptanceRate,
          dashboardShown: userMetric.dashboardShown,
          dashboardChanged: userMetric.dashboardChanged,
          passThroughRate: userMetric.passThroughRate,
          avgTimeToTask: userMetric.avgTimeToTask,
          // Campos do Firestore (sessionNavigations)
          navigationsFromSessions: userMetric.navigationsFromSessions || 0,
          uniqueScreensFromSessions: userMetric.uniqueScreensFromSessions || 0,
          avgSessionDurationMs: userMetric.avgSessionDurationMs || null,
          topScreensFromSessions: userMetric.topScreensFromSessions || [],
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };
        batch.set(ref, dataToSave, { merge: true });
        usersUpdated++;
      }

      await batch.commit();
      console.log(`[Aggregate] ${usersUpdated} usuários atualizados no Firestore`);

      // Após atualizar por usuário, agrega globalmente
      await aggregateGlobalMetrics();

      return res.json({
        success: true,
        usersUpdated,
        message: `Métricas agregadas para ${usersUpdated} usuários`,
      });
    } catch (err) {
      console.error('[Aggregate] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

/**
 * Agrega métricas de sessões do Firestore (collection sessionNavigations).
 * Complementa os dados do BigQuery, especialmente para usuários INSTANT
 * cujas sessões podem não ter eventos completos no analytics.
 *
 * Retorna map: userId → { sessionsCount, totalNavigations, avgSessionDuration, ... }
 */
async function aggregateSessionNavigationsMetrics() {
  console.log('[Aggregate-Navigations] Buscando sessões completadas do Firestore...');

  // Busca sessões completadas (encerradas) dos últimos 30 dias
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sessionsSnap = await db
    .collection('sessionNavigations')
    .where('status', '==', 'completed')
    .get();

  if (sessionsSnap.empty) {
    console.log('[Aggregate-Navigations] Nenhuma sessão completada encontrada');
    return {};
  }

  console.log(`[Aggregate-Navigations] ${sessionsSnap.size} sessões completadas encontradas`);

  // Agrega por usuário
  const userMetrics = {};

  for (const sessionDoc of sessionsSnap.docs) {
    const sessionData = sessionDoc.data();
    const userId = sessionData.userId;
    const sessionId = sessionData.sessionId || sessionDoc.id;

    if (!userId || userId === 'anonymous') continue;

    // Inicializa métricas do usuário se necessário
    if (!userMetrics[userId]) {
      userMetrics[userId] = {
        userId,
        mode: 'INSTANT',
        sessionsCount: 0,
        totalNavigations: 0,
        uniqueScreens: new Set(),
        screenFrequency: {},
        totalDurationMs: 0,
        sessionsWithDuration: 0,
      };
    }

    userMetrics[userId].sessionsCount++;

    // Busca navegações da subcoleção
    const navsSnap = await db
      .collection('sessionNavigations')
      .doc(sessionId)
      .collection('navigations')
      .orderBy('timestamp', 'asc')
      .get();

    const navs = navsSnap.docs.map((d) => d.data());

    if (navs.length > 0) {
      userMetrics[userId].totalNavigations += navs.length;

      // Conta telas visitadas
      navs.forEach((nav) => {
        const screen = nav.screen || nav.route || nav.targetScreen;
        if (screen) {
          userMetrics[userId].uniqueScreens.add(screen);
          userMetrics[userId].screenFrequency[screen] =
            (userMetrics[userId].screenFrequency[screen] || 0) + 1;
        }
      });

      // Calcula duração da sessão (diferença entre último e primeiro timestamp)
      const firstTs = navs[0].timestamp?.toDate?.();
      const lastTs = navs[navs.length - 1].timestamp?.toDate?.();

      if (firstTs && lastTs && lastTs > firstTs) {
        const durationMs = lastTs.getTime() - firstTs.getTime();
        userMetrics[userId].totalDurationMs += durationMs;
        userMetrics[userId].sessionsWithDuration++;
      }
    }
  }

  // Converte para formato serializável
  const result = {};
  for (const [userId, metrics] of Object.entries(userMetrics)) {
    const topScreens = Object.entries(metrics.screenFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([screen, count]) => ({ screen, count }));

    result[userId] = {
      userId,
      mode: metrics.mode,
      sessionsCount: metrics.sessionsCount,
      totalNavigations: metrics.totalNavigations,
      uniqueScreensCount: metrics.uniqueScreens.size,
      avgNavigationsPerSession: metrics.sessionsCount > 0
        ? Math.round((metrics.totalNavigations / metrics.sessionsCount) * 10) / 10
        : 0,
      avgSessionDurationMs: metrics.sessionsWithDuration > 0
        ? Math.round(metrics.totalDurationMs / metrics.sessionsWithDuration)
        : null,
      topScreens,
    };
  }

  console.log(`[Aggregate-Navigations] Métricas agregadas para ${Object.keys(result).length} usuários`);
  return result;
}

/**
 * Query BigQuery para agregar métricas por usuário.
 * Retorna array de objetos com métricas calculadas.
 */
async function aggregateMetricsFromBigQuery() {
  // Usa a tabela de analytics configurada
  const eventsTable = `\`${PROJECT_ID}.${ANALYTICS_DATASET}.events_*\``;

  const query = `
    WITH metric_events AS (
      SELECT
        user_id,
        event_name,
        event_timestamp,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'mode') AS mode,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_id') AS session_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'shortcut_routes') AS shortcut_routes,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'shortcuts_count') AS shortcuts_count,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'route') AS route,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'dashboard_id') AS dashboard_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'from_dashboard') AS from_dashboard,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'to_dashboard') AS to_dashboard,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'time_to_task_ms') AS time_to_task_ms
      FROM ${eventsTable}
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
                              AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
        AND event_name IN (${getSupportedMetricEventsSqlList()})
    )
    SELECT
      user_id,
      -- Modo mais frequente
      APPROX_TOP_COUNT(mode, 1)[OFFSET(0)].value AS mode,
      -- Sessões
      COUNTIF(event_name IN ('session_start', 'adaptive_session_start')) AS sessions_count,
      -- Shortcuts
      COALESCE(SUM(CASE WHEN event_name = 'shortcuts_shown' THEN shortcuts_count ELSE 0 END), 0) AS shortcuts_shown,
      COUNTIF(event_name = 'shortcut_clicked') AS shortcuts_clicked,
      -- Dashboard
      COUNTIF(event_name = 'dashboard_shown') AS dashboard_shown,
      COUNTIF(event_name = 'dashboard_changed') AS dashboard_changed,
      -- Time to task (média em ms, excluindo valores inválidos)
      AVG(CASE WHEN event_name = 'first_productive_navigation' AND time_to_task_ms > 0 THEN time_to_task_ms END) AS avg_time_to_task
    FROM metric_events
    WHERE user_id IS NOT NULL AND user_id != 'anonymous'
    GROUP BY user_id
  `;

  console.log('[Aggregate] Executando query BigQuery...');
  const [rows] = await bigquery.query({ query, location: "US" });

  return rows.map((row) => {
    const shortcutsShown = Number(row.shortcuts_shown) || 0;
    const shortcutsClicked = Number(row.shortcuts_clicked) || 0;
    const dashboardShown = Number(row.dashboard_shown) || 0;
    const dashboardChanged = Number(row.dashboard_changed) || 0;
    const sessionsCount = Number(row.sessions_count) || 0;
    const avgTimeToTask = row.avg_time_to_task
      ? Number(row.avg_time_to_task)
      : null;

    // Aceitance rate: cliques / exibidos (null se zero exibidos)
    const acceptanceRate = shortcutsShown > 0
      ? shortcutsClicked / shortcutsShown
      : null;

    // Pass-through rate: mudanças / exibidos (null se zero exibidos)
    const passThroughRate = dashboardShown > 0
      ? dashboardChanged / dashboardShown
      : null;

    return {
      userId: row.user_id,
      mode: row.mode || 'GRADUAL',
      sessionsCount,
      shortcutsShown,
      shortcutsClicked,
      acceptanceRate: acceptanceRate !== null ? Math.round(acceptanceRate * 1000) / 1000 : null,
      dashboardShown,
      dashboardChanged,
      passThroughRate: passThroughRate !== null ? Math.round(passThroughRate * 1000) / 1000 : null,
      avgTimeToTask: avgTimeToTask !== null ? Math.round(avgTimeToTask) : null,
    };
  });
}

/**
 * Agrega métricas globais de todos os usuários e salva em aggregateMetrics/global.
 * Inclui breakdown por modo para comparação.
 */
async function aggregateGlobalMetrics() {
  const userMetricsSnap = await db.collection('userMetrics').get();

  if (userMetricsSnap.empty) {
    console.log('[Aggregate Global] Sem dados de usuário para agregar');
    return;
  }

  const allMetrics = [];
  const byMode = { STATIC: [], GRADUAL: [], INSTANT: [] };

  userMetricsSnap.forEach((doc) => {
    const data = doc.data();
    allMetrics.push(data);

    const mode = data.mode || 'GRADUAL';
    if (byMode[mode]) {
      byMode[mode].push(data);
    }
  });

  // Helpers para calcular médias
  const avg = (arr, key) => {
    const vals = arr.map((x) => x[key]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
  };

  const sum = (arr, key) => arr.reduce((a, b) => a + ((b[key] || 0)), 0);

  const global = {
    totalUsers: allMetrics.length,
    totalSessions: sum(allMetrics, 'sessionsCount'),
    globalAcceptanceRate: avg(allMetrics, 'acceptanceRate'),
    globalPassThroughRate: avg(allMetrics, 'passThroughRate'),
    globalAvgTimeToTask: avg(allMetrics, 'avgTimeToTask'),
    byMode: {},
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Breakdown por modo
  for (const [mode, users] of Object.entries(byMode)) {
    if (users.length === 0) continue;
    global.byMode[mode] = {
      usersCount: users.length,
      totalSessions: sum(users, 'sessionsCount'),
      acceptanceRate: avg(users, 'acceptanceRate'),
      passThroughRate: avg(users, 'passThroughRate'),
      avgTimeToTask: avg(users, 'avgTimeToTask'),
    };
  }

  await db.collection('aggregateMetrics').doc('global').set(global, { merge: true });
  console.log('[Aggregate Global] Métricas globais salvas:', JSON.stringify(global, null, 2));
}

// ============================================
// METRICS API — Endpoints de consulta de métricas
// ============================================

/**
 * Endpoints HTTP para consultar métricas de eficácia.
 *
 * GET /metrics                  — métricas globais agregadas
 * GET /metrics?userId=xxx       — métricas de um usuário
 * GET /metrics/users            — lista resumida de todos os usuários
 * GET /metrics/compare?modeA=X&modeB=Y — comparação entre modos
 * GET /metrics/export?format=csv|json  — export de dados brutos
 *
 * Auth: Authorization: Bearer <ADMIN_KEY> ou ?key=<ADMIN_KEY>
 */
exports.metricsApi = onRequest(
  { cors: true },
  async (req, res) => {
    // Auth
    const apiKey =
      req.headers.authorization?.split('Bearer ')[1] ||
      req.query?.key;
    const expectedKey = process.env.ADMIN_KEY;

    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const path = req.path || '';
      const query = req.query || {};

      // Roteamento interno
      if (path === '/users' || query.path === 'users') {
        return handleListUsers(res);
      }

      if (path === '/compare' || query.path === 'compare') {
        return handleCompareModes(res, query);
      }

      if (path === '/export' || query.path === 'export') {
        return handleExportData(res, query);
      }

      // Default: métricas globais ou por usuário
      if (query.userId) {
        return handleUserMetrics(res, query.userId);
      }

      return handleGlobalMetrics(res);
    } catch (err) {
      console.error('[Metrics API] Erro:', err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

/** Re-agrega métricas do BigQuery se necessário. Retorna true se agregou. */
async function _ensureFreshMetrics() {
  const globalDoc = await db.collection('aggregateMetrics').doc('global').get();
  const needsRefresh = !globalDoc.exists || _isDataStale(globalDoc.data());

  if (!needsRefresh) return false;

  console.log('[Metrics API] Dados stale ou inexistentes, rodando agregação...');
  try {
    const bqResults = await aggregateMetricsFromBigQuery();
    const navMetrics = await aggregateSessionNavigationsMetrics();

    // Mescla os dados (mesma lógica do handler principal)
    const mergedMetrics = new Map();

    for (const metric of bqResults) {
      mergedMetrics.set(metric.userId, { ...metric });
    }

    for (const [userId, navData] of Object.entries(navMetrics)) {
      const existing = mergedMetrics.get(userId);
      if (existing) {
        // Mode NUNCA é sobrescrito pelo Firestore — BigQuery é a fonte primária
        existing.sessionsCount = Math.max(existing.sessionsCount, navData.sessionsCount);
        existing.navigationsFromSessions = navData.totalNavigations;
        existing.uniqueScreensFromSessions = navData.uniqueScreensCount;
        existing.avgSessionDurationMs = navData.avgSessionDurationMs;
        existing.topScreensFromSessions = navData.topScreens;
      } else {
        // Usuário só no Firestore → exclusivamente INSTANT
        mergedMetrics.set(userId, {
          userId,
          mode: 'INSTANT',
          sessionsCount: navData.sessionsCount,
          shortcutsShown: 0,
          shortcutsClicked: 0,
          acceptanceRate: null,
          dashboardShown: 0,
          dashboardChanged: 0,
          passThroughRate: null,
          avgTimeToTask: null,
          navigationsFromSessions: navData.totalNavigations,
          uniqueScreensFromSessions: navData.uniqueScreensCount,
          avgSessionDurationMs: navData.avgSessionDurationMs,
          topScreensFromSessions: navData.topScreens,
        });
      }
    }

    if (mergedMetrics.size > 0) {
      const batch = db.batch();
      for (const [, userMetric] of mergedMetrics) {
        const ref = db.collection('userMetrics').doc(userMetric.userId);
        batch.set(ref, {
          userId: userMetric.userId,
          mode: userMetric.mode,
          sessionsCount: userMetric.sessionsCount,
          shortcutsShown: userMetric.shortcutsShown,
          shortcutsClicked: userMetric.shortcutsClicked,
          acceptanceRate: userMetric.acceptanceRate,
          dashboardShown: userMetric.dashboardShown,
          dashboardChanged: userMetric.dashboardChanged,
          passThroughRate: userMetric.passThroughRate,
          avgTimeToTask: userMetric.avgTimeToTask,
          navigationsFromSessions: userMetric.navigationsFromSessions || 0,
          uniqueScreensFromSessions: userMetric.uniqueScreensFromSessions || 0,
          avgSessionDurationMs: userMetric.avgSessionDurationMs || null,
          topScreensFromSessions: userMetric.topScreensFromSessions || [],
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      await batch.commit();
      await aggregateGlobalMetrics();
    }
    return true;
  } catch (err) {
    console.error('[Metrics API] Erro na agregação automática:', err.message);
    return false;
  }
}

async function handleGlobalMetrics(res) {
  await _ensureFreshMetrics();

  const globalDoc = await db.collection('aggregateMetrics').doc('global').get();
  if (!globalDoc.exists) {
    return res.json({
      totalUsers: 0,
      totalSessions: 0,
      globalAcceptanceRate: null,
      globalPassThroughRate: null,
      globalAvgTimeToTask: null,
      byMode: {},
      message: 'Sem dados disponíveis. Eventos de métrica ainda não foram coletados.',
    });
  }

  return res.json(globalDoc.data());
}

async function handleUserMetrics(res, userId) {
  await _ensureFreshMetrics();

  const userDoc = await db.collection('userMetrics').doc(userId).get();
  if (!userDoc.exists) {
    return res.status(404).json({ error: `User ${userId} not found in metrics` });
  }

  return res.json(userDoc.data());
}

/** Dados são considerados stale se lastUpdated tem mais de 24h */
function _isDataStale(data) {
  if (!data || !data.lastUpdated) return true;
  try {
    const lastUpdated = data.lastUpdated.toDate ? data.lastUpdated.toDate() : new Date(data.lastUpdated);
    const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  } catch {
    return true;
  }
}

async function handleListUsers(res) {
  const usersSnap = await db.collection('userMetrics').orderBy('lastUpdated', 'desc').get();

  const users = usersSnap.docs.map((doc) => {
    const data = doc.data();
    return {
      userId: data.userId,
      mode: data.mode,
      sessionsCount: data.sessionsCount,
      acceptanceRate: data.acceptanceRate,
      passThroughRate: data.passThroughRate,
      avgTimeToTask: data.avgTimeToTask,
      lastUpdated: data.lastUpdated?.toDate?.()?.toISOString() || null,
    };
  });

  return res.json(users);
}

async function handleCompareModes(res, query) {
  const globalDoc = await db.collection('aggregateMetrics').doc('global').get();

  if (!globalDoc.exists || !globalDoc.data()?.byMode) {
    return res.json({ error: 'Sem dados para comparação' });
  }

  const byMode = globalDoc.data().byMode;
  const modeA = query.modeA;
  const modeB = query.modeB;

  if (modeA && modeB) {
    // Comparação específica entre dois modos
    return res.json({
      modeA: { mode: modeA, ...(byMode[modeA] || { message: 'Sem dados' }) },
      modeB: { mode: modeB, ...(byMode[modeB] || { message: 'Sem dados' }) },
    });
  }

  // Retorna todos os modos disponíveis
  return res.json(byMode);
}

async function handleExportData(res, query) {
  const format = (query.format || 'json').toLowerCase();
  const { userId, mode, dateFrom, dateTo, limit, offset } = query;

  let usersSnap = db.collection('userMetrics');

  // Filtros
  if (userId) {
    usersSnap = usersSnap.where('userId', '==', userId);
  }
  if (mode) {
    usersSnap = usersSnap.where('mode', '==', mode);
  }

  usersSnap = usersSnap.orderBy('lastUpdated', 'desc');

  // Paginação
  const limitNum = parseInt(limit) || 1000;
  const offsetNum = parseInt(offset) || 0;
  usersSnap = usersSnap.limit(limitNum);

  const snap = await usersSnap.get();
  const data = snap.docs.map((doc) => doc.data());

  if (format === 'csv') {
    const headers = [
      'userId', 'mode', 'sessionsCount', 'shortcutsShown', 'shortcutsClicked',
      'acceptanceRate', 'dashboardShown', 'dashboardChanged', 'passThroughRate',
      'avgTimeToTask',
    ];

    const csvRows = [
      headers.join(','),
      ...data.map((row) =>
        headers.map((h) => {
          const val = row[h];
          // Escape CSV: strings com vírgulas ou aspas
          if (val === null || val === undefined) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',')
      ),
    ].join('\n');

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', 'attachment; filename=adaptation_metrics_export.csv');
    return res.send(csvRows);
  }

  return res.json({
    total: data.length,
    filters: { userId, mode, dateFrom, dateTo },
    pagination: { limit: limitNum, offset: offsetNum },
    data,
  });
}

// ============================================
// EXPORTS
// ============================================

Object.assign(module.exports, {
  ADAPTIVE_MODES,
  getDefaultShortcuts,
  getUserConfig,
  getSessionNavigations,
  generateInstantRecommendation,
  enrichInstantLoteShortcutsWithHistory,
  findRealLoteResourceFromInstantNavigations,
  normalizeInstantNavigation,
  buildInstantHistoryText,
  resolveEffectiveSessionId,
  sanitizeShortcutRouteResource,
  normalizeRecommendation,
  filterExcludedPages,
  validateShortcutResource,
  validateShortcuts,
  aggregateSessionNavigationsMetrics,
  aggregateMetricsFromBigQuery,
  aggregateGlobalMetrics,
});
