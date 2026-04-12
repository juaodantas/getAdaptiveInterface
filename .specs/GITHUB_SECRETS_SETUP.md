# Configurando GitHub Secrets para Deploy Automático

## Problema
Cada deploy manual sobrescrevia as variáveis de ambiente configuradas diretamente no Firebase Console.

## Solução
Todas as variáveis de ambiente agora são gerenciadas via **GitHub Secrets** e injetadas automaticamente durante o deploy.

## Configuração Necessária

Adicione os seguintes secrets no seu repositório GitHub:

### 1. Acesse:
`GitHub > Seu Repositório > Settings > Secrets and variables > Actions > New repository secret`

### 2. Secrets obrigatórios:

| Secret | Descrição | Onde encontrar |
|--------|-----------|----------------|
| `BIGQUERY_PROJECT_ID` | ID do projeto GCP com dados BigQuery | Google Cloud Console |
| `BIGQUERY_ANALYTICS_DATASET` | Dataset do Firebase Analytics (ex: `analytics_123456789`) | Firebase Console > Project Settings > Integrations > BigQuery |
| `GEMINI_API_KEY` | API Key do Gemini para IA | Google AI Studio (aistudio.google.com) |
| `SCHEDULER_SECRET` | Secret para autenticação de jobs agendados | Gerado por você |
| `ADMIN_KEY` | Chave para proteger endpoints de administração | Gerado por você |
| `FIREBASE_PROJECT_ID` | ID do projeto Firebase | Firebase Console > Project Settings |
| `FIREBASE_TOKEN` | Token de autenticação Firebase | Execute: `firebase login:ci` |

### 3. Gerar Firebase Token:
```bash
firebase login:ci
```
Copie o token gerado e adicione como `FIREBASE_TOKEN` nos secrets.

## Como funciona agora

1. ✅ Todo push na branch `main` executa o deploy
2. ✅ As variáveis são lidas dos GitHub Secrets
3. ✅ Um arquivo `.env` é criado temporariamente no runner
4. ✅ O Firebase Functions recebe as variáveis automaticamente
5. ✅ **Nunca mais você perderá as variáveis!**

## Testar localmente

Crie um arquivo `.env` baseado no `.env.template`:
```bash
cp .env.template .env
```

Preencha com seus valores e execute:
```bash
firebase emulators:start
```

## Verificar variáveis no Firebase

Após o deploy, verifique:
```bash
firebase functions:config:get --project SEU_PROJECT_ID
```

Ou acesse: Firebase Console > Functions > Sua Function > Variáveis de ambiente
