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

function validContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 3 },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: false },
    ...overrides,
  });
}

function cadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2, nextActivity: { title: 'Registre no caderno', type: 'nutritional_adjustment', status: 'pending' } },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false },
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
    expect(prompt).toContain('ctaRoute deve ser DIFERENTE');
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
    expect(new Set(routes).size).toBe(routes.length);
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
    expect(new Set(routes).size).toBe(routes.length);
  });

  test('metrics support legacy and enhanced event names', () => {
    expect(LEGACY_METRIC_EVENTS).toContain('session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('adaptive_session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('instant_adaptation_applied');
  });
});
