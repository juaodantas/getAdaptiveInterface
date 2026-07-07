const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals, STEP_ROUTE_RANKING } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateInstantResponse, validateRawInstantResponse, finalizeValidInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
const { distributeFromRanking, ROUTE_TO_INFO_META, ROUTE_DEFAULT_LABELS } = require('../../src/instantRouteDistributor');
const { ENHANCED_INSTANT_METRIC_EVENTS, getSupportedMetricEventsSqlList } = require('../../src/adaptiveMetrics');

function capabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'HomeInfoCard'],
    maxShortcuts: 4,
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

// Context for record_caderno_adjustment (RULE-003)
function cadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2 },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false },
    ...overrides,
  });
}

function geminiResponse(overrides = {}) {
  return {
    responseVersion: '1.0',
    confidence: 0.84,
    enrichedRoutes: [
      { title: 'Verifique as atividades geradas na Agenda', description: 'Há atividades geradas para conferir.', actionLabel: 'Abrir Agenda', reason: 'Atividades pendentes.' },
      { title: 'Consulte os lotes em produção', description: 'Veja os lotes vinculados ao protocolo.', actionLabel: 'Ver Lotes', reason: null },
      { title: 'Revise o protocolo criado', description: 'Confira o protocolo do lote.', actionLabel: 'Abrir Protocolo', reason: 'Protocolo ativo.' },
    ],
    reason: 'Contexto operacional indica Agenda.',
    reasonDetails: { summary: 'Contexto operacional indica Agenda.', details: ['RULE-002'], display: 'info_icon' },
    rulesApplied: ['RULE-002'],
    ...overrides,
  };
}

describe('INSTANT route ranking', () => {
  test('prompt contains ranking routes and enrichedRoutes schema', () => {
    const signals = deriveInstantSignals(context());
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: [],
      operationalContext: context(),
      clientCapabilities: capabilities(),
      signals,
    });

    expect(prompt).toContain('/agendaPage');
    expect(prompt).toContain('enrichedRoutes');
    expect(prompt).toContain('actionLabel');
    expect(prompt).not.toContain('Maria');
    expect(prompt).not.toContain('CPF');
  });

  test('normalizer parses enrichedRoutes from Gemini', () => {
    const signals = deriveInstantSignals(context());
    const normalized = normalizeInstantResponse(geminiResponse(), capabilities(), signals);

    expect(normalized).not.toBeNull();
    expect(Array.isArray(normalized.enrichedRoutes)).toBe(true);
    expect(normalized.enrichedRoutes.length).toBeGreaterThanOrEqual(3);
    expect(normalized.enrichedRoutes[0].title).toBe('Verifique as atividades geradas na Agenda');
    expect(normalized.confidence).toBe(0.84);
  });

  test('normalizer handles missing enrichedRoutes with empty array', () => {
    const signals = deriveInstantSignals(context());
    const normalized = normalizeInstantResponse(geminiResponse({ enrichedRoutes: undefined }), capabilities(), signals);

    expect(Array.isArray(normalized.enrichedRoutes)).toBe(true);
    expect(normalized.enrichedRoutes).toHaveLength(0);
  });

  test('raw validator rejects missing enrichedRoutes', () => {
    const validation = validateRawInstantResponse({}, capabilities());
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('missing_enriched_routes');
  });

  test('distributeFromRanking assigns unique routes per step', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const { nextStep, infoRec, shortcuts } = distributeFromRanking({
      ranking: signals.ranking,
      enrichedRoutes: null,
      clientCapabilities: capabilities(),
      stepId: signals.stepId,
      confidence: 0.75,
    });

    const allRoutes = [nextStep.targetRoute, infoRec.ctaRoute, ...shortcuts.map((s) => s.route)];
    const uniqueRoutes = new Set(allRoutes);
    expect(uniqueRoutes.size).toBe(allRoutes.length);
    expect(nextStep.targetRoute).toBe('/cadernoCampoPage');
    expect(infoRec.ctaRoute).toBe('/solucaoPage');
  });

  test('distributeFromRanking respects maxShortcuts', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const limited = capabilities({ maxShortcuts: 2 });
    const { shortcuts } = distributeFromRanking({
      ranking: signals.ranking,
      enrichedRoutes: null,
      clientCapabilities: limited,
      stepId: signals.stepId,
      confidence: 0.75,
    });

    expect(shortcuts.length).toBeLessThanOrEqual(2);
  });

  test('ROUTE_TO_INFO_META covers all routes in rankings', () => {
    const allRoutedRoutes = new Set(Object.values(STEP_ROUTE_RANKING).flat());
    for (const route of allRoutedRoutes) {
      expect(ROUTE_TO_INFO_META).toHaveProperty(route);
    }
  });

  test('ROUTE_DEFAULT_LABELS covers all routes in rankings', () => {
    const allRoutedRoutes = new Set(Object.values(STEP_ROUTE_RANKING).flat());
    for (const route of allRoutedRoutes) {
      expect(ROUTE_DEFAULT_LABELS).toHaveProperty(route);
    }
  });

  test('fallback response uses distributeFromRanking with unique routes', () => {
    const fallback = buildEnhancedInstantFallback({ operationalContext: cadernoContext(), clientCapabilities: capabilities() });

    expect(fallback.fallback.used).toBe(true);
    expect(fallback.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
    expect(fallback.infoRecommendation.ctaRoute).toBe('/solucaoPage');

    const routes = [fallback.nextStepPrediction.targetRoute, fallback.infoRecommendation.ctaRoute, ...fallback.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('finalizeValidInstantResponse returns correctly distributed response', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const normalized = normalizeInstantResponse(geminiResponse({
      enrichedRoutes: [
        { title: 'Registre o ajuste', description: 'Ajuste pendente no caderno', actionLabel: 'Abrir Caderno', reason: 'Ajuste pendente.' },
        { title: 'Consulte solução', description: 'Solução disponível', actionLabel: 'Ver Solução', reason: null },
      ],
    }), capabilities(), signals);

    const result = finalizeValidInstantResponse(normalized, capabilities(), signals);

    expect(result.mode).toBe('INSTANT');
    expect(result.source).toBe('adaptive');
    expect(result.visualPriority).toBe('moderate');
    expect(result.fallback.used).toBe(false);
    expect(result.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
    expect(result.infoRecommendation.ctaRoute).toBe('/solucaoPage');

    const routes = [result.nextStepPrediction.targetRoute, result.infoRecommendation.ctaRoute, ...result.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('enhanced mode end-to-end with valid Gemini uses distributeFromRanking', async () => {
    const ctx = cadernoContext();
    const caps = capabilities();
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse({
        enrichedRoutes: [
          { title: 'Registre o ajuste', description: 'Ajuste pendente', actionLabel: 'Abrir Caderno', reason: null },
          { title: 'Ver solução', description: 'Solução disponível', actionLabel: 'Ver Solução', reason: null },
          { title: 'Consultar agenda', description: 'Atividades programadas', actionLabel: 'Abrir Agenda', reason: null },
        ],
      })),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.mode).toBe('INSTANT');
    const routes = [response.nextStepPrediction.targetRoute, response.infoRecommendation.ctaRoute, ...response.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('all steps have unique routes across surfaces', () => {
    for (const [stepId, ranking] of Object.entries(STEP_ROUTE_RANKING)) {
      const { nextStep, infoRec, shortcuts } = distributeFromRanking({
        ranking,
        enrichedRoutes: null,
        clientCapabilities: capabilities(),
        stepId,
        confidence: 0.75,
      });

      const routes = [nextStep.targetRoute, infoRec.ctaRoute, ...shortcuts.map((s) => s.route)];
      const uniqueCount = new Set(routes).size;
      expect(uniqueCount).toBe(routes.length);
    }
  });

  test('capabilities normalize supportedInfoTypes and default components include HomeInfoCard', () => {
    expect(normalizeClientCapabilities({ supportedInfoTypes: ['basic_tip', 'invalid', 'basic_tip'] }).supportedInfoTypes).toEqual(['basic_tip']);
    expect(normalizeClientCapabilities({ supportedInfoTypes: [] }).supportedInfoTypes).toContain('reservoir_report');
    expect(normalizeClientCapabilities({}).supportedComponents).toContain('HomeInfoCard');
  });

  test('operational context normalizes only canonical test sequence signals and safe info states', () => {
    const normalized = normalizeOperationalContext({
      reservoirState: { hasReservoirs: true, totalCount: 2, currentLevel: 'LOW', reservoirName: 'Reservatório João' },
      infoContextState: { lastShownType: 'day_progress', lastShownCategory: 'agenda', customText: 'Maria' },
      fieldNotebookState: { hasRecentFieldNotes: true, uncheckedNotesCount: 4, latestRecordType: 'field_note', noteDescription: 'CPF' },
      testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true },
    });

    expect(normalized.testSequenceSignals).toMatchObject({ lotWithProtocolCreated: true, generatedActivitiesSeen: true });
    expect(normalized.reservoirState).toEqual({ hasReservoirs: true, totalCount: 2, lowLevelCount: 0, criticalLevelCount: 0, currentLevel: 'low' });
    expect(normalized.infoContextState).toEqual({ lastShownType: 'day_progress', lastShownCategory: 'agenda', dismissedTodayCount: 0, hasSeenInfoToday: false });
    expect(JSON.stringify(normalized)).not.toContain('João');
    expect(JSON.stringify(normalized)).not.toContain('Maria');
    expect(JSON.stringify(normalized)).not.toContain('CPF');
  });

  test('unknown legacy aliases are ignored while canonical sequence signals remain consistent', () => {
    const withUnknownAliases = normalizeOperationalContext({
      testSequenceSignals: { hasCreatedLotProtocol: true, sawGeneratedActivities: true },
    });
    const withCanonicalSignals = normalizeOperationalContext({
      testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true },
    });

    expect(withUnknownAliases.testSequenceSignals.lotWithProtocolCreated).toBe(false);
    expect(withUnknownAliases.testSequenceSignals.generatedActivitiesSeen).toBe(false);
    expect(withCanonicalSignals.testSequenceSignals.lotWithProtocolCreated).toBe(true);
    expect(withCanonicalSignals.testSequenceSignals.generatedActivitiesSeen).toBe(true);
  });

  test('metrics include info card events in arrays and SQL list', () => {
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('info_card_shown');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('info_card_clicked');
    expect(getSupportedMetricEventsSqlList()).toContain("'info_card_shown'");
    expect(getSupportedMetricEventsSqlList()).toContain("'info_card_clicked'");
  });
});
