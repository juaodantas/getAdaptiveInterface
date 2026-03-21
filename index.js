const functions = require("firebase-functions");
const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();

// ============================================
// CONFIGURAÇÃO — via variáveis de ambiente
// ============================================

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID;
const ANALYTICS_DATASET = process.env.BIGQUERY_ANALYTICS_DATASET;

// Páginas de sistema excluídas das análises de navegação (ponto único de manutenção)
const EXCLUDED_PAGES_SQL = `
  '/modulosPage', '/splashPage', '/loginPage', '/homePage',
  '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
  '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
`;

// Mapeamento rota → categoria de dashboard (ponto único de manutenção)
const DASHBOARD_CASE_SQL = `
  CASE
    WHEN target_screen = '/lotePage' THEN 'Lotes em Produção'
    WHEN target_screen = '/agendaPage' THEN 'Tarefas Pendentes'
    WHEN target_screen = '/gerenciarEquipePage' THEN 'Tarefas Pendentes'
    WHEN target_screen IN ('/solucaoPage', '/reservatoriosPage') THEN 'Produção Total'
    WHEN target_screen IN ('/protocoloPage', '/cadernoCampoPage') THEN 'Top Culturas'
    WHEN target_screen = '/historicoPage' THEN 'Produção Total'
    WHEN target_screen = '/setorPage' THEN 'Lotes em Produção'
    ELSE 'Tarefas Pendentes'
  END
`;

// Resolve userId de múltiplas fontes (user_properties, coluna user_id, fallback)
const USER_ID_SQL = `
  COALESCE(
    (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
    CAST(user_id AS STRING),
    'anonymous'
  )
`;

// ============================================
// QUERY BUILDER — Dashboard (com ou sem filtro de hora)
// ============================================

/**
 * Constrói a query de dashboard.
 * @param {boolean} includeHour - true para query principal (filtra por hora), false para fallback
 */
function buildDashboardQuery(includeHour) {
  const hourSelect = includeHour
    ? `,
        COALESCE(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
          EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
        ) as hour`
    : "";

  const hourWhere = includeHour
    ? `
        AND COALESCE(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
          EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
        ) = @hour`
    : "";

  const hourGroupBy = includeHour ? ", hour" : "";

  return `
    WITH navigation_events AS (
      SELECT
        ${USER_ID_SQL} as user_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') as target_screen${hourSelect}
      FROM \`${PROJECT_ID}.${ANALYTICS_DATASET}.events_*\`
      WHERE event_name = 'navigation_click'
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
          ${EXCLUDED_PAGES_SQL}
        )
        AND ${USER_ID_SQL} = @userId${hourWhere}
        AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    ),
    dashboard_mapping AS (
      SELECT
        user_id${hourGroupBy},
        ${DASHBOARD_CASE_SQL} as inferred_dashboard,
        COUNT(*) as access_count
      FROM navigation_events
      WHERE target_screen IS NOT NULL AND target_screen != ''
      GROUP BY user_id${hourGroupBy}, inferred_dashboard
    ),
    dashboard_scores AS (
      SELECT
        inferred_dashboard as dashboard,
        SUM(access_count) as total_access
      FROM dashboard_mapping
      GROUP BY inferred_dashboard
    )
    SELECT
      dashboard,
      ROUND(total_access * 100.0 / SUM(total_access) OVER (), 2) / 100.0 as confidence
    FROM dashboard_scores
    ORDER BY total_access DESC
    LIMIT 1
  `;
}

// ============================================
// QUERY 2: ATALHOS — filtrado por usuário e hora
// ============================================

const queryShortcuts = `
  WITH navigation_events AS (
    SELECT
      ${USER_ID_SQL} as user_id,
      COALESCE(
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
        EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
      ) as hour,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') as target_screen,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_id') as resource_id,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_type') as resource_type,
      (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_name') as resource_name
    FROM \`${PROJECT_ID}.${ANALYTICS_DATASET}.events_*\`
    WHERE event_name = 'navigation_click'
      AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
      AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
        ${EXCLUDED_PAGES_SQL}
      )
      AND ${USER_ID_SQL} = @userId
      AND COALESCE(
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
        EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
      ) = @hour
      AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
  ),
  resource_screen_counts AS (
    SELECT
      target_screen,
      resource_id,
      resource_type,
      resource_name,
      COUNT(*) as total_access
    FROM navigation_events
    WHERE target_screen IS NOT NULL
      AND target_screen != ''
      AND resource_id IS NOT NULL
    GROUP BY target_screen, resource_id, resource_type, resource_name
  ),
  screen_counts AS (
    SELECT
      target_screen,
      CAST(NULL AS STRING) as resource_id,
      CAST(NULL AS STRING) as resource_type,
      CAST(NULL AS STRING) as resource_name,
      COUNT(*) as total_access
    FROM navigation_events
    WHERE target_screen IS NOT NULL
      AND target_screen != ''
      AND resource_id IS NULL
    GROUP BY target_screen
  ),
  combined_screens AS (
    SELECT * FROM resource_screen_counts
    UNION ALL
    SELECT * FROM screen_counts
  ),
  total_screens AS (
    SELECT SUM(total_access) as total FROM combined_screens
  ),
  screen_probabilities AS (
    SELECT
      target_screen,
      resource_id,
      resource_type,
      resource_name,
      ROUND(total_access * 100.0 / (SELECT total FROM total_screens), 2) / 100.0 as prob
    FROM combined_screens
  )
  SELECT
    target_screen,
    resource_id,
    resource_type,
    resource_name,
    prob
  FROM screen_probabilities
  WHERE prob > 0.1
  ORDER BY prob DESC
  LIMIT 4
`;

// ============================================
// FUNCTION PRINCIPAL
// ============================================

exports.getAdaptiveInterface = functions.https.onCall(
  async (dataOrRequest, context) => {
    if (!PROJECT_ID || !ANALYTICS_DATASET) {
      console.error("[CF] Variáveis de ambiente obrigatórias não configuradas: BIGQUERY_PROJECT_ID, BIGQUERY_ANALYTICS_DATASET");
      return { dashboard: null, confidence: 0.0, shortcuts: [] };
    }

    // Suportar v1 (1º arg = payload) e v2 (1º arg = request, payload em .data)
    const data =
      dataOrRequest && typeof dataOrRequest.data !== "undefined"
        ? dataOrRequest.data
        : dataOrRequest;

    const rawUserId = data.userId || context.auth?.uid || "anonymous";
    const userId = String(rawUserId).trim();

    // Validar userId
    if (!userId) {
      console.error("[CF] userId inválido ou vazio");
      return { dashboard: null, confidence: 0.0, shortcuts: [] };
    }

    // Sanitizar hora — fallback para hora atual do servidor se o valor recebido for inválido
    const rawHour =
      data.hour !== undefined ? Number(data.hour) : new Date().getHours();
    const currentHour =
      Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23
        ? rawHour
        : new Date().getHours();

    if (rawHour !== currentHour) {
      console.warn(
        `[CF] Hora inválida recebida (${data.hour}), usando hora atual: ${currentHour}`,
      );
    }

    console.log(
      `[CF] Buscando interface adaptativa — userId="${userId}" hour=${currentHour}`,
    );

    try {
      const [dashboardResult, shortcutResult] = await Promise.all([
        bigquery
          .query({
            query: buildDashboardQuery(true),
            location: "US",
            params: { userId, hour: currentHour },
          })
          .then(([rows]) => {
            if (!rows || rows.length === 0) {
              console.log(
                `[CF] Sem dados para hora ${currentHour}, usando fallback sem hora`,
              );
              return bigquery.query({
                query: buildDashboardQuery(false),
                location: "US",
                params: { userId },
              });
            }
            return [rows];
          })
          .catch((err) => {
            console.error("[CF] Erro ao buscar dashboard:", err.message);
            return bigquery
              .query({
                query: buildDashboardQuery(false),
                location: "US",
                params: { userId },
              })
              .catch(() => [[]]);
          }),

        bigquery
          .query({
            query: queryShortcuts,
            location: "US",
            params: { userId, hour: currentHour },
          })
          .catch((err) => {
            console.error("[CF] Erro ao buscar atalhos:", err.message);
            return [[]];
          }),
      ]);

      let dashboard = null;
      let dashboardConfidence = 0.0;

      if (dashboardResult[0] && dashboardResult[0].length > 0) {
        const dashData = dashboardResult[0][0];
        dashboard = dashData.dashboard;
        dashboardConfidence = dashData.confidence || 0.0;
        console.log(
          `[CF] Dashboard: "${dashboard}" (${(dashboardConfidence * 100).toFixed(1)}%)`,
        );
      } else {
        console.log("[CF] Nenhum dashboard encontrado");
      }

      const shortcuts = (shortcutResult[0] || [])
        .map((row) => {
          const shortcut = { route: row.target_screen, confidence: row.prob };
          if (row.resource_id) shortcut.resourceId = row.resource_id;
          if (row.resource_type) shortcut.resourceType = row.resource_type;
          if (row.resource_name) shortcut.resourceName = row.resource_name;
          return shortcut;
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);

      console.log(`[CF] ${shortcuts.length} atalho(s) recomendado(s)`);

      return { dashboard, confidence: dashboardConfidence, shortcuts };
    } catch (error) {
      console.error("[CF] Erro geral:", error.message);
      return { dashboard: null, confidence: 0.0, shortcuts: [] };
    }
  },
);
