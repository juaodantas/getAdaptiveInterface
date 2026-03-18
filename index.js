const functions = require("firebase-functions");
const { BigQuery } = require("@google-cloud/bigquery");
const bigquery = new BigQuery();

exports.getAdaptiveInterface = functions.https.onCall(
  async (dataOrRequest, context) => {
    // Suportar v1 (1º arg = payload) e v2 (1º arg = request, payload em .data)
    const data =
      dataOrRequest && typeof dataOrRequest.data !== "undefined"
        ? dataOrRequest.data
        : dataOrRequest;

    const rawUserId = data.userId || context.auth?.uid || "anonymous";
    const userId = String(rawUserId); // ⚠️ Forçar conversão para string

    // ⚠️ CORREÇÃO: Usar hora do data primeiro, depois fallback
    const currentHour =
      data.hour !== undefined ? Number(data.hour) : new Date().getHours();

    const projectId = "adaptative-user-interface";
    const analyticsDataset = "analytics_505629182";
    const appDataset = "app_analytics";

    // ⚠️ LOGS DETALHADOS para debug (SEM JSON.stringify para evitar erro circular)
    console.log(`🔵 [CF] Buscando interface adaptativa`);
    console.log(
      `   └─ data.userId: ${data.userId} (tipo: ${typeof data.userId})`,
    );
    console.log(`   └─ data.hour: ${data.hour} (tipo: ${typeof data.hour})`);
    console.log(`   └─ context.auth?.uid: ${context.auth?.uid}`);
    console.log(`   └─ userId final: ${userId} (tipo: ${typeof userId})`);
    console.log(
      `   └─ hour final: ${currentHour} (tipo: ${typeof currentHour})`,
    );

    // ============================================
    // QUERY 1: DASHBOARD - COM FILTRO DE PÁGINAS
    // ============================================
    const queryDashboard = `
    WITH navigation_events AS (
      SELECT 
        COALESCE(
          (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
          CAST(user_id AS STRING),
          'anonymous'
        ) as user_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') as target_screen,
        COALESCE(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
          EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
        ) as hour
      FROM \`${projectId}.${analyticsDataset}.events_*\`
      WHERE event_name = 'navigation_click'
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
          '/modulosPage', '/splashPage', '/loginPage', '/homePage',
          '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
          '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
        )
        AND COALESCE(
          (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
          CAST(user_id AS STRING),
          'anonymous'
        ) = @userId
        AND COALESCE(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
          EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
        ) = @hour
        AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    ),
    dashboard_mapping AS (
      SELECT 
        user_id,
        hour,
        CASE 
          WHEN target_screen = '/lotePage' THEN 'Lotes em Produção'
          WHEN target_screen = '/agendaPage' THEN 'Tarefas Pendentes'
          WHEN target_screen = '/gerenciarEquipePage' THEN 'Tarefas Pendentes'
          WHEN target_screen IN ('/solucaoPage', '/reservatoriosPage') THEN 'Produção Total'
          WHEN target_screen IN ('/protocoloPage', '/cadernoCampoPage') THEN 'Top Culturas'
          WHEN target_screen = '/historicoPage' THEN 'Produção Total'
          WHEN target_screen = '/setorPage' THEN 'Lotes em Produção'
          ELSE 'Tarefas Pendentes'
        END as inferred_dashboard,
        COUNT(*) as access_count
      FROM navigation_events
      WHERE target_screen IS NOT NULL AND target_screen != ''
      GROUP BY user_id, hour, inferred_dashboard
    ),
    dashboard_scores AS (
      SELECT 
        inferred_dashboard as dashboard,
        SUM(access_count) as total_access
      FROM dashboard_mapping
      GROUP BY inferred_dashboard
    ),
    ranked_dashboards AS (
      SELECT 
        dashboard,
        ROUND(total_access * 100.0 / SUM(total_access) OVER (), 2) / 100.0 as confidence
      FROM dashboard_scores
      ORDER BY total_access DESC
      LIMIT 1
    )
    SELECT * FROM ranked_dashboards
  `;

    // ============================================
    // QUERY 2: ATALHOS - COM RECURSOS ESPECÍFICOS
    // ============================================
    const queryShortcuts = `
    WITH navigation_events AS (
      SELECT 
        COALESCE(
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'hour'),
          EXTRACT(HOUR FROM TIMESTAMP_MICROS(event_timestamp))
        ) as hour,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') as target_screen,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_id') as resource_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_type') as resource_type,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'resource_name') as resource_name
      FROM \`${projectId}.${analyticsDataset}.events_*\`
      WHERE event_name = 'navigation_click'
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
          '/modulosPage', '/splashPage', '/loginPage', '/homePage',
          '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
          '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
        )
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
      SELECT SUM(total_access) as total
      FROM combined_screens
    ),
    screen_probabilities AS (
      SELECT 
        target_screen,
        resource_id,
        resource_type,
        resource_name,
        total_access,
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
    // QUERY 3: FALLBACK - COM FILTRO DE PÁGINAS
    // ============================================
    const queryDashboardFallback = `
    WITH navigation_events AS (
      SELECT 
        COALESCE(
          (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
          CAST(user_id AS STRING),
          'anonymous'
        ) as user_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') as target_screen
      FROM \`${projectId}.${analyticsDataset}.events_*\`
      WHERE event_name = 'navigation_click'
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') IS NOT NULL
        AND (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'screen_name') NOT IN (
          '/modulosPage', '/splashPage', '/loginPage', '/homePage',
          '/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
          '/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
        )
        AND COALESCE(
          (SELECT value.string_value FROM UNNEST(user_properties) WHERE key = 'user_id'),
          CAST(user_id AS STRING),
          'anonymous'
        ) = @userId
        AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
    ),
    dashboard_mapping AS (
      SELECT 
        user_id,
        CASE 
          WHEN target_screen = '/lotePage' THEN 'Lotes em Produção'
          WHEN target_screen = '/agendaPage' THEN 'Tarefas Pendentes'
          WHEN target_screen = '/gerenciarEquipePage' THEN 'Tarefas Pendentes'
          WHEN target_screen IN ('/solucaoPage', '/reservatoriosPage') THEN 'Produção Total'
          WHEN target_screen IN ('/protocoloPage', '/cadernoCampoPage') THEN 'Top Culturas'
          WHEN target_screen = '/historicoPage' THEN 'Produção Total'
          WHEN target_screen = '/setorPage' THEN 'Lotes em Produção'
          ELSE 'Tarefas Pendentes'
        END as inferred_dashboard,
        COUNT(*) as access_count
      FROM navigation_events
      WHERE target_screen IS NOT NULL AND target_screen != ''
      GROUP BY user_id, inferred_dashboard
    )
    SELECT 
      inferred_dashboard as dashboard,
      ROUND(SUM(access_count) * 100.0 / SUM(SUM(access_count)) OVER (), 2) / 100.0 as confidence
    FROM dashboard_mapping
    GROUP BY inferred_dashboard
    ORDER BY SUM(access_count) DESC
    LIMIT 1
  `;

    try {
      console.log(
        `🔍 [CF] Executando queries com userId="${userId}" e hour=${currentHour}`,
      );

      const [dashboardResult, shortcutResult] = await Promise.all([
        bigquery
          .query({
            query: queryDashboard,
            location: "US",
            params: {
              userId: userId,
              hour: currentHour,
            },
          })
          .then(([rows]) => {
            console.log(
              `📊 [CF] Dashboard query retornou ${rows.length} linhas`,
            );
            if (!rows || rows.length === 0) {
              console.log(
                `⚠️ [CF] Sem dados para hora ${currentHour}, usando fallback`,
              );
              return bigquery.query({
                query: queryDashboardFallback,
                location: "US",
                params: { userId: userId },
              });
            }
            return [rows];
          })
          .catch((err) => {
            console.log("⚠️ [CF] Erro ao buscar dashboard:", err.message);
            return bigquery
              .query({
                query: queryDashboardFallback,
                location: "US",
                params: { userId: userId },
              })
              .catch(() => [[]]);
          }),

        bigquery
          .query({
            query: queryShortcuts,
            location: "US",
            params: { hour: currentHour },
          })
          .catch((err) => {
            console.error("❌ [CF] Erro ao buscar atalhos:", err.message);
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
          `✅ [CF] Dashboard: ${dashboard} (${(dashboardConfidence * 100).toFixed(1)}%)`,
        );
      } else {
        console.log("⚠️ [CF] Nenhum dashboard encontrado");
      }

      const shortcuts = (shortcutResult[0] || [])
        .filter((row) => row.prob > 0.1)
        .map((row) => {
          const shortcut = {
            route: row.target_screen,
            confidence: row.prob,
          };

          if (row.resource_id) {
            shortcut.resourceId = row.resource_id;
          }
          if (row.resource_type) {
            shortcut.resourceType = row.resource_type;
          }
          if (row.resource_name) {
            shortcut.resourceName = row.resource_name;
          }

          if (row.resource_id && row.resource_name) {
            console.log(
              `   └─ Atalho: ${row.target_screen} (${(row.prob * 100).toFixed(1)}%) - Recurso: ${row.resource_type} #${row.resource_id} "${row.resource_name}"`,
            );
          } else {
            console.log(
              `   └─ Atalho: ${row.target_screen} (${(row.prob * 100).toFixed(1)}%)`,
            );
          }

          return shortcut;
        })
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);

      console.log(`✅ [CF] ${shortcuts.length} atalhos recomendados`);

      const response = {
        dashboard: dashboard,
        confidence: dashboardConfidence,
        shortcuts: shortcuts,
      };

      // ⚠️ CORREÇÃO: Remover JSON.stringify da resposta final também (se houver)
      console.log(`✅ [CF] Resposta enviada`);

      return response;
    } catch (error) {
      console.error("❌ [CF] Erro geral:", error);
      console.error("   └─ Mensagem:", error.message);
      return {
        dashboard: null,
        confidence: 0.0,
        shortcuts: [],
      };
    }
  },
);
