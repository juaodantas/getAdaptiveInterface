const { onCall, onRequest } = require("firebase-functions/v2/https");
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bigquery = new BigQuery();

// ============================================
// CONFIGURAÇÃO — via variáveis de ambiente
// ============================================

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID;
const ANALYTICS_DATASET = process.env.BIGQUERY_ANALYTICS_DATASET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;

const EXCLUDED_PAGES_SQL = `
  '/modulosPage', '/splashPage', '/loginPage', '/homePage',
  '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
  '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
`;

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
const DASHBOARD_CONFIG = {
  LOTE_PRODUCAO: {
    id: "LOTE_PRODUCAO",
    displayName: "Lotes em Produção",
    cardType: "lotes",
    screens: ["/lotePage", "/setorPage"],
  },
  TAREFAS_PENDENTES: {
    id: "TAREFAS_PENDENTES",
    displayName: "Tarefas Pendentes",
    cardType: "tarefas",
    screens: ["/agendaPage", "/gerenciarEquipePage"],
  },
  PRODUCAO_TOTAL: {
    id: "PRODUCAO_TOTAL",
    displayName: "Produção Total",
    cardType: "producao",
    screens: ["/solucaoPage", "/reservatoriosPage", "/historicoPage"],
  },
  TOP_CULTURAS: {
    id: "TOP_CULTURAS",
    displayName: "Top Culturas",
    cardType: "culturas",
    screens: ["/protocoloPage", "/cadernoCampoPage"],
  },
  SAUDE_EQUIPES: {
    id: "SAUDE_EQUIPES",
    displayName: "Saúde das Equipes",
    cardType: "saude",
    screens: ["/gerenciarEquipePage", "/agendaPage"],
  },
};

// Mapa legacy para compatibilidade com consultas existentes
const DASHBOARD_MAP = Object.fromEntries(
  Object.values(DASHBOARD_CONFIG).map((config) => [
    config.displayName,
    config.screens,
  ]),
);

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

  const prompt = `Você é um sistema de recomendação de navegação para um app agrícola.

Histórico de navegação do usuário (últimos 30 dias):
${historyText}

Contexto atual: hora=${hour}h, dia_semana=${dayOfWeek} (1=Dom,2=Seg,3=Ter,4=Qua,5=Qui,6=Sex,7=Sáb)

Dashboards disponíveis e suas telas:
${dashboardInfo}

Com base no histórico e no contexto atual, retorne APENAS JSON válido sem markdown:
{"dashboard":"nome do dashboard ou null","dashboardId":"ID_TECNICO","cardType":"tipo_do_card","confidence":0.0,"shortcuts":[{"route":"/tela","confidence":0.0}]}

Regras:
- dashboard deve ser um dos valores válidos: ${validDashboardNames}
- dashboardId deve ser um dos valores: ${Object.keys(DASHBOARD_CONFIG).join(", ")}
- cardType deve ser um dos valores: ${[...new Set(Object.values(DASHBOARD_CONFIG).map(c => c.cardType))].join(", ")}
- confidence entre 0.0 e 1.0
- máximo 4 shortcuts
- priorize padrões do mesmo horário e dia da semana`;

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
      shortcuts: raw.shortcuts || [],
    };
  }

  return {
    dashboard: dashboardName,
    dashboardId: dashboardId,
    cardType: cardType,
    confidence: Math.max(0, Math.min(1, parseFloat(raw.confidence) || 0)),
    shortcuts: (raw.shortcuts || []).slice(0, 4).map((s) => ({
      route: s.route || s.predicted_target_screen || "",
      confidence: Math.max(0, Math.min(1, parseFloat(s.confidence || s.prob) || 0.5)),
      resourceId: s.resourceId || null,
      resourceType: s.resourceType || null,
      resourceName: s.resourceName || null,
    })),
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
    return { dashboard: null, confidence: 0.0, shortcuts: [] };
  }

  const data = request.data;
  const rawUserId = data.userId || request.auth?.uid;
  const userId = rawUserId ? String(rawUserId).trim() : null;

  if (!userId) {
    console.error("[CF] userId não fornecido");
    return { dashboard: null, confidence: 0.0, shortcuts: [] };
  }

  // 1. Tenta retornar do cache do Firestore
  const cached = await getCache(userId);
  if (cached) {
    console.log(`[CF] Cache hit — userId="${userId}"`);
    // Normaliza cache antigo para garantir novos campos
    const normalized = normalizeRecommendation(cached);
    console.log(`[CF] Cache retornado: dashboard="${normalized.dashboard}", cardType="${normalized.cardType}"`);
    return normalized;
  }

  // 2. Cache miss: gera recomendação on-demand via Gemini
  const rawHour =
    data.hour !== undefined ? Number(data.hour) : new Date().getHours();
  const currentHour =
    Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
      ? rawHour
      : new Date().getHours();
  const dayOfWeek = new Date().getDay() + 1;

  console.log(
    `[CF] Cache miss — gerando para userId="${userId}" hour=${currentHour}`,
  );

  try {
    const history = await fetchNavigationHistory(userId);
    const recommendation = await generateRecommendation(currentHour, dayOfWeek, history);
    await setCache(userId, recommendation);
    console.log(`[CF] Recomendação gerada e cacheada — userId="${userId}"`);
    console.log(`[CF] Resposta: dashboard="${recommendation.dashboard}", cardType="${recommendation.cardType}", confidence=${(recommendation.confidence * 100).toFixed(1)}%`);
    return recommendation;
  } catch (error) {
    console.error("[CF] Erro ao gerar recomendação:", error.message);
    return {
      dashboard: null,
      dashboardId: null,
      cardType: null,
      confidence: 0.0,
      shortcuts: [],
    };
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
