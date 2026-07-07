const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals, ROUTE_CONFLICT_RESOLVER, STEP_SHORTCUTS } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateInstantResponse, validateRawInstantResponse, finalizeValidInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
const { resolveRouteConflicts } = require('../../src/instantInfoRecommendationBuilder');
const { ENHANCED_INSTANT_METRIC_EVENTS, getSupportedMetricEventsSqlList } = require('../../src/adaptiveMetrics');

function capabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'HomeInfoCard'],
    maxShortcuts: 3,
    maxSectionAdaptations: 4,
    ...overrides,
  });
}

function context(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2 },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: false },
    ...overrides,
  });
}

function cadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2, nextActivity: { title: 'Registre uma atividade no caderno de campo', type: 'nutritional_adjustment', status: 'pending', dueLabel: 'Hoje' } },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false },
    ...overrides,
  });
}

function geminiResponse(overrides = {}) {
  return {
    responseVersion: '1.0',
    dashboard: 'Tarefas Pendentes',
    dashboardId: 'TAREFAS_PENDENTES',
    cardType: 'tarefas',
    confidence: 0.84,
    nextStepPrediction: {
      stepId: 'record_caderno_adjustment',
      confidence: 0.84,
      title: 'Registre o ajuste no Caderno de Campo',
      description: 'Há atividades verificadas. Registre o ajuste no caderno.',
      targetRoute: '/cadernoCampoPage',
      actionLabel: 'Abrir Caderno',
    },
    sectionAdaptations: [{
      sectionId: 'recommended_actions',
      component: 'NextStepCard',
      priority: 'high',
      treatment: 'prominent',
      title: 'Registre o ajuste no Caderno de Campo',
      description: 'Há atividades pendentes para conferir.',
    }],
    shortcuts: [
      { route: '/solucaoPage', confidence: 0.84, label: 'Ver Solução', reason: 'Solução disponível.' },
      { route: '/agendaPage', confidence: 0.71, label: 'Ver Agenda', reason: 'Atividades pendentes.' },
    ],
    focus: { component: 'AdaptiveFocusBanner', message: 'Próximo foco: Caderno.', targetSectionId: 'recommended_actions', priority: 'high' },
    uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
    reason: 'Contexto operacional indica Caderno de Campo.',
    reasonDetails: { summary: 'Contexto operacional.', details: ['RULE-003'], display: 'info_icon' },
    rulesApplied: ['RULE-003'],
    infoRecommendation: {
      type: 'field_notes_summary',
      source: 'isis',
      priority: 'high',
      title: 'Resumo do caderno',
      reason: 'Há registros operacionais recentes para conferir.',
      ctaRoute: '/relatoriosPage',
      category: 'caderno_campo',
    },
    ...overrides,
  };
}

describe('INSTANT route recommendation', () => {
  test('prompt contains Gemini recommendation schema with activity context', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: [],
      operationalContext: cadernoContext(),
      clientCapabilities: capabilities(),
      signals,
    });

    expect(prompt).toContain('nextStepPrediction');
    expect(prompt).toContain('infoRecommendation');
    expect(prompt).toContain('shortcuts');
    expect(prompt).toContain('ctaRoute deve ser DIFERENTE de targetRoute');
    expect(prompt).toContain('currentActivityContext');
    expect(prompt).toContain('nextActivity');
    expect(prompt).not.toContain('CPF');
  });

  test('normalizer parses Gemini response with nextStep, info, shortcuts', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const normalized = normalizeInstantResponse(geminiResponse(), capabilities(), signals, cadernoContext());

    expect(normalized).not.toBeNull();
    expect(normalized.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
    expect(normalized.infoRecommendation.ctaRoute).toBe('/relatoriosPage');
    expect(normalized.shortcuts.length).toBeLessThanOrEqual(3);
    expect(normalized.confidence).toBe(0.84);
  });

  test('normalizer caps shortcuts at 3', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const manyShortcuts = geminiResponse({
      shortcuts: [
        { route: '/a', label: 'A' },
        { route: '/b', label: 'B' },
        { route: '/c', label: 'C' },
        { route: '/d', label: 'D' },
        { route: '/e', label: 'E' },
      ],
    });
    const normalized = normalizeInstantResponse(manyShortcuts, capabilities(), signals, cadernoContext());
    expect(normalized.shortcuts.length).toBeLessThanOrEqual(3);
  });

  test('resolveRouteConflicts ensures unique routes', () => {
    const resolved = resolveRouteConflicts('record_caderno_adjustment', '/cadernoCampoPage', null, [
      { route: '/cadernoCampoPage', label: 'Registrar', group: 'primary' },
      { route: '/agendaPage', label: 'Agenda', group: 'secondary' },
    ]);

    expect(resolved.nextStepRoute).toBe('/cadernoCampoPage');
    const routes = [resolved.nextStepRoute, ...resolved.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
    expect(resolved.shortcuts[0].route).not.toBe('/cadernoCampoPage');
  });

  test('resolveRouteConflicts resolves info ctaRoute conflict', () => {
    const resolved = resolveRouteConflicts('record_caderno_adjustment', '/cadernoCampoPage', '/cadernoCampoPage', [
      { route: '/agendaPage', label: 'Agenda' },
    ]);

    expect(resolved.infoCtaRoute).not.toBe('/cadernoCampoPage');
    expect(resolved.infoCtaRoute).toBe('/relatoriosPage');
  });

  test('fallback response has unique routes and max 3 shortcuts', () => {
    const fallback = buildEnhancedInstantFallback({ operationalContext: cadernoContext(), clientCapabilities: capabilities() });

    expect(fallback.fallback.used).toBe(true);
    expect(fallback.shortcuts.length).toBeLessThanOrEqual(3);
    const routes = [fallback.nextStepPrediction.targetRoute, fallback.infoRecommendation.ctaRoute, ...fallback.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('finalizeValidInstantResponse applies conflict resolver', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const raw = geminiResponse({
      nextStepPrediction: { ...geminiResponse().nextStepPrediction, targetRoute: '/cadernoCampoPage' },
      infoRecommendation: { ...geminiResponse().infoRecommendation, ctaRoute: '/cadernoCampoPage' },
      shortcuts: [
        { route: '/cadernoCampoPage', label: 'Caderno' },
        { route: '/agendaPage', label: 'Agenda' },
      ],
    });
    const normalized = normalizeInstantResponse(raw, capabilities(), signals, cadernoContext());
    const result = finalizeValidInstantResponse(normalized, capabilities(), signals);

    expect(result.mode).toBe('INSTANT');
    expect(result.fallback.used).toBe(false);
    const routes = [result.nextStepPrediction.targetRoute, result.infoRecommendation.ctaRoute, ...result.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('enhanced mode end-to-end with valid Gemini returns unique routes', async () => {
    const ctx = cadernoContext();
    const caps = capabilities();
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse()),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.mode).toBe('INSTANT');
    const routes = [response.nextStepPrediction.targetRoute, response.infoRecommendation.ctaRoute, ...response.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
    expect(response.shortcuts.length).toBeLessThanOrEqual(3);
  });

  test('ROUTE_CONFLICT_RESOLVER covers all steps', () => {
    const steps = Object.keys(STEP_SHORTCUTS);
    for (const step of steps) {
      expect(ROUTE_CONFLICT_RESOLVER).toHaveProperty(step);
    }
  });

  test('capabilities normalize supportedInfoTypes', () => {
    expect(normalizeClientCapabilities({ supportedInfoTypes: ['basic_tip', 'invalid', 'basic_tip'] }).supportedInfoTypes).toEqual(['basic_tip']);
    expect(normalizeClientCapabilities({ supportedInfoTypes: [] }).supportedInfoTypes).toContain('reservoir_report');
    expect(normalizeClientCapabilities({}).supportedComponents).toContain('HomeInfoCard');
  });

  test('metrics include info card events', () => {
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('info_card_shown');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('info_card_clicked');
    expect(getSupportedMetricEventsSqlList()).toContain("'info_card_shown'");
    expect(getSupportedMetricEventsSqlList()).toContain("'info_card_clicked'");
  });
});
