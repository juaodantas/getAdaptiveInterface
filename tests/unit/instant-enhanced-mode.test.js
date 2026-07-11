const { buildInstantPrompt } = require('../../src/instantPromptBuilder');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { deriveInstantSignals, resolveTestSequenceStep, TEST_SEQUENCE_STEPS } = require('../../src/instantDomainRules');
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
      type: 'field_notes_summary',
      source: 'isis',
      priority: 'high',
      title: 'Resumo do caderno',
      reason: 'Registros recentes.',
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
    expect(prompt).toContain('O primeiro shortcut PODE repetir o targetRoute');
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
    // Opção B: first shortcut pode repetir targetRoute
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
    // Opção B: first shortcut pode repetir targetRoute, demais precisam ser únicos
    const unique = [...new Set(routes)];
    expect(unique.length).toBeGreaterThanOrEqual(routes.length - 1);
  });

  test('metrics support legacy and enhanced event names', () => {
    expect(LEGACY_METRIC_EVENTS).toContain('session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('adaptive_session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('instant_adaptation_applied');
  });

  describe('Test sequence priority — Priority 0 in deriveInstantSignals', () => {
    function testContext(signals = {}, overrides = {}) {
      // lastRelevantEvent não-nulo indica experimento ativo para Priority 0
      const baseSignals = { ...signals };
      if (!baseSignals.lastRelevantEvent && !baseSignals.lotWithProtocolCreated && !baseSignals.generatedActivitiesSeen) {
        baseSignals.lastRelevantEvent = 'initial';
      }
      return normalizeOperationalContext({
        dashboardState: { hasActiveLots: false, hasProtocolLinkedToLatestLot: false },
        agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 },
        testSequenceSignals: baseSignals,
        ...overrides,
      });
    }

    test('step 1: no lotWithProtocolCreated → test_create_lot_with_protocol', () => {
      const ctx = testContext({ lotWithProtocolCreated: false });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_create_lot_with_protocol');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.focusMessage).toBe('Comece criando seu primeiro lote');
      expect(result.shortcuts.length).toBe(3);
    });

    test('step 2: lotWithProtocolCreated, agenda not seen → test_check_generated_activities', () => {
      const ctx = testContext({ lotWithProtocolCreated: true, generatedActivitiesSeen: false });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_check_generated_activities');
      expect(result.targetRoute).toBe('/agendaPage');
      expect(result.focusMessage).toBe('Confira a Agenda antes de seguir.');
    });

    test('step 3: activities seen, adjustment not recorded → test_record_adjustment', () => {
      const ctx = testContext({ lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_record_adjustment');
      expect(result.targetRoute).toBe('/cadernoCampoPage');
      expect(result.focusMessage).toBe('Caderno de campo - Registrar atividade');
    });

    test('step 4: adjustment recorded, agenda not completed → test_finish_agenda', () => {
      const ctx = testContext({
        lotWithProtocolCreated: true, generatedActivitiesSeen: true,
        adjustmentRecorded: true, agendaActivitiesCompleted: false,
      });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_finish_agenda');
      expect(result.targetRoute).toBe('/agendaPage');
      expect(result.focusMessage).toBe('Concluir na Agenda');
    });

    test('step 5: agenda completed, home not checked → test_review_final_home', () => {
      const ctx = testContext({
        lotWithProtocolCreated: true, generatedActivitiesSeen: true,
        adjustmentRecorded: true, agendaActivitiesCompleted: true,
        finalHomeChecked: false,
      });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_review_final_home');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.focusMessage).toBe('Revisar Agenda - lote segue em acompanhamento');
    });

    test('step 6: all done → test_complete', () => {
      const ctx = testContext({
        lotWithProtocolCreated: true, generatedActivitiesSeen: true,
        adjustmentRecorded: true, agendaActivitiesCompleted: true,
        finalHomeChecked: true,
      });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_complete');
      expect(result.targetRoute).toBe('/relatoriosPage');
    });

    test('test sequence overrides critical alerts during experiment', () => {
      const ctx = testContext({
        lotWithProtocolCreated: true, generatedActivitiesSeen: false,
        adjustmentRecorded: false, agendaActivitiesCompleted: false,
      }, { hasCriticalAlerts: true, criticalCount: 2 });
      const result = deriveInstantSignals(ctx);
      expect(result.stepId).toBe('test_check_generated_activities');
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
  });

  describe('Opção B — resolveRouteConflicts with test sequence', () => {
    test('first shortcut can repeat targetRoute in test step', () => {
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
      // Opção B: first shortcut repeats targetRoute, should survive
      expect(result.shortcuts.length).toBe(3);
      expect(result.shortcuts[0].route).toBe('/agendaPage');
      expect(result.shortcuts[0].route).toBe(result.nextStepRoute);
    });

    test('non-test step rejects duplicate first shortcut', () => {
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
      // Without Opção B, duplicate first shortcut would be resolved away
      expect(result.shortcuts[0].route).not.toBe(result.nextStepRoute);
    });
  });
});
