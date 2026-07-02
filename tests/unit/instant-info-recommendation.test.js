const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateInstantResponse, validateRawInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
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
