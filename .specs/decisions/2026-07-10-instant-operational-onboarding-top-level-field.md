# Decisão: `operationalOnboarding` como campo top-level na resposta INSTANT

## O que foi decidido

Criar um novo campo top-level `operationalOnboarding` na resposta INSTANT, separado de `infoRecommendation`, suportado por um novo módulo `src/instantOperationalOnboardingBuilder.js`.

## Por que

1. O `OperationalOnboardingCard` na Home precisa de dados estruturados (steps, priority numérico, CTA) que não se encaixam no schema de `infoRecommendation`.
2. O campo é sempre determinístico (server-side, nunca do Gemini), enquanto `infoRecommendation` pode vir do Gemini.
3. A presença do campo depende exclusivamente do `stepId` retornado por `deriveInstantSignals` — não de decisão do Gemini.
4. Separar evita acoplamento: mudanças no onboarding não afetam `infoRecommendation` e vice-versa.

## O que foi descartado

- **Manter `operational_onboarding` como `expectedInfoType` de `infoRecommendation`**: Forçaria o Gemini a produzir um tipo que ele não conhece, exigiria fallback complexo e não modelaria steps/priority numérico.
- **Fundir com `sectionAdaptations`**: O componente `OperationalOnboardingCard` é um card da Home, não uma adaptação de seção. Semântica incorreta.
- **Deixar o Gemini decidir o conteúdo**: Determinístico é mais seguro, mais barato e mais previsível para onboarding.

## Trade-offs

- **+** Simplicidade: módulo pequeno, sem impacto no pipeline Gemini.
- **+** Isolamento: zero mudanças em `index.js`, `instantDomainRules.js`, `instantInfoRecommendationBuilder.js`.
- **+** Testabilidade: função pura, sem dependência externa.
- **-** Um campo a mais no contrato público: clientes precisam ignorar campos desconhecidos (já é prática atual).
- **-** Custo de manutenção de mais um builder module: mitigado pelo tamanho pequeno (<100 linhas esperado).
