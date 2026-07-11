const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { parseGeminiJson, normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateRawInstantResponse, validateInstantResponse, finalizeValidInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
const { resolveRequestSessionId, sanitizeSessionNavigations } = require('../../src/sessionContext');
const { ENHANCED_INSTANT_METRIC_EVENTS, LEGACY_METRIC_EVENTS } = require('../../src/adaptiveMetrics');
const { buildCacheEntry, buildCacheLookup } = require('../../src/instantRecommendationCache');
const { resolveRouteConflicts } = require('../../src/instantInfoRecommendationBuilder');

function validContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 3 },
    ...overrides,
  });
}

function cadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2, nextActivity: { title: 'Registre no caderno', type: 'nutritional_adjustment', status: 'pending' } },
    ...overrides,
  });
}

function testContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 3 },
    testSequenceSignals: { experimentActive: true, lotWithProtocolCreated: true, generatedActivitiesSeen: false },
    ...overrides,
  });
}

function validCapabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner'],
    maxShortcuts: 3,
    maxSectionAdaptations: 4,
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
      description: 'Há atividades para registrar no caderno.',
      targetRoute: '/cadernoCampoPage',
      actionLabel: 'Abrir Caderno',
    },
    sectionAdaptations: [{
      sectionId: 'recommended_actions',
      component: 'NextStepCard',
      priority: 'high',
      treatment: 'prominent',
      title: 'Registre o ajuste no Caderno de Campo',
      description: 'Há atividades pendentes.',
    }],
    shortcuts: [
      { route: '/solucaoPage', confidence: 0.84, label: 'Ver Solução', reason: 'Solução.' },
      { route: '/agendaPage', confidence: 0.71, label: 'Ver Agenda', reason: 'Atividades.' },
    ],
    focus: { component: 'AdaptiveFocusBanner', message: 'Foco: Caderno.', targetSectionId: 'recommended_actions', priority: 'high' },
    uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
    reason: 'Contexto operacional.',
    reasonDetails: { summary: 'Contexto.', details: ['RULE-003'], display: 'info_icon' },
    rulesApplied: ['RULE-003'],
    infoRecommendation: {
      type: 'today_cultivation',
      source: 'isis',
      priority: 'high',
      title: 'Cultivo de hoje',
      reason: 'Há uma ação de cultivo para priorizar agora.',
      ctaRoute: '/relatoriosPage',
      category: 'caderno_campo',
    },
    ...overrides,
  };
}

function finalizedRecommendation(ctx = cadernoContext(), caps = validCapabilities()) {
  const signals = deriveInstantSignals(ctx);
  const normalized = normalizeInstantResponse(geminiResponse(), caps, signals, ctx);
  return finalizeValidInstantResponse(normalized, caps, signals);
}

function cacheEntryFor(ctx = cadernoContext(), caps = validCapabilities(), recommendation = finalizedRecommendation(ctx, caps), now = new Date()) {
  const signals = deriveInstantSignals(ctx);
  const lookup = buildCacheLookup({ operationalContext: ctx, signals, clientCapabilities: caps, navigationContext: { currentRoute: null, recentRoutes: [] } });
  return buildCacheEntry({ lookup, recommendation, now }).entry;
}

describe('Enhanced INSTANT mode contract', () => {
  test('resolves new session.sessionId before legacy sessionId', () => {
    expect(resolveRequestSessionId({ session: { sessionId: ' new ' }, sessionId: 'legacy' })).toBe('new');
    expect(resolveRequestSessionId({ sessionId: ' legacy ' })).toBe('legacy');
    expect(resolveRequestSessionId({ session: { sessionId: ' ' }, sessionId: '' })).toBeNull();
  });

  test('sanitizes session navigations without resourceName before prompt', () => {
    const sanitized = sanitizeSessionNavigations([
      { route: '/lotePage', resourceName: 'Lote do João', resourceId: '123', resourceType: 'lote', timestamp: 'João CPF 123' },
    ]);

    expect(sanitized).toEqual([{ route: '/lotePage', resourceType: 'lote' }]);
    expect(JSON.stringify(sanitized)).not.toContain('Lote do João');
    expect(JSON.stringify(sanitized)).not.toContain('resourceName');
    expect(JSON.stringify(sanitized)).not.toContain('CPF 123');
  });

  test('prompt contains nextStep, info, shortcuts schema and omits PII', () => {
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: sanitizeSessionNavigations([
        { route: '/agendaPage', timestamp: '2026-06-30T10:00:00Z Maria CPF 123' },
      ]),
      operationalContext: validContext(),
      clientCapabilities: validCapabilities(),
      signals: deriveInstantSignals(validContext()),
    });

    expect(prompt).toContain('nextStepPrediction');
    expect(prompt).toContain('infoRecommendation');
    expect(prompt).toContain('shortcuts');
    expect(prompt).toContain('shortcuts[0] é a ação principal (PODE ter a mesma rota');
    expect(prompt).toContain('Retorne infoRecommendation válido');
    expect(prompt).not.toContain('Maria');
    expect(prompt).not.toContain('CPF 123');
  });

  test('prompt contains rules, allowed routes, and no PII fields from navigation', () => {
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/homePage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: sanitizeSessionNavigations([{ route: '/lotePage', resourceName: 'Lote Identificável', resourceType: 'lote' }]),
      operationalContext: validContext(),
      clientCapabilities: validCapabilities(),
      signals: deriveInstantSignals(validContext()),
    });

    expect(prompt).toContain('RULE-001');
    expect(prompt).toContain('RULE-010');
    expect(prompt).toContain('/agendaPage');
    expect(prompt).toContain('nextStepPrediction');
    expect(prompt).toContain('Não retorne progress bar, stepper, checklist');
    expect(prompt).not.toContain('resourceName');
    expect(prompt).not.toContain('Lote Identificável');
  });

  test('prompt nulls infoRecommendation only for onboarding-capable create lot step', () => {
    const onboardingContext = normalizeOperationalContext({
      dashboardState: { hasActiveLots: false, hasProtocolLinkedToLatestLot: false },
      agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0 },
    });
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/homePage', recentRoutes: [] },
      sessionNavigations: [],
      operationalContext: onboardingContext,
      clientCapabilities: validCapabilities({
        supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'OperationalOnboardingCard'],
      }),
      signals: deriveInstantSignals(onboardingContext),
    });

    expect(prompt).toContain('stepContext.stepId === "create_lot_with_protocol" e OperationalOnboardingCard estiver suportado');
    expect(prompt).toContain('retorne infoRecommendation: null');
  });

  test('prompt removes PII and arbitrary strings from context', async () => {
    let capturedPrompt = '';

    await buildEnhancedInstantRecommendation({
      data: {
        navigationContext: {
          currentRoute: '/agendaPage?user=Maria',
          recentRoutes: ['/agendaPage', '/lotePage?name=Segredo'],
        },
        operationalContext: {
          agendaState: {
            nextActivity: { type: 'Tarefa do João CPF 123', status: 'livre Maria', dueLabel: 'Vence Maria' },
          },
          fieldNotebookState: { latestRecordType: 'Registro Maria' },
          alertState: { highestSeverity: 'Maria', types: ['Alerta João', 'critical'] },
        },
        clientCapabilities: validCapabilities(),
      },
      sessionNavigations: [{ route: '/agendaPage', resourceName: 'Lote do João', resourceType: 'lote' }],
      geminiApiKey: 'fake',
      geminiGenerateText: async ({ prompt }) => {
        capturedPrompt = prompt;
        return JSON.stringify(geminiResponse());
      },
    });

    expect(capturedPrompt).toContain('/agendaPage');
    expect(capturedPrompt).toContain('critical');
    expect(capturedPrompt).not.toContain('Maria');
    expect(capturedPrompt).not.toContain('João');
    expect(capturedPrompt).not.toContain('CPF');
    expect(capturedPrompt).not.toContain('resourceName');
  });

  test('fallback returns complete INSTANT contract with unique routes', () => {
    const response = buildEnhancedInstantFallback({ operationalContext: cadernoContext(), reason: 'test' });

    expect(response.mode).toBe('INSTANT');
    expect(response.visualPriority).toBe('moderate');
    expect(response.fallback).toEqual({ used: true, reason: 'test' });
    expect(response.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
    expect(response.sectionAdaptations[0].component).toBe('NextStepCard');
    expect(response.uiTreatment.showProgressBar).toBe(false);
    expect(response.shortcuts.length).toBeLessThanOrEqual(3);
    const routes = [response.nextStepPrediction.targetRoute, response.infoRecommendation.ctaRoute, ...response.shortcuts.map((s) => s.route)];
    // Todos os shortcuts DEVEM ter rotas diferentes
    const unique = [...new Set(routes)];
    expect(unique.length).toBeGreaterThanOrEqual(routes.length - 1);
  });

  test('raw validator rejects progress bars and excessive arrays', () => {
    const parsed = parseGeminiJson(JSON.stringify(geminiResponse({
      uiTreatment: { showProgressBar: true },
      shortcuts: [
        { route: '/agendaPage', confidence: 0.84, label: 'A', reason: 'R' },
        { route: '/lotePage', confidence: 0.7, label: 'B', reason: 'R' },
        { route: '/solucaoPage', confidence: 0.7, label: 'C', reason: 'R' },
        { route: '/relatoriosPage', confidence: 0.7, label: 'D', reason: 'R' },
      ],
    })));
    const validation = validateRawInstantResponse(parsed, validCapabilities({ maxShortcuts: 3 }));

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('progress_bar_requested');
    expect(validation.errors).toContain('too_many_shortcuts');
  });

  test('raw validator rejects forbidden UI equivalents in text', () => {
    const validation = validateRawInstantResponse(geminiResponse({
      reasonDetails: { summary: 'usar checklist operacional', details: ['stepper'], display: 'info_icon' },
    }), validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('forbidden_ui_equivalent_requested');
  });

  test('raw validator rejects unsupported focus component', () => {
    const parsed = parseGeminiJson(JSON.stringify(geminiResponse({
      focus: { component: 'UnsupportedBanner', message: 'Foco', targetSectionId: 'recommended_actions', priority: 'high' },
    })));
    const validation = validateRawInstantResponse(parsed, validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('unsupported_focus_component');
  });

  test('Gemini response with test step id falls back deterministically', async () => {
    const signals = deriveInstantSignals(cadernoContext());
    const normalized = normalizeInstantResponse(geminiResponse({
      nextStepPrediction: { ...geminiResponse().nextStepPrediction, stepId: 'test_check_generated_activities' },
    }), validCapabilities(), signals, cadernoContext());

    expect(validateInstantResponse(normalized, validCapabilities())).toEqual({
      valid: false,
      errors: ['invalid_test_step_id'],
    });

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: cadernoContext(), clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse({
        nextStepPrediction: { ...geminiResponse().nextStepPrediction, stepId: 'test_check_generated_activities' },
      })),
    });

    expect(response.fallback.used).toBe(true);
    expect(response.fallback.reason).toContain('invalid_test_step_id');
    expect(response.nextStepPrediction.stepId).not.toMatch(/^test_/);
  });

  test('valid Gemini response becomes adaptive with unique routes', async () => {
    const ctx = cadernoContext();
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse()),
    });

    expect(response.mode).toBe('INSTANT');
    expect(response.source).toBe('adaptive');
    expect(response.visualPriority).toBe('moderate');
    expect(response.fallback.used).toBe(false);
    const routes = [response.nextStepPrediction.targetRoute, response.infoRecommendation.ctaRoute, ...response.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
    expect(response.shortcuts.length).toBeLessThanOrEqual(3);
  });

  test('cache hit returns cached recommendation without calling Gemini or adding public metadata', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    const geminiGenerateText = jest.fn();
    const events = [];
    const cache = {
      get: jest.fn(async () => ({ ok: true, entry })),
      markHit: jest.fn(async () => ({ ok: true })),
      set: jest.fn(),
    };

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: cache,
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response).toEqual(entry.recommendation);
    expect(response.cache).toBeUndefined();
    expect(geminiGenerateText).not.toHaveBeenCalled();
    expect(cache.markHit).toHaveBeenCalledWith(entry.cacheKey);
    expect(events.map((event) => event.event)).toEqual(['instant_cache_hit', 'instant_gemini_saved_by_cache']);
    expect(JSON.stringify(events)).not.toContain('userId');
    expect(JSON.stringify(events)).not.toContain('sessionId');
  });

  test('cache hit strips extra top-level public metadata from cached recommendation', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      cache: { hit: true },
      cachedAt: '2026-07-10T00:00:00Z',
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(async () => ({ ok: true })),
      },
    });

    expect(response.cache).toBeUndefined();
    expect(response.cachedAt).toBeUndefined();
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  test('cache hit strips nested metadata from cached recommendation', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      nextStepPrediction: {
        ...entry.recommendation.nextStepPrediction,
        userId: 'user-secret',
        cachedAt: '2026-07-10T00:00:00Z',
      },
      shortcuts: entry.recommendation.shortcuts.map((shortcut, index) => index === 0
        ? { ...shortcut, cache: { hit: true }, resourceName: 'Lote secreto' }
        : shortcut),
      infoRecommendation: {
        ...entry.recommendation.infoRecommendation,
        internalMetadata: { userId: 'user-secret' },
      },
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(async () => ({ ok: true })),
      },
    });

    expect(response.nextStepPrediction.userId).toBeUndefined();
    expect(response.nextStepPrediction.cachedAt).toBeUndefined();
    expect(response.shortcuts[0].cache).toBeUndefined();
    expect(response.shortcuts[0].resourceName).toBeUndefined();
    expect(response.infoRecommendation.internalMetadata).toBeUndefined();
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  test('cache miss calls Gemini and writes final validated recommendation', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const events = [];
    const cache = {
      get: jest.fn(async () => ({ ok: true, entry: null })),
      set: jest.fn(async () => ({ ok: true })),
    };

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse()),
      instantRecommendationCache: cache,
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0][0].recommendation).toEqual(response);
    expect(events.map((event) => event.event)).toEqual(['instant_cache_miss', 'instant_cache_write_success']);
  });

  test('stale cache entry is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps, finalizedRecommendation(ctx, caps), new Date('2020-01-01T00:00:00Z'));
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        set: jest.fn(async () => ({ ok: true })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.event)).toContain('instant_cache_stale');
  });

  test('invalid cached recommendation is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      nextStepPrediction: {
        ...entry.recommendation.nextStepPrediction,
        targetRoute: '/adminSecretPage',
      },
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(),
        set: jest.fn(async () => ({ ok: true })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.nextStepPrediction.targetRoute).not.toBe('/adminSecretPage');
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ event: 'instant_cache_miss', cachePolicyReason: 'invalid_entry' }));
    expect(events.map((event) => event.event)).not.toContain('instant_cache_hit');
  });

  test('cached recommendation with test step id is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      nextStepPrediction: {
        ...entry.recommendation.nextStepPrediction,
        stepId: 'test_check_generated_activities',
      },
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(),
        set: jest.fn(async () => ({ ok: true })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.nextStepPrediction.stepId).not.toMatch(/^test_/);
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ event: 'instant_cache_miss', cachePolicyReason: 'invalid_entry' }));
    expect(events.map((event) => event.event)).not.toContain('instant_cache_hit');
  });

  test('cached recommendation with invalid nested scalar is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      nextStepPrediction: {
        ...entry.recommendation.nextStepPrediction,
        confidence: 'bad',
      },
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(),
        set: jest.fn(async () => ({ ok: true })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(response.nextStepPrediction.confidence).not.toBe('bad');
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ event: 'instant_cache_miss', cachePolicyReason: 'invalid_entry' }));
    expect(events.map((event) => event.event)).not.toContain('instant_cache_hit');
  });

  test('cached recommendation missing final contract fields is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    delete entry.recommendation.mode;
    delete entry.recommendation.visualPriority;
    expect(validateInstantResponse(entry.recommendation, caps).valid).toBe(true);
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(),
        set: jest.fn(async () => ({ ok: true })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.mode).toBe('INSTANT');
    expect(response.visualPriority).toBe('moderate');
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ event: 'instant_cache_miss', cachePolicyReason: 'invalid_entry' }));
    expect(events.map((event) => event.event)).not.toContain('instant_cache_hit');
  });

  test('fallback cached recommendation is not used and falls through to Gemini', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    entry.recommendation = {
      ...entry.recommendation,
      fallback: { used: true, reason: 'gemini_error' },
    };
    const geminiGenerateText = jest.fn(async () => JSON.stringify(geminiResponse()));
    const markHit = jest.fn();

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit,
        set: jest.fn(async () => ({ ok: true })),
      },
    });

    expect(response.fallback.used).toBe(false);
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(markHit).not.toHaveBeenCalled();
  });

  test('read error and write error are observable but do not block response', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const events = [];

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse()),
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: false, error: new Error('read') })),
        set: jest.fn(async () => ({ ok: false, error: new Error('write') })),
      },
      cacheEventReporter: (event) => events.push(event),
    });

    expect(response.fallback.used).toBe(false);
    expect(events.map((event) => event.event)).toEqual(['instant_cache_read_error', 'instant_cache_write_error']);
  });

  test('Gemini fallback is not written to cache', async () => {
    const cache = {
      get: jest.fn(async () => ({ ok: true, entry: null })),
      set: jest.fn(),
    };

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: cadernoContext(), clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => 'not json',
      instantRecommendationCache: cache,
    });

    expect(response.fallback.used).toBe(true);
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('markHit failure does not invalidate a cache hit', async () => {
    const ctx = cadernoContext();
    const caps = validCapabilities();
    const entry = cacheEntryFor(ctx, caps);
    const geminiGenerateText = jest.fn();

    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: caps },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText,
      instantRecommendationCache: {
        get: jest.fn(async () => ({ ok: true, entry })),
        markHit: jest.fn(async () => { throw new Error('race'); }),
      },
    });

    expect(response).toEqual(entry.recommendation);
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  test('invalid Gemini JSON falls back deterministically', async () => {
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: validContext(), clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => 'not json',
    });

    expect(response.fallback.used).toBe(true);
    expect(response.source).toBe('fallback');
    expect(response.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
  });

  test('finalizer applies conflict resolution and marks non-fallback', () => {
    const signals = deriveInstantSignals(cadernoContext());
    const normalized = normalizeInstantResponse(geminiResponse(), validCapabilities(), signals, cadernoContext());
    const finalized = finalizeValidInstantResponse(normalized, validCapabilities(), signals);

    expect(finalized.visualPriority).toBe('moderate');
    expect(finalized.fallback.used).toBe(false);
    expect(finalized.rulesApplied).toContain('RULE-010');
    const routes = [finalized.nextStepPrediction.targetRoute, finalized.infoRecommendation.ctaRoute, ...finalized.shortcuts.map((s) => s.route)];
    // Todos os shortcuts DEVEM ter rotas diferentes
    const unique = [...new Set(routes)];
    expect(unique.length).toBeGreaterThanOrEqual(routes.length - 1);
  });

  test('metrics support legacy and enhanced event names', () => {
    expect(LEGACY_METRIC_EVENTS).toContain('session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('adaptive_session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('instant_adaptation_applied');
  });

  describe('Legacy testSequenceSignals compatibility', () => {
    function legacyContext(signals = {}, overrides = {}) {
      return normalizeOperationalContext({
        dashboardState: { hasActiveLots: false, hasProtocolLinkedToLatestLot: false },
        agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 },
        testSequenceSignals: { lastRelevantEvent: 'initial', ...signals },
        ...overrides,
      });
    }

    test('legacy testSequenceSignals do not produce test step ids', () => {
      const ctx = legacyContext({ lotWithProtocolCreated: false });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('create_lot_with_protocol');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.stepId).not.toMatch(/^test_/);
      expect(result.shortcuts.length).toBe(3);
    });

    test('generated activities seen without adjustment maps to caderno business step', () => {
      const ctx = legacyContext(
        { lotWithProtocolCreated: false, generatedActivitiesSeen: false },
        {
          dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
          agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 },
          fieldNotebookState: { hasRecentFieldNotes: false, hasRecentNutritionAdjustmentRecord: false },
        },
      );
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('record_caderno_adjustment');
      expect(result.targetRoute).toBe('/cadernoCampoPage');
      expect(result.stepId).not.toMatch(/^test_/);
    });

    test('completed agenda state maps to review_final_home without terminal test step', () => {
      const ctx = legacyContext(
        { finalHomeChecked: true },
        {
          dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
          agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 0, completedActivitiesTodayCount: 2, lastInteractionType: 'completed' },
          fieldNotebookState: { hasRecentNutritionAdjustmentRecord: true },
        },
      );
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('review_final_home');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.stepId).not.toMatch(/^test_/);
    });

    test('critical alerts remain above legacy testSequenceSignals', () => {
      const ctx = legacyContext(
        { lotWithProtocolCreated: true, generatedActivitiesSeen: false },
        { alertState: { hasCriticalAlerts: true, criticalCount: 2 } },
      );
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('review_critical_alerts');
      expect(result.targetRoute).toBe('/agendaPage');
    });

    test('without testSequenceSignals, normal operational rules apply', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: false },
        agendaState: { pendingActivitiesTodayCount: 0 },
      });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).not.toMatch(/^test_/);
    });

    test('without lot, onboarding beats reservoir infrastructure context', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: {
          hasActiveLots: false,
          hasProtocolLinkedToLatestLot: false,
          hasUpcomingHarvests: false,
        },
        agendaState: {
          hasGeneratedActivities: false,
          pendingToday: 0,
          overdueCount: 0,
          hasOverdue: false,
          hasProtocolTasks: false,
        },
        fieldNotebookState: {
          hasRecentNotes: false,
          hasNutritionAdjustmentRecord: false,
          totalRecentNotes: 0,
          hasSowingNote: false,
        },
        productionState: { hasProductionData: false },
        cultivationState: { culturesCount: 0, speciesInProgressCount: 0 },
        reservoirState: {
          hasReservoirs: true,
          withSolutionCount: 2,
          withoutSolutionCount: 0,
          lowLevelCount: 0,
          criticalLevelCount: 0,
          currentLevel: 'unknown',
        },
        teamState: { activeMembers: 1, onTimeActivities: 0, overdueActivities: 0 },
        alertState: { hasCriticalAlerts: false, criticalCount: 0 },
      });

      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('create_lot_with_protocol');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.rulesApplied).toContain('RULE-001');
      expect(result.rulesApplied).not.toContain('RULE-013');
    });

    test('natural flow step 1 matches initial home expectations', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: false, hasProtocolLinkedToLatestLot: false },
        agendaState: { hasGeneratedActivities: false, pendingToday: 0 },
      });

      const result = deriveInstantSignals(ctx);
      expect(result).toMatchObject({
        stepId: 'create_lot_with_protocol',
        targetRoute: '/lotePage',
        focusMessage: 'Comece criando seu primeiro lote',
      });
      expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/lotePage', '/protocoloPage', '/areaCultivoPage']);
    });

    test('natural flow step 2 uses recent lot creation to recommend agenda', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
        agendaState: { hasGeneratedActivities: true, pendingToday: 0 },
        recentUserActions: [{ entityType: 'lot', action: 'created', timestamp: '2026-07-10T15:10:00.000Z' }],
      });

      const result = deriveInstantSignals(ctx);
      expect(result).toMatchObject({
        stepId: 'check_generated_activities',
        targetRoute: '/agendaPage',
        focusMessage: 'Confira a Agenda antes de seguir.',
      });
      expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/agendaPage', '/lotePage', '/cadernoCampoPage']);
    });

    test('natural flow step 3 uses recent agenda check to recommend caderno', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
        agendaState: { hasGeneratedActivities: true, pendingToday: 2 },
        fieldNotebookState: { hasNutritionAdjustmentRecord: false },
        recentUserActions: [{ entityType: 'agenda_activity', action: 'viewed', timestamp: '2026-07-10T15:13:59.000Z' }],
      });

      const result = deriveInstantSignals(ctx);
      expect(result).toMatchObject({
        stepId: 'record_caderno_adjustment',
        targetRoute: '/cadernoCampoPage',
        focusMessage: 'Caderno de campo - Registrar atividade',
      });
      expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/cadernoCampoPage', '/agendaPage', '/lotePage']);
    });

    test('natural flow step 4 uses recent field record to recommend finishing agenda', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
        agendaState: { hasGeneratedActivities: true, pendingToday: 2 },
        fieldNotebookState: { hasNutritionAdjustmentRecord: true },
        recentUserActions: [{ entityType: 'field_note', action: 'created', timestamp: '2026-07-10T15:13:59.000Z' }],
      });

      const result = deriveInstantSignals(ctx);
      expect(result).toMatchObject({
        stepId: 'finish_agenda_activities',
        targetRoute: '/agendaPage',
        focusMessage: 'Concluir na Agenda',
      });
      expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/agendaPage', '/cadernoCampoPage', '/lotePage']);
    });

    test('natural flow step 5 uses recent agenda completion to recommend lot review', () => {
      const ctx = normalizeOperationalContext({
        dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
        agendaState: { hasGeneratedActivities: true, pendingToday: 0, lastAgendaInteraction: 'completed' },
        fieldNotebookState: { hasNutritionAdjustmentRecord: true },
        recentUserActions: [{ entityType: 'agenda_activity', action: 'completed', timestamp: '2026-07-10T15:13:59.000Z' }],
      });

      const result = deriveInstantSignals(ctx);
      expect(result).toMatchObject({
        stepId: 'review_final_home',
        targetRoute: '/lotePage',
        focusMessage: 'Revisar Agenda - lote segue em acompanhamento',
      });
      expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/lotePage', '/cadernoCampoPage', '/agendaPage']);
    });
  });

  describe('resolveRouteConflicts', () => {
    test('unknown legacy test step is not specially resolved', () => {
      const result = resolveRouteConflicts(
        'test_check_generated_activities',
        '/agendaPage',
        '/reservatoriosPage', // ctaRoute diferente de targetRoute e shortcuts
        [
          { route: '/agendaPage', label: 'Ver Agenda', group: 'primary', confidence: 0.8 },
          { route: '/cadernoCampoPage', label: 'Caderno', group: 'secondary', confidence: 0.6 },
          { route: '/lotePage', label: 'Lote', group: 'contextual', confidence: 0.5 },
        ],
      );
      expect(result.shortcuts.length).toBe(3);
      expect(result.shortcuts[0].route).toBe('/agendaPage');
      expect(result.shortcuts[0].route).toBe(result.nextStepRoute);
    });

    test('first shortcut repeats targetRoute by design (Opção E — frontend deduplica)', () => {
      const result = resolveRouteConflicts(
        'check_generated_activities',
        '/agendaPage',
        '/relatoriosPage',
        [
          { route: '/agendaPage', label: 'Agenda', group: 'primary', confidence: 0.8 },
          { route: '/lotePage', label: 'Lote', group: 'secondary', confidence: 0.6 },
        ],
      );
      expect(result.shortcuts.length).toBe(2);
      // Opção E: shortcut[0] NÃO é remapeado — pode repetir targetRoute
      expect(result.shortcuts[0].route).toBe(result.nextStepRoute);
    });
  });
});
