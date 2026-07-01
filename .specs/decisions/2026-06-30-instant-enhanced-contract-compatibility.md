# Decisão — Compatibilidade do contrato do INSTANT aprimorado

## O que foi decidido

- `INSTANT` exige `sessionId`, aceitando `data.session.sessionId` e `data.sessionId` durante a transição.
- Ausência de `sessionId` válido em `INSTANT` retorna erro Cloud Functions `invalid-argument` antes de chamar Gemini.
- A response preserva os campos legados `dashboard`, `dashboardId`, `cardType`, `confidence`, `shortcuts`, `mode`, `source`, `visualPriority` e `reason`.
- `reason` preserva o tipo legado `string|null`; explicações estruturadas são retornadas no novo campo aditivo `reasonDetails`.
- `GRADUAL` permanece como modo legado existente; nenhum quarto modo será criado.
- `session_start` legado e `adaptive_session_start` devem ser suportados.
- Rotas permitidas ficam centralizadas em allowlist hardcoded na Function nesta fase; o Flutter não envia `allowedRoutes`.
- `resourceName` e textos livres identificáveis devem ser removidos antes de montar o prompt Gemini.

## Por quê

- Preserva compatibilidade com o contrato e métricas atuais enquanto permite o novo payload versionado.
- Torna o requisito `sessionId` obrigatório testável sem quebrar clientes que ainda usam o campo top-level.
- Evita breaking change em clientes que tratam `reason` como texto simples ou ausência de texto.
- Reduz risco de vazamento de PII para Gemini.
- Evita acoplamento novo com Flutter para governança de rotas.
- Mantém o desenho experimental com modos existentes: `STATIC`, `GRADUAL` e `INSTANT`.

## O que foi descartado

- Exigir somente `data.session.sessionId` já na primeira implementação.
- Aceitar `INSTANT` sem sessão e cair silenciosamente para fallback.
- Receber `allowedRoutes` do Flutter.
- Enviar `resourceName` ao Gemini para melhorar linguagem contextual.
- Criar novo modo para diferenciar o `INSTANT` aprimorado.
- Reutilizar `reason` como objeto estruturado com `summary`, `details` e `display`.
