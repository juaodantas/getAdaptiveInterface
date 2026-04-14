# Metrics System — Especificação Completa

> Sistema de agregação e consulta de métricas de eficácia dos modos adaptativos (STATIC, GRADUAL, INSTANT).

## 1. Visão Geral

### 1.1 Propósito
Medir a eficácia dos três modos de adaptação de interface, permitindo comparação entre eles e identificação de padrões de uso. As métricas alimentam dashboards administrativos e decisões de produto sobre qual modo performar melhor.

### 1.2 Arquitetura de Dados

```
┌─────────────────────────────────────────────────┐
│                  Fontes de Dados                 │
├──────────────────────────┬──────────────────────┤
│  BigQuery (Analytics)    │  Firestore            │
│  events_* (30 dias)      │  sessionNavigations   │
│                          │  (sessões INSTANT)     │
│  Eventos:                │  └── navigations       │
│  - session_start         │      (screen, ts)      │
│  - shortcuts_shown       │                       │
│  - shortcut_clicked      │  status: completed    │
│  - dashboard_shown       │  userId, sessionId     │
│  - dashboard_changed     │                       │
│  - first_productive_nav  │                       │
└────────┬─────────────────┴────────┬───────────────┘
         │                          │
         ▼                          ▼
┌─────────────────────────────────────────────────┐
│          Pipeline de Agregação                   │
│                                                  │
│  aggregateMetricsFromBigQuery()                  │
│  +                                               │
│  aggregateSessionNavigationsMetrics()            │
│  = merge (BigQuery primário, Firestore comp.)    │
└────────┬─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│                  Firestore (Saída)               │
├──────────────────────────┬──────────────────────┤
│  userMetrics/{userId}    │  aggregateMetrics/    │
│  (métricas por usuário)  │  global               │
│                          │  (métricas globais +   │
│                          │   breakdown por modo)  │
└──────────────────────────┘
```

---

## 2. Modos Adaptativos — Contexto Métricas

| Modo | Fonte Primária | Dados Gerados | Comportamento |
|------|---------------|---------------|---------------|
| **STATIC** | Nenhum | Sem personalização | Atalhos fixos padrão, `confidence: 0.0` |
| **GRADUAL** | BigQuery (histórico 30 dias) | Cache diário em `adaptiveInterfaceCache` | IA Gemini analisa histórico + contexto (hora, dia da semana) |
| **INSTANT** | Firestore `sessionNavigations` (sessão atual) | Sessão com subcoleção `navigations` | IA Gemini analisa navegações da sessão em tempo real |

### 2.1 Resolução do Modo (precedência)
1. Parâmetro explícito na requisição (`data.mode`)
2. Configuração do usuário em `userAdaptiveConfig/{userId}` (com `expiresAt`)
3. Default: `GRADUAL`

---

## 3. Fontes de Dados — Detalhamento

### 3.1 BigQuery — Tabela de Eventos Analytics

**Tabela:** `` `{PROJECT_ID}.{ANALYTICS_DATASET}.events_*` ``

**Janela temporal:** Últimos 30 dias (`_TABLE_SUFFIX` entre `DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` e `CURRENT_DATE()`)

**Eventos coletados:**

| Event Name | Descrição | Campos Extraídos |
|---|---|---|
| `session_start` | Início de sessão | `mode`, `session_id` |
| `shortcuts_shown` | Shortcuts exibidos ao usuário | `shortcuts_count`, `shortcut_routes` |
| `shortcut_clicked` | Clique em um shortcut | `route` |
| `dashboard_shown` | Dashboard exibido | `dashboard_id` |
| `dashboard_changed` | Troca de dashboard | `from_dashboard`, `to_dashboard` |
| `first_productive_navigation` | Primeira navegação produtiva | `time_to_task_ms` |

**Filtros:**
- `user_id IS NOT NULL AND user_id != 'anonymous'`
- `user_id` resolvido via `COALESCE(user_properties.user_id, CAST(user_id AS STRING), 'anonymous')`

### 3.2 Firestore — `sessionNavigations`

**Coleção raiz:** `sessionNavigations/{sessionId}`

**Documento de sessão:**
```
{
  sessionId: string,
  userId: string,
  startedAt: Timestamp,
  status: 'active' | 'completed',
  endedAt: Timestamp  // só quando completed
}
```

**Subcoleção:** `sessionNavigations/{sessionId}/navigations/{navId}`
```
{
  screen: string,        // rota da tela (ex: '/lotePage')
  timestamp: Timestamp,  // momento do clique
  // campos opcionais:
  route: string,         // alias para screen
  targetScreen: string   // alias para screen
}
```

**Filtros:**
- `status == 'completed'` (sessões encerradas)
- `userId IS NOT NULL AND userId != 'anonymous'`

> **Nota:** A variável `thirtyDaysAgo` é calculada no código mas não usada na query Firestore (busca todas as sessões completadas sem filtro de data). Isso é intencional para capturar todas as sessões, mas o window de 30 dias é considerado implicitamente pela rotação natural das sessões.

---

## 4. Pipeline de Agregação

### 4.1 Função: `aggregateMetricsFromBigQuery()`

**Entrada:** Tabela de eventos BigQuery (últimos 30 dias)

**Query SQL:**
```sql
WITH metric_events AS (
  SELECT user_id, event_name, event_timestamp,
    mode, session_id, shortcut_routes, shortcuts_count,
    route, dashboard_id, from_dashboard, to_dashboard,
    time_to_task_ms
  FROM events_*
  WHERE evento IN (lista acima)
    AND user_id != 'anonymous'
)
SELECT
  user_id,
  APPROX_TOP_COUNT(mode, 1) AS mode,
  COUNTIF(event = 'session_start') AS sessions_count,
  SUM(shortcuts_count) AS shortcuts_shown,
  COUNTIF(event = 'shortcut_clicked') AS shortcuts_clicked,
  COUNTIF(event = 'dashboard_shown') AS dashboard_shown,
  COUNTIF(event = 'dashboard_changed') AS dashboard_changed,
  AVG(time_to_task_ms WHERE > 0) AS avg_time_to_task
GROUP BY user_id
```

**Métricas calculadas por usuário:**

| Campo | Tipo | Origem | Regra de Cálculo |
|---|---|---|---|
| `userId` | string | `user_id` | — |
| `mode` | string | `APPROX_TOP_COUNT(mode)` | Modo mais frequente; default `'GRADUAL'` |
| `sessionsCount` | number | `COUNTIF(session_start)` | — |
| `shortcutsShown` | number | `SUM(shortcuts_count)` | `COALESCE(0)` |
| `shortcutsClicked` | number | `COUNTIF(shortcut_clicked)` | — |
| `acceptanceRate` | number \| null | calculado | `shortcutsClicked / shortcutsShown` se `shown > 0`, senão `null` |
| `dashboardShown` | number | `COUNTIF(dashboard_shown)` | — |
| `dashboardChanged` | number | `COUNTIF(dashboard_changed)` | — |
| `passThroughRate` | number \| null | calculado | `dashboardChanged / dashboardShown` se `shown > 0`, senão `null` |
| `avgTimeToTask` | number \| null | `AVG(time_to_task_ms)` | Média excluindo valores `<= 0`; arredondado para inteiro |

**Precisão:** Rates arredondados para 3 casas decimais (`Math.round(rate * 1000) / 1000`)

### 4.2 Função: `aggregateSessionNavigationsMetrics()`

**Entrada:** Coleção `sessionNavigations` (sessões com `status: 'completed'`)

**Processamento:**
1. Busca todos os documentos de sessão completados
2. Para cada sessão, busca subcoleção `navigations` ordenada por `timestamp asc`
3. Agrega por `userId`:

| Métrica | Cálculo |
|---|---|
| `sessionsCount` | Contagem de sessões do usuário |
| `totalNavigations` | Soma de documentos `navigations` de todas as sessões |
| `uniqueScreens` | Set de telas distintas (`screen \|\| route \|\| targetScreen`) |
| `uniqueScreensCount` | Tamanho do set |
| `screenFrequency` | Map `screen → count` |
| `totalDurationMs` | Soma de `(lastTs - firstTs)` por sessão (só se ambos válidos e `lastTs > firstTs`) |
| `sessionsWithDuration` | Contagem de sessões com duração válida |

**Saída serializável por usuário:**

| Campo | Tipo | Valor |
|---|---|---|
| `userId` | string | — |
| `mode` | string | **SEMPRE** `'INSTANT'` |
| `sessionsCount` | number | — |
| `totalNavigations` | number | — |
| `uniqueScreensCount` | number | — |
| `avgNavigationsPerSession` | number | `totalNavigations / sessionsCount`, arredondado 1 casa; `0` se zero sessões |
| `avgSessionDurationMs` | number \| null | `totalDurationMs / sessionsWithDuration`, arredondado inteiro; `null` se nenhuma sessão com duração |
| `topScreens` | array | Top 5 telas por frequência descendente: `[{ screen, count }]` |

### 4.3 Merge das Duas Fontes

**Regras de merge (ordem de processamento):**

```
1. BigQuery → base do Map (chave = userId)
2. Para cada userId do Firestore:
   a. SE já existe no Map (tem BigQuery):
      - sessionsCount = max(bq.sessionsCount, fs.sessionsCount)
      - ADICIONAR campos Firestore: navigationsFromSessions, uniqueScreensFromSessions,
        avgSessionDurationMs, topScreensFromSessions
      - NUNCA sobrescrever mode (BigQuery é fonte primária)
   b. SENÃO (usuário só no Firestore):
      - Criar entrada completa com mode = 'INSTANT'
      - Campos BigQuery = 0 ou null
      - ADICIONAR campos Firestore
```

**Diagrama de decisão:**

```
userId no BigQuery?
  ├── SIM → mode = mode_BQ (APPROX_TOP_COUNT)
  │         sessionsCount = max(BQ, FS)
  │         + campos INSTANT do Firestore
  │
  └── NÃO → mode = 'INSTANT'
            sessionsCount = FS
            campos BQ = 0/null
            + campos INSTANT do Firestore
```

### 4.4 Escrita no Firestore — `userMetrics/{userId}`

**Campos salvos (sempre via `merge: true`):**

| Campo | Tipo | Origem |
|---|---|---|
| `userId` | string | — |
| `mode` | string | BigQuery (primário) ou Firestore (só se exclusiva) |
| `sessionsCount` | number | `max(BQ, FS)` |
| `shortcutsShown` | number | BigQuery |
| `shortcutsClicked` | number | BigQuery |
| `acceptanceRate` | number\|null | BigQuery |
| `dashboardShown` | number | BigQuery |
| `dashboardChanged` | number | BigQuery |
| `passThroughRate` | number\|null | BigQuery |
| `avgTimeToTask` | number\|null | BigQuery |
| `navigationsFromSessions` | number | Firestore (0 se não existir) |
| `uniqueScreensFromSessions` | number | Firestore (0 se não existir) |
| `avgSessionDurationMs` | number\|null | Firestore (null se não existir) |
| `topScreensFromSessions` | array | Firestore (`[]` se não existir) |
| `lastUpdated` | Timestamp | `serverTimestamp()` |

---

## 5. Métricas Globais — `aggregateGlobalMetrics()`

**Gatilho:** Chamada ao final de `aggregateUserMetrics` (após salvar `userMetrics`)

**Processamento:**

1. Lê todos os documentos de `userMetrics`
2. Classifica por `mode` (default `'GRADUAL'` se ausente)
3. Calcula agregados globais e por modo

### 5.1 Schema — `aggregateMetrics/global`

```json
{
  "totalUsers": number,
  "totalSessions": number,
  "globalAcceptanceRate": number|null,
  "globalPassThroughRate": number|null,
  "globalAvgTimeToTask": number|null,
  "byMode": {
    "STATIC": {
      "usersCount": number,
      "totalSessions": number,
      "acceptanceRate": number|null,
      "passThroughRate": number|null,
      "avgTimeToTask": number|null
    },
    "GRADUAL": { ... },
    "INSTANT": { ... }
  },
  "lastUpdated": Timestamp
}
```

### 5.2 Regras de Cálculo

**Helper `avg(array, key)`:**
- Filtra valores `null` e `undefined`
- Se array vazio → retorna `null`
- Senão → `Math.round((soma / count) * 1000) / 1000`

**Helper `sum(array, key)`:**
- `reduce` somando `item[key] || 0`

**Métricas globais:**
| Campo | Cálculo |
|---|---|
| `totalUsers` | `count(userMetrics)` |
| `totalSessions` | `sum(allMetrics, 'sessionsCount')` |
| `globalAcceptanceRate` | `avg(allMetrics, 'acceptanceRate')` |
| `globalPassThroughRate` | `avg(allMetrics, 'passThroughRate')` |
| `globalAvgTimeToTask` | `avg(allMetrics, 'avgTimeToTask')` |

**Breakdown por modo:** Mesmos cálculos filtrando por `mode`

---

## 6. Endpoints de Consulta — Metrics API

### 6.1 Autenticação

**Header:** `Authorization: Bearer <ADMIN_KEY>` ou **Query:** `?key=<ADMIN_KEY>`

**Validação:** `apiKey === process.env.ADMIN_KEY`

### 6.2 Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/metrics` | Métricas globais agregadas |
| GET | `/metrics?userId=xxx` | Métricas de um usuário |
| GET | `/metrics/users` | Lista resumida de todos os usuários |
| GET | `/metrics/compare?modeA=X&modeB=Y` | Comparação entre modos |
| GET | `/metrics/export?format=csv\|json` | Export de dados brutos |

### 6.3 Auto-Refresh (`_ensureFreshMetrics`)

**Gatilho:** Toda consulta à Metrics API

**Lógica:**
```
globalDoc = aggregateMetrics/global
SE globalDoc não existe OU lastUpdated > 24h:
  → Rodar aggregateMetricsFromBigQuery()
  → Rodar aggregateSessionNavigationsMetrics()
  → Mesclar (mesma regra do handler principal)
  → Salvar userMetrics
  → Rodar aggregateGlobalMetrics()
```

### 6.4 Detalhe por Endpoint

#### `GET /metrics` — Globais
Retorna `aggregateMetrics/global`. Se stale → auto-refresh.
Se sem dados → retorna estrutura zerada com mensagem.

#### `GET /metrics?userId=xxx` — Por usuário
Retorna `userMetrics/{userId}`. 404 se não existir.

#### `GET /metrics/users` — Lista
Retorna array resumido:
```json
[
  {
    "userId": "xxx",
    "mode": "GRADUAL",
    "sessionsCount": 5,
    "acceptanceRate": 0.4,
    "passThroughRate": 0.2,
    "avgTimeToTask": 45000,
    "lastUpdated": "2024-01-01T00:00:00.000Z"
  }
]
```

#### `GET /metrics/compare?modeA=X&modeB=Y` — Comparação
- Com `modeA` e `modeB` → retorna os dois modos lado a lado
- Sem params → retorna todos os modos disponíveis (`byMode`)

#### `GET /metrics/export?format=csv|json` — Export
**Filtros suportados:** `userId`, `mode`, `dateFrom`, `dateTo`, `limit` (default 1000), `offset` (default 0)

**CSV:**
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename=adaptation_metrics_export.csv`
- Headers: `userId,mode,sessionsCount,shortcutsShown,shortcutsClicked,acceptanceRate,dashboardShown,dashboardChanged,passThroughRate,avgTimeToTask`
- Escaping: strings com `,`, `"` ou `\n` envoltas em aspas duplas, aspas internas dobradas

**JSON:**
```json
{
  "total": number,
  "filters": { "userId", "mode", "dateFrom", "dateTo" },
  "pagination": { "limit": 1000, "offset": 0 },
  "data": [...]
}
```

---

## 7. Agendamento e Execução

### 7.1 Cloud Scheduler — Agregação Diária

**Função:** `aggregateUserMetrics` (onRequest)

**Configuração do Scheduler:**
| Parâmetro | Valor |
|---|---|
| URL | `<function_url>/aggregateUserMetrics` |
| Schedule | `0 3 * * *` (todo dia às 3h UTC) |
| Method | GET |
| Header | `x-scheduler-secret: <SCHEDULER_SECRET>` |

### 7.2 Cloud Scheduler — Batch de Recomendações

**Função:** `generateDailyRecommendations` (onRequest)

**Configuração:**
| Parâmetro | Valor |
|---|---|
| Timeout | 540s (9 min) |
| Memory | 256MiB |
| Rate Limiting | 4100ms entre chamadas Gemini (~14.5 req/min) |
| Free Tier Gemini | Limite 15 RPM |

### 7.3 Chamada Manual

Ambos os schedulers podem ser chamados manualmente via:
- `?key=<ADMIN_KEY>` (header Authorization ou query param)

---

## 8. Schema de Dados — Resumo

### 8.1 Coleções Firestore

| Coleção | Documento | Finalidade |
|---|---|---|
| `userAdaptiveConfig` | `{userId}` | Configuração do modo do usuário |
| `adaptiveInterfaceCache` | `{userId}_{YYYY-MM-DD}` | Cache diário de recomendações (GRADUAL) |
| `sessionNavigations` | `{sessionId}` | Sessão INSTANT |
| `sessionNavigations/{sessionId}/navigations` | `{navId}` | Cliques na sessão |
| `userMetrics` | `{userId}` | Métricas agregadas do usuário |
| `aggregateMetrics` | `global` | Métricas globais + breakdown por modo |

### 8.2 Campos `userAdaptiveConfig/{userId}`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `userId` | string | Sim |
| `mode` | STATIC\|GRADUAL\|INSTANT | Sim |
| `sessionId` | string | Só para INSTANT |
| `testGroup` | string | Não |
| `expiresAt` | Timestamp | Não |
| `createdAt` | Timestamp | Sim (server) |

### 8.3 Campos `adaptiveInterfaceCache/{userId}_{date}`

| Campo | Tipo |
|---|---|
| `dashboard` | string\|null |
| `dashboardId` | string\|null |
| `cardType` | string\|null |
| `confidence` | number |
| `shortcuts` | array |
| `cachedAt` | Timestamp (server) |

---

## 9. Regras de Exceção e Edge Cases

### 9.1 Usuários Anônimos
- **Regra:** `userId == 'anonymous'` → **excluído** de todas as agregações
- **Aplica-se a:** BigQuery e Firestore

### 9.2 Rates com Denominador Zero
| Rate | Condição | Valor |
|---|---|---|
| `acceptanceRate` | `shortcutsShown == 0` | `null` |
| `passThroughRate` | `dashboardShown == 0` | `null` |

### 9.3 Duração de Sessão Inválida
| Condição | Valor |
|---|---|
| `firstTs` ou `lastTs` ausente/nulo | `null` |
| `lastTs <= firstTs` | `null` |

### 9.4 Top Screens
| Condição | Comportamento |
|---|---|
| Menos de 5 telas distintas | Retorna todas (ordenadas desc) |
| 5 ou mais telas | Limita a top 5 |
| Nenhuma navegação | `[]` |

### 9.5 Resolução de Tela (fallback)
```
screen = nav.screen || nav.route || nav.targetScreen
```
Se nenhum campo existir → tela ignorada na contagem

### 9.6 Confidence Cap (INSTANT)
| Navegações | Max Confidence |
|---|---|
| `< 10` | `min(0.5, navCount * 0.05)` |
| `>= 10` | `0.5` |

### 9.7 Dashboard null (INSTANT)
Se `navCount < 3` → `dashboard = null`, `dashboardId = null`, `cardType = null`

### 9.8 Modo Inválido na Requisição
Se `mode` não está em `[STATIC, GRADUAL, INSTANT]` → fallback para `GRADUAL`

### 9.9 Hour Inválido
Se `hour` não é inteiro entre 0-23 → fallback para `new Date().getHours()` (servidor)

---

## 10. Autenticação e Segurança

### 10.1 Funções Protegidas

| Função | Auth |
|---|---|
| `aggregateUserMetrics` | `ADMIN_KEY` ou `SCHEDULER_SECRET` (header `x-scheduler-secret`) |
| `generateDailyRecommendations` | `SCHEDULER_SECRET` (header `x-scheduler-secret`) |
| `adminAdaptiveMode` | `ADMIN_KEY` (header `Authorization: Bearer` ou query `?key=`) |
| `metricsApi` | `ADMIN_KEY` (header `Authorization: Bearer` ou query `?key=`) |

### 10.2 Função Pública

| Função | Auth |
|---|---|
| `getAdaptiveInterface` | onCall (Firebase Auth via `request.auth`) |

### 10.3 Admin API — Métodos Permitidos

| Método | Ação |
|---|---|
| GET | Listar configs ou buscar por `?userId=xxx` |
| POST/PUT | Configurar usuário (`{userId, mode, sessionId, testGroup, expiresAt}`) |
| DELETE | Encerrar sessão e remover config (`?userId=xxx`) |

### 10.4 Criação de Sessão
- **Apenas** modo `INSTANT` com `sessionId` informado cria documento em `sessionNavigations`
- `GRADUAL` e `STATIC` **não criam** sessão

### 10.5 Encerramento de Sessão (DELETE)
1. Remove `userAdaptiveConfig/{userId}`
2. Se tinha `sessionId` → atualiza `sessionNavigations/{sessionId}` com `status: 'completed'` e `endedAt`

---

## 11. Fluxo de Execução — Resumo

### 11.1 Agregação Completa (Scheduler)
```
1. aggregateMetricsFromBigQuery()     → métricas BQ por usuário
2. aggregateSessionNavigationsMetrics() → métricas FS por usuário
3. Merge das duas fontes              → Map consolidado
4. Batch write → userMetrics/{userId} → Firestore (merge: true)
5. aggregateGlobalMetrics()           → aggregateMetrics/global
```

### 11.2 Consulta com Auto-Refresh
```
1. GET /metrics
2. Checar aggregateMetrics/global.lastUpdated
3. Se > 24h ou inexistente:
   a. aggregateMetricsFromBigQuery()
   b. aggregateSessionNavigationsMetrics()
   c. Merge + save userMetrics
   d. aggregateGlobalMetrics()
4. Retornar dados
```

### 11.3 Batch de Recomendações (GRADUAL)
```
1. fetchActiveUsers()         → usuários do dia anterior (BigQuery)
2. Para cada usuário:
   a. Checar cache (adaptiveInterfaceCache)
   b. Se miss → fetchNavigationHistory() → Gemini → setCache()
   c. Rate limit: 4100ms entre chamadas
3. Retornar summary {total, success, skipped, errors}
```

---

## 12. Variáveis de Ambiente

| Variável | Descrição | Obrigatória |
|---|---|---|
| `BIGQUERY_PROJECT_ID` | ID do projeto GCP | Sim |
| `BIGQUERY_ANALYTICS_DATASET` | Dataset do Firebase Analytics | Sim |
| `GEMINI_API_KEY` | API Key do Google Gemini | Sim |
| `SCHEDULER_SECRET` | Segredo para Cloud Scheduler | Sim |
| `ADMIN_KEY` | Chave de admin para APIs | Sim |

---

## 13. Constantes de Negócio

### 13.1 Páginas Excluídas (não contam para métricas/recomendações)
```
'/modulosPage', '/splashPage', '/loginPage', '/homePage',
'/cadastroPage', '/recuperarSenha', '/codigoSeguranca', '/novaSenha',
'/multiAccountsPage', '/confirmsegurancaPage', '/permissaoNegadaPage'
```

### 13.2 Telas com Requisito de Recurso
| Tela | Tipo de Recurso |
|---|---|
| `/lotePage` | `lote` |
| `/setorPage` | `setor` |
| `/solucaoPage` | `solucao` |
| `/reservatoriosPage` | `reservatorio` |

> Telas não listadas funcionam sem `resourceId`/`resourceType`.

### 13.3 Dashboards Configurados
| ID Técnico | Display Name | Card Type | Telas |
|---|---|---|---|
| `LOTE_PRODUCAO` | Lotes em Produção | `lotes` | `/lotePage`, `/setorPage` |
| `TAREFAS_PENDENTES` | Tarefas Pendentes | `tarefas` | `/agendaPage`, `/gerenciarEquipePage` |
| `PRODUCAO_TOTAL` | Produção Total | `producao` | `/solucaoPage`, `/reservatoriosPage`, `/historicoPage` |
| `SAUDE_EQUIPES` | Saúde das Equipes | `saude` | `/gerenciarEquipePage`, `/agendaPage` |

### 13.4 Atalhos Padrão (STATIC / fallback)
```json
[
  { "route": "/lotePage", "confidence": 0.5 },
  { "route": "/solucaoPage", "confidence": 0.5 },
  { "route": "/agendaPage", "confidence": 0.5 },
  { "route": "/reservatoriosPage", "confidence": 0.5 }
]
```

---

## 14. Histórico de Alterações

| Data | Alteração |
|---|---|
| 2026-04-13 | Adição de `aggregateSessionNavigationsMetrics()` — métricas de sessões INSTANT do Firestore agora complementam métricas do BigQuery |
| 2026-04-13 | Regra de merge: `mode` do BigQuery NUNCA é sobrescrito pelo Firestore |
| 2026-04-13 | Novos campos em `userMetrics`: `navigationsFromSessions`, `uniqueScreensFromSessions`, `avgSessionDurationMs`, `topScreensFromSessions` |
