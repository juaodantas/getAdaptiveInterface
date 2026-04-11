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

// ============================================
// ADAPTIVE MODES — configuração de modos de adaptação
// ============================================

const ADAPTIVE_MODES = {
  STATIC: 'STATIC',
  INSTANT: 'INSTANT',
  GRADUAL: 'GRADUAL',
};

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
    { route: '/lotePage', confidence: 0.5 },
    { route: '/solucaoPage', confidence: 0.5 },
    { route: '/agendaPage', confidence: 0.5 },
    { route: '/reservatoriosPage', confidence: 0.5 },
  ];
}

async function generateInstantRecommendation(navigations, hour, dayOfWeek) {
  if (!navigations || navigations.length === 0) {
    console.log('[CF] INSTANT: Nenhuma navegação na sessão');
    return {
      dashboard: null,
      dashboardId: null,
      cardType: null,
      confidence: 0.0,
      shortcuts: getDefaultShortcuts(),
    };
  }

  const navCount = navigations.length;
  const maxConfidence = navCount < 10 ? Math.min(0.5, navCount * 0.05) : 0.5;

  const screenCounts = {};
  navigations.forEach((nav) => {
    const screen = nav.screen;
    screenCounts[screen] = (screenCounts[screen] || 0) + 1;
  });

  const sortedScreens = Object.entries(screenCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const historyText = sortedScreens
    .map(([screen, count]) => `${screen} | visitas=${count}x`)
    .join('\n');

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  const dashboardInfo = Object.values(DASHBOARD_CONFIG)
    .map((config) => `- "${config.displayName}" (cardType: "${config.cardType}"): ${config.screens.join(', ')}`)
    .join('\n');

  const validDashboardNames = Object.values(DASHBOARD_CONFIG)
    .map((config) => `"${config.displayName}"`)
    .join(', ');

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

Com base nas navegações desta sessão, retorne APENAS JSON válido sem markdown:
{"dashboard":"nome do dashboard ou null","dashboardId":"ID_TECNICO","cardType":"tipo_do_card","confidence":0.0,"shortcuts":[{"route":"/tela","confidence":0.0}]}

Regras:
- dashboard deve ser um dos valores válidos: ${validDashboardNames}
- dashboardId deve ser um dos valores: ${Object.keys(DASHBOARD_CONFIG).join(', ')}
- cardType deve ser um dos valores: ${[...new Set(Object.values(DASHBOARD_CONFIG).map(c => c.cardType))].join(', ')}
- confidence entre 0.0 e ${maxConfidence.toFixed(2)} (não ultrapasse este valor!)
- máximo 4 shortcuts
- priorize telas mais visitadas na sessão`;

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
    return { dashboard: null, confidence: 0.0, shortcuts: [], mode: ADAPTIVE_MODES.GRADUAL };
  }

  const data = request.data;
  const rawUserId = data.userId || request.auth?.uid;
  const userId = rawUserId ? String(rawUserId).trim() : null;

  if (!userId) {
    console.error("[CF] userId não fornecido");
    return { dashboard: null, confidence: 0.0, shortcuts: [], mode: ADAPTIVE_MODES.GRADUAL };
  }

  const rawHour =
    data.hour !== undefined ? Number(data.hour) : new Date().getHours();
  const currentHour =
    Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
      ? rawHour
      : new Date().getHours();
  const dayOfWeek = new Date().getDay() + 1;

  let mode = data.mode || null;
  const sessionId = data.sessionId || null;

  if (!mode) {
    const userConfig = await getUserConfig(userId);
    mode = userConfig?.mode || ADAPTIVE_MODES.GRADUAL;
  }

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
      };

    case ADAPTIVE_MODES.INSTANT:
      if (!sessionId) {
        console.error(`[CF] INSTANT: sessionId obrigatório não fornecido`);
        return {
          dashboard: null,
          dashboardId: null,
          cardType: null,
          confidence: 0.0,
          shortcuts: getDefaultShortcuts(),
          mode: ADAPTIVE_MODES.INSTANT,
        };
      }

      try {
        console.log(`[CF] INSTANT: Buscando navegações da sessão "${sessionId}"`);
        const navigations = await getSessionNavigations(sessionId);

        if (navigations.length === 0) {
          console.log(`[CF] INSTANT: Sessão sem navegações`);
          return {
            dashboard: null,
            dashboardId: null,
            cardType: null,
            confidence: 0.0,
            shortcuts: getDefaultShortcuts(),
            mode: ADAPTIVE_MODES.INSTANT,
          };
        }

        const recommendation = await generateInstantRecommendation(navigations, currentHour, dayOfWeek);
        return {
          ...recommendation,
          mode: ADAPTIVE_MODES.INSTANT,
        };
      } catch (error) {
        console.error(`[CF] INSTANT: Erro ao processar sessão:`, error.message);
        return {
          dashboard: null,
          dashboardId: null,
          cardType: null,
          confidence: 0.0,
          shortcuts: getDefaultShortcuts(),
          mode: ADAPTIVE_MODES.INSTANT,
        };
      }

    case ADAPTIVE_MODES.GRADUAL:
    default:
      const cached = await getCache(userId);
      if (cached) {
        console.log(`[CF] Cache hit — userId="${userId}"`);
        const normalized = normalizeRecommendation(cached);
        console.log(`[CF] Cache retornado: dashboard="${normalized.dashboard}", cardType="${normalized.cardType}"`);
        return {
          ...normalized,
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
          ...recommendation,
          mode: ADAPTIVE_MODES.GRADUAL,
        };
      } catch (error) {
        console.error("[CF] Erro ao gerar recomendação:", error.message);
        return {
          dashboard: null,
          dashboardId: null,
          cardType: null,
          confidence: 0.0,
          shortcuts: [],
          mode: ADAPTIVE_MODES.GRADUAL,
        };
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
        if (mode === ADAPTIVE_MODES.INSTANT && sessionId) {
          const sessionRef = db.collection('sessionNavigations').doc(sessionId);
          batch.set(sessionRef, {
            sessionId,
            userId: String(userId),
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
          }, { merge: true });
        }

        await batch.commit();
        console.log(`[Admin] ${userId} → modo ${mode}${sessionId ? `, sessão ${sessionId}` : ''}`);
        return res.json({ success: true, userId, mode, sessionId });
      }

      // DELETE — encerrar sessão e remover config
      if (method === 'DELETE') {
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
// EXPORTS
// ============================================

Object.assign(module.exports, {
  ADAPTIVE_MODES,
  getDefaultShortcuts,
  getUserConfig,
  getSessionNavigations,
  generateInstantRecommendation,
  normalizeRecommendation,
});
