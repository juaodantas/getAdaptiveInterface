# Cloud Function Refactor — Especificação

## Problem Statement

A Cloud Function `getAdaptiveInterface` apresenta 7 problemas identificados em revisão de código:
2 de alta prioridade (comportamento incorreto / segurança), 2 médios (manutenção), 3 baixos (qualidade).

## Goals

- [ ] Atalhos refletem o comportamento real do usuário autenticado (não de todos)
- [ ] Entradas inválidas são rejeitadas antes de chegar ao BigQuery
- [ ] Código SQL sem duplicação — manutenção em ponto único
- [ ] Configuração via variáveis de ambiente (suporte a múltiplos ambientes)
- [ ] Código limpo: sem dead code, sem filtros duplicados, sem logs de debug em produção

## Requirement Traceability

| ID | Descrição | Prioridade | Status |
|----|-----------|------------|--------|
| CF-01 | Filtro `userId` na `queryShortcuts` | Alta | Done |
| CF-02 | Validação de entrada (`hour` e `userId`) | Alta | Done |
| CF-03 | Eliminar duplicação SQL (NOT IN, CASE WHEN, fallback query) | Média | Done |
| CF-04 | Config via `process.env` (`BIGQUERY_PROJECT_ID`, `BIGQUERY_ANALYTICS_DATASET`) | Média | Done |
| CF-05 | Remover dead code `appDataset` | Baixa | Done |
| CF-06 | Remover `.filter(prob > 0.1)` duplicado no JS | Baixa | Done |
| CF-07 | Simplificar logging (remover debug de tipos, manter operacional) | Baixa | Done |

## Technical Design

### Consolidação SQL

**Antes:** 3 queries separadas com blocos NOT IN idênticos, CASE WHEN duplicado, fallback = query principal sem filtro de hora.

**Depois:**
- `EXCLUDED_PAGES_SQL` — constante JS interpolada nas 3 queries
- `DASHBOARD_CASE_SQL` — constante JS interpolada nas 2 queries de dashboard
- `USER_ID_SQL` — bloco COALESCE reutilizado
- `buildDashboardQuery(includeHour)` — função que gera query 1 (com hora) e query 3 (fallback, sem hora)

### Filtro userId em Shortcuts

Query 2 passa a filtrar por `userId` com o mesmo padrão COALESCE das outras queries. O parâmetro `userId` é adicionado ao `params` da chamada BigQuery.

### Validação de Entrada

```
userId: string não vazia (após trim) → retorno de erro se vazio
hour: Number inteiro entre 0 e 23 → fallback para hora atual do servidor se inválido (não rejeita hard)
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `BIGQUERY_PROJECT_ID` | `adaptative-user-interface` | GCP project ID |
| `BIGQUERY_ANALYTICS_DATASET` | — | Dataset do Firebase Analytics |

## Success Criteria

- [ ] Atalhos retornados são filtrados pelo usuário autenticado
- [ ] `hour=NaN`, `hour=-1`, `hour=25` não causam query BigQuery com parâmetro inválido
- [ ] Cada bloco SQL crítico existe em exatamente 1 lugar no código
- [ ] Deploy funciona com variáveis de ambiente configuradas via `firebase functions:config`
- [ ] Nenhum log de tipo/valor interno em execução normal
