# getAdaptiveInterface — Firebase Cloud Function

Cloud Function que analisa o histórico de navegação do usuário via BigQuery (Firebase Analytics) e retorna recomendações personalizadas de dashboard e atalhos de tela para a interface adaptativa do app OSI Soluções.

## Como funciona

```
App (Flutter) → onCall(userId, hour) → Cloud Function
                                            ↓
                                     BigQuery (Firebase Analytics)
                                     ┌──────────────────────────────┐
                                     │  Query 1: Dashboard por hora │
                                     │  Query 2: Atalhos por hora   │
                                     │  Query 3: Dashboard fallback │
                                     └──────────────────────────────┘
                                            ↓
                              { dashboard, confidence, shortcuts }
```

A função analisa os últimos 30 dias de eventos `navigation_click` e infere:
- **Dashboard:** qual card de resumo exibir no topo da home (baseado nas rotas mais acessadas por aquele usuário naquele horário)
- **Atalhos:** quais telas o usuário tende a acessar naquele horário, com recurso específico quando disponível (ex: lote #42)

## Pré-requisitos

- Node.js 22+
- Firebase CLI: `npm install -g firebase-tools`
- Projeto Firebase com BigQuery export ativo
- Service Account com permissão `BigQuery Data Viewer` no dataset de Analytics

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar GitHub Secrets (para deploy automatizado)
# Veja o guia completo em: GITHUB_SECRETS_SETUP.md

# 3. Para desenvolvimento local, crie um .env baseado no .env.template
cp .env.template .env
# editar .env com seus valores
```

## Deploy

### Automatizado (Recomendado)
O deploy é feito automaticamente via GitHub Actions ao fazer push na branch `main`.

**Configure os secrets no seu repositório GitHub seguindo o guia:** [GITHUB_SECRETS_SETUP.md](GITHUB_SECRETS_SETUP.md)

### Manual
```bash
firebase deploy --only functions --project SEU_PROJECT_ID
```

## Variáveis de Ambiente

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `BIGQUERY_PROJECT_ID` | Sim | GCP Project ID com os dados do Firebase Analytics |
| `BIGQUERY_ANALYTICS_DATASET` | Sim | Dataset do Firebase Analytics (formato: `analytics_<APP_ID>`) |
| `GEMINI_API_KEY` | Sim | API Key do Gemini para geração de recomendações |
| `SCHEDULER_SECRET` | Sim | Secret para autenticação de jobs agendados |
| `ADMIN_KEY` | Sim | Chave para proteger endpoints de administração |

**Todas as variáveis são configuradas via GitHub Secrets e injetadas automaticamente no deploy.**

## Contrato da API

### Input

Chamada via `functions.httpsCallable('getAdaptiveInterface')` no Flutter.

```json
{
  "userId": "123",
  "hour": 14
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `userId` | `string` | Sim | ID do usuário autenticado. Fallback: `context.auth.uid` |
| `hour` | `number` | Não | Hora atual (0–23). Se ausente ou inválido, usa hora do servidor |

**Validações:**
- `userId` vazio → retorna `{ dashboard: null, confidence: 0.0, shortcuts: [] }`
- `hour` inválido (NaN, negativo, > 23) → usa `new Date().getHours()` como fallback (sem erro)

### Output

```json
{
  "dashboard": "Lotes em Produção",
  "confidence": 0.73,
  "shortcuts": [
    {
      "route": "/detalhesLotePage",
      "confidence": 0.42,
      "resourceId": "87",
      "resourceType": "lote",
      "resourceName": "Lote Alface Crespa"
    },
    {
      "route": "/agendaPage",
      "confidence": 0.28
    }
  ]
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `dashboard` | `string \| null` | Nome do dashboard recomendado. `null` se sem dados |
| `confidence` | `number` | Confiança da recomendação (0.0–1.0) |
| `shortcuts` | `array` | Até 4 atalhos ordenados por probabilidade decrescente |
| `shortcuts[].route` | `string` | Rota GetX da tela (ex: `/lotePage`) |
| `shortcuts[].confidence` | `number` | Probabilidade do atalho (> 0.1) |
| `shortcuts[].resourceId` | `string?` | ID do recurso específico, quando disponível |
| `shortcuts[].resourceType` | `string?` | Tipo do recurso: `"lote"`, `"setor"`, etc. |
| `shortcuts[].resourceName` | `string?` | Nome legível do recurso |

**Valores possíveis para `dashboard`:**

| Valor | Rotas que inferem |
|-------|------------------|
| `"Lotes em Produção"` | `/lotePage`, `/setorPage` |
| `"Tarefas Pendentes"` | `/agendaPage`, `/gerenciarEquipePage` |
| `"Produção Total"` | `/solucaoPage`, `/reservatoriosPage`, `/historicoPage` |

### Comportamento de fallback

1. Query principal busca dashboard filtrado por `userId` + `hour` (últimos 30 dias)
2. Se sem resultados → fallback: mesma query sem filtro de `hour` (todos os horários do usuário)
3. Se erro no BigQuery → fallback silencioso, retorna `{ dashboard: null, confidence: 0.0, shortcuts: [] }`

## Estrutura do Código

```
index.js
├── Configuração          — PROJECT_ID, ANALYTICS_DATASET via process.env
├── Constantes SQL        — EXCLUDED_PAGES_SQL, DASHBOARD_CASE_SQL, USER_ID_SQL
├── buildDashboardQuery() — gera query 1 (com hora) ou query 3 (fallback sem hora)
├── queryShortcuts        — query 2, filtrada por userId + hour
└── getAdaptiveInterface  — handler principal: validação → BigQuery → resposta
```

## Queries BigQuery

### Query 1 & 3 — Dashboard

Analisa eventos `navigation_click` do usuário e infere qual dashboard ele prefere naquele horário, mapeando rotas para categorias via `DASHBOARD_CASE_SQL`. A Query 3 (fallback) é gerada pela mesma função `buildDashboardQuery(false)`, sem o filtro de hora.

### Query 2 — Atalhos

Analisa as telas mais acessadas pelo usuário naquele horário. Quando o evento contém `resource_id` (ex: clique em um lote específico), o recurso é incluído no resultado para permitir navegação direta.

**Evento esperado no Firebase Analytics:**

```
event_name: "navigation_click"
event_params:
  - screen_name: "/lotePage"
  - hour: 14                    (opcional — extraído do timestamp se ausente)
  - resource_id: "87"           (opcional — ID do recurso navegado)
  - resource_type: "lote"       (opcional)
  - resource_name: "Alface Crespa" (opcional)
```
