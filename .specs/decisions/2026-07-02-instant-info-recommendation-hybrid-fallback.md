# Decisão — Fallback híbrido para `infoRecommendation` no INSTANT

## Contexto

A seção de Info contextual da Home precisa receber `infoRecommendation` no modo `INSTANT`. Gemini pode auxiliar a seleção, mas sua saída pode vir ausente, incompleta ou fora do contrato.

## O que foi decidido

Usar abordagem híbrida/resiliente: Gemini pode retornar `infoRecommendation` conforme schema, mas normalização e validação devem anexar ou substituir por fallback determinístico baseado em `deriveInstantSignals` quando o campo vier ausente ou inválido. `infoRecommendation` é obrigatório nas respostas finais `INSTANT`.

## Por que

- Mantém contrato estável para o frontend.
- Evita depender do Gemini para uma recomendação obrigatória.
- Reduz risco de PII, pois o fallback usa apenas sinais normalizados.
- Permite preservar compatibilidade legada adicionando um campo novo.

## O que foi descartado

- Tornar `infoRecommendation` opcional no `INSTANT`.
- Deixar Gemini autoritativo sem fallback determinístico.
- Implementar regras da Info diretamente em `index.js` ou no orquestrador principal.
