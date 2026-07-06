const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateInstantResponse, validateRawInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
const { ENHANCED_INSTANT_METRIC_EVENTS, getSupportedMetricEventsSqlList } = require('../../src/adaptiveMetrics');
const { buildDeduplicatedCtaRoute, deduplicateShortcutRoutes, ALTERNATIVE_CTA_BY_TARGET } = require('../../src/instantInfoRecommendationBuilder');
const { finalizeValidInstantResponse } = require('../../src/instantResponseValidator');
const { ALLOWED_INFO_CTA_ROUTES } = require('../../src/adaptiveContract');

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

function geminiResponse(overrides = {}) {
  return {
    responseVersion: '1.0',
    dashboard: 'Tarefas Pendentes',
    dashboardId: 'TAREFAS_PENDENTES',
    cardType: 'tarefas',
    confidence: 0.84,
    nextStepPrediction: {
      stepId: 'check_generated_agenda_activities',
      confidence: 0.84,
      title: 'Verifique as atividades geradas na Agenda',
      description: 'Há atividades geradas para conferir.',
      targetRoute: '/agendaPage',
      actionLabel: 'Abrir Agenda',
    },
    sectionAdaptations: [{
      sectionId: 'recommended_actions',
      component: 'NextStepCard',
      priority: 'high',
      treatment: 'prominent',
      title: 'Verifique as atividades geradas na Agenda',
      description: 'Há atividades pendentes para conferir.',
    }],
    shortcuts: [{ route: '/agendaPage', confidence: 0.84, label: 'Abrir Agenda', reason: 'Atividades pendentes.' }],
    focus: { component: 'AdaptiveFocusBanner', message: 'Próximo foco: Agenda.', targetSectionId: 'recommended_actions', priority: 'high' },
    uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
    reason: 'Contexto operacional indica Agenda.',
    reasonDetails: { summary: 'Contexto operacional indica Agenda.', details: ['RULE-002'], display: 'info_icon' },
    rulesApplied: ['RULE-002'],
    infoRecommendation: {
      type: 'day_progress',
      source: 'isis',
      priority: 'high',
      title: 'Resumo do dia',
      reason: 'Há atividades do dia para acompanhar.',
      ctaRoute: '/agendaPage',
      category: 'agenda',
    },
    ...overrides,
  };
}

describe('INSTANT infoRecommendation', () => {
  test('prompt contains mandatory infoRecommendation schema and omits unsupported PII fields', () => {
    const operationalContext = normalizeOperationalContext({
      generatedAt: '2026-07-02T10:00:00Z Maria CPF 123',
      fieldNotebookState: { latestRecordType: 'Nota do João', uncheckedNotesCount: 3 },
    });
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: [],
      operationalContext,
      clientCapabilities: capabilities({ supportedInfoTypes: ['day_progress', 'unknown'] }),
      signals: deriveInstantSignals(context()),
    });

    expect(prompt).toContain('infoRecommendation');
    expect(prompt).toContain('supportedInfoTypes');
    expect(prompt).toContain('/cadernoCampoPage');
    expect(prompt).toContain('today_cultivation|reservoir_report|day_progress|field_notes_summary|basic_tip');
    expect(prompt).not.toContain('Maria');
    expect(prompt).not.toContain('João');
    expect(prompt).not.toContain('CPF 123');
  });

  test('raw validator accepts valid day_progress infoRecommendation without treating it as forbidden UI', () => {
    const validation = validateRawInstantResponse(geminiResponse(), capabilities());

    expect(validation.valid).toBe(true);
    expect(validation.errors).not.toContain('forbidden_ui_equivalent_requested');
  });

  test('normalizer preserves valid infoRecommendation enums and uses local safe copy', () => {
    const normalized = normalizeInstantResponse(geminiResponse({
      infoRecommendation: {
        ...geminiResponse().infoRecommendation,
        title: 'João CPF 123.456.789-00 precisa revisar o lote Alfa',
        reason: 'Enviar para maria@example.com porque resourceName expôs detalhes',
      },
    }), capabilities(), deriveInstantSignals(context()));

    expect(normalized.infoRecommendation).toEqual(geminiResponse().infoRecommendation);
    expect(normalized.infoRecommendation.title).toBe('Resumo do dia');
    expect(normalized.infoRecommendation.reason).toBe('Há atividades do dia para acompanhar.');
    expect(normalized.reasonDetails.summary).toBe('Contexto operacional indica Agenda.');
  });

  test('normalizer replaces absent or invalid infoRecommendation with deterministic fallback', () => {
    const normalized = normalizeInstantResponse(geminiResponse({
      infoRecommendation: { ...geminiResponse().infoRecommendation, type: 'unsafe_type' },
    }), capabilities(), deriveInstantSignals(context()));

    expect(normalized.infoRecommendation.type).toBe('day_progress');
    expect(normalized.infoRecommendation.ctaRoute).toBe('/agendaPage');
  });

  test('validator rejects invalid final info type and CTA route', () => {
    const invalidType = normalizeInstantResponse(geminiResponse(), capabilities(), deriveInstantSignals(context()));
    invalidType.infoRecommendation.type = 'unsafe_type';

    const invalidRoute = normalizeInstantResponse(geminiResponse(), capabilities(), deriveInstantSignals(context()));
    invalidRoute.infoRecommendation.ctaRoute = '/loginPage';

    const unsafeText = normalizeInstantResponse(geminiResponse(), capabilities(), deriveInstantSignals(context()));
    unsafeText.infoRecommendation.title = 'CPF 123.456.789-00';

    expect(validateInstantResponse(invalidType, capabilities()).errors).toContain('invalid_info_type');
    expect(validateInstantResponse(invalidRoute, capabilities()).errors).toContain('invalid_info_cta_route');
    expect(validateInstantResponse(unsafeText, capabilities()).errors).toContain('invalid_info_title');
  });

  test('fallback and final enhanced response always include supported infoRecommendation', async () => {
    const limitedCapabilities = capabilities({ supportedInfoTypes: ['basic_tip'] });
    const fallback = buildEnhancedInstantFallback({ operationalContext: context(), clientCapabilities: limitedCapabilities });
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: context(), clientCapabilities: limitedCapabilities },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse({ infoRecommendation: undefined })),
    });

    expect(fallback.infoRecommendation.type).toBe('basic_tip');
    expect(response.infoRecommendation.type).toBe('basic_tip');
    expect(response.mode).toBe('INSTANT');
    expect(response.fallback.used).toBe(false);
  });

  test('valid Gemini day_progress infoRecommendation does not fall back to generic basic tip', async () => {
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: context(), clientCapabilities: capabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse()),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.infoRecommendation.type).toBe('day_progress');
    expect(response.infoRecommendation.category).toBe('agenda');
    expect(response.infoRecommendation.title).toBe('Resumo do dia');
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

describe('route deduplication helpers', () => {
  // ---------------------------------------------------------------------------
  // ALTERNATIVE_CTA_BY_TARGET
  // ---------------------------------------------------------------------------

  test('ALTERNATIVE_CTA_BY_TARGET covers all targetRoutes from domain rules', () => {
    const distinctTargetRoutes = [
      '/protocoloPage',
      '/agendaPage',
      '/cadernoCampoPage',
      '/relatoriosPage',
    ];
    for (const route of distinctTargetRoutes) {
      expect(ALTERNATIVE_CTA_BY_TARGET).toHaveProperty(route);
    }
  });

  test('all alternative routes are in ALLOWED_INFO_CTA_ROUTES', () => {
    const values = Object.values(ALTERNATIVE_CTA_BY_TARGET);
    for (const value of values) {
      expect(ALLOWED_INFO_CTA_ROUTES).toContain(value);
    }
  });

  test('ALTERNATIVE_CTA_BY_TARGET has bijective pairs for core routes', () => {
    // Core route pairs are bidirectional (A↔B):
    //   /agendaPage ↔ /relatoriosPage
    //   /lotePage ↔ /areaCultivoPage
    //   /solucaoPage ↔ /reservatoriosPage
    const bijectivePairs = [
      ['/agendaPage', '/relatoriosPage'],
      ['/lotePage', '/areaCultivoPage'],
      ['/solucaoPage', '/reservatoriosPage'],
    ];
    for (const [a, b] of bijectivePairs) {
      expect(ALTERNATIVE_CTA_BY_TARGET[a]).toBe(b);
      expect(ALTERNATIVE_CTA_BY_TARGET[b]).toBe(a);
    }
  });

  // ---------------------------------------------------------------------------
  // buildDeduplicatedCtaRoute
  // ---------------------------------------------------------------------------

  test('returns alternative route when primary is mapped — /protocoloPage → /lotePage', () => {
    expect(buildDeduplicatedCtaRoute('/protocoloPage', ALLOWED_INFO_CTA_ROUTES)).toBe('/lotePage');
  });

  test('returns alternative route for agenda — /agendaPage → /relatoriosPage', () => {
    expect(buildDeduplicatedCtaRoute('/agendaPage', ALLOWED_INFO_CTA_ROUTES)).toBe('/relatoriosPage');
  });

  test('returns primary when route is not in map', () => {
    expect(buildDeduplicatedCtaRoute('/unknownPage', ALLOWED_INFO_CTA_ROUTES)).toBe('/unknownPage');
  });

  test('returns primary when alternative is not in allowedRoutes', () => {
    // /agendaPage maps to /relatoriosPage, but /relatoriosPage is NOT in the
    // restricted allowlist below, so the function falls back to the primary.
    expect(buildDeduplicatedCtaRoute('/agendaPage', ['/lotePage'])).toBe('/agendaPage');
  });

  test('returns primary when primaryRoute is empty string', () => {
    expect(buildDeduplicatedCtaRoute('', ALLOWED_INFO_CTA_ROUTES)).toBe('');
  });

  test('returns primary when primaryRoute is not a string', () => {
    expect(buildDeduplicatedCtaRoute(null, ALLOWED_INFO_CTA_ROUTES)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // deduplicateShortcutRoutes
  // ---------------------------------------------------------------------------

  test('removes duplicate routes keeping first occurrence', () => {
    const result = deduplicateShortcutRoutes([
      { route: '/a' },
      { route: '/a' },
      { route: '/b' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].route).toBe('/a');
    expect(result[1].route).toBe('/b');
  });

  test('removes duplicate after swapping primary route', () => {
    const result = deduplicateShortcutRoutes(
      [
        { route: '/agendaPage', group: 'primary' },
        { route: '/relatoriosPage', group: 'secondary' },
      ],
      '/agendaPage',
    );
    // The primary shortcut's route collides with primaryRoute so it is swapped
    // to the alternative; the swap may create a temporary duplicate that gets
    // deduped away in the final pass, so the result must not contain duplicates.
    const primary = result.find((s) => s.group === 'primary');
    expect(primary).toBeDefined();
    expect(primary.route).not.toBe('/agendaPage');
    const routes = result.map((s) => s.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('preserves all original fields except route when swapping primary', () => {
    const result = deduplicateShortcutRoutes(
      [
        { route: '/agendaPage', group: 'primary', label: 'Agenda', description: 'Ver agenda', customField: 'keep' },
        { route: '/relatoriosPage', group: 'secondary', label: 'Relatórios' },
      ],
      '/agendaPage',
    );
    const primary = result.find((s) => s.group === 'primary');
    expect(primary).toBeDefined();
    expect(primary.route).toBe('/relatoriosPage');
    expect(primary.label).toBe('Agenda');
    expect(primary.description).toBe('Ver agenda');
    expect(primary.customField).toBe('keep');
  });

  test('uses group property to find primary (not index 0)', () => {
    // Primary is at index 1 because group === 'primary', not at index 0
    const result = deduplicateShortcutRoutes(
      [
        { route: '/a', group: 'secondary' },
        { route: '/b', group: 'primary' },
      ],
      '/b',
    );
    // The primary's route '/b' collided with primaryRoute, so it was swapped
    // to '/a', creating a duplicate that was deduped away.
    const routes = result.map((s) => s.route);
    expect(routes).not.toContain('/b');
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('returns empty array for empty input', () => {
    expect(deduplicateShortcutRoutes([])).toEqual([]);
  });

  test('returns input as-is for non-array', () => {
    expect(deduplicateShortcutRoutes(null)).toBeNull();
    expect(deduplicateShortcutRoutes(undefined)).toBeUndefined();
  });

  test('handles shortcuts without route string', () => {
    const result = deduplicateShortcutRoutes([
      { route: '/a' },
      { route: null },
      {},
      { route: 123 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].route).toBe('/a');
  });

  // ---------------------------------------------------------------------------
  // Integration: finalizeValidInstantResponse
  // ---------------------------------------------------------------------------

  test('finalizeValidInstantResponse applies route deduplication', () => {
    const response = geminiResponse();
    const clientCapabilities = capabilities();
    const signals = { rulesApplied: ['RULE-002'] };

    const result = finalizeValidInstantResponse(response, clientCapabilities, signals);

    // nextStepPrediction.targetRoute is '/agendaPage' and infoRecommendation.ctaRoute
    // was also '/agendaPage'. buildDeduplicatedCtaRoute maps /agendaPage → /relatoriosPage
    // which is in ALLOWED_INFO_CTA_ROUTES, so ctaRoute should change.
    expect(result.infoRecommendation.ctaRoute).toBe('/relatoriosPage');
  });
});
