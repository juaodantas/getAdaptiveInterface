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

function validCapabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner'],
    maxShortcuts: 4,
    maxSectionAdaptations: 4,
    ...overrides,
  });
}

function validGeminiResponse(overrides = {}) {
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
      description: 'Há atividades geradas pelo protocolo do lote.',
      targetRoute: '/agendaPage',
      actionLabel: 'Abrir Agenda',
    },
    sectionAdaptations: [{
      sectionId: 'recommended_actions',
      component: 'NextStepCard',
      priority: 'high',
      treatment: 'prominent',
      title: 'Verifique as atividades geradas na Agenda',
      description: 'Há atividades pendentes criadas pelo protocolo do lote.',
    }],
    shortcuts: [{ route: '/agendaPage', confidence: 0.84, label: 'Abrir Agenda', reason: 'Atividades pendentes.' }],
    focus: { component: 'AdaptiveFocusBanner', message: 'Próximo foco: Agenda.', targetSectionId: 'recommended_actions', priority: 'high' },
    uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
    reason: 'Contexto operacional indica Agenda.',
    reasonDetails: { summary: 'Contexto operacional indica Agenda.', details: ['lotWithProtocolCreated=true'], display: 'info_icon' },
    rulesApplied: ['RULE-002'],
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
    expect(JSON.stringify(sanitized)).not.toContain('timestamp');
    expect(JSON.stringify(sanitized)).not.toContain('CPF 123');
  });

  test('prompt omits session navigation timestamp with PII', () => {
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: sanitizeSessionNavigations([
        { route: '/agendaPage', timestamp: '2026-06-30T10:00:00Z Maria CPF 123' },
      ]),
      operationalContext: validContext(),
      clientCapabilities: validCapabilities(),
      signals: deriveInstantSignals(validContext()),
    });

    expect(prompt).toContain('/agendaPage');
    expect(prompt).not.toContain('timestamp');
    expect(prompt).not.toContain('Maria');
    expect(prompt).not.toContain('CPF 123');
  });

  test('prompt contains rules, allowed routes, schema, and no PII fields from navigation', () => {
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

  test('prompt removes generatedAt and resourceType PII when values are not allowlisted', () => {
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/agendaPage', recentRoutes: ['/agendaPage'] },
      sessionNavigations: sanitizeSessionNavigations([
        { route: '/lotePage', resourceType: 'cpf-123-Maria', resourceName: 'Lote da Maria' },
      ]),
      operationalContext: normalizeOperationalContext({ generatedAt: '2026-06-30T10:00:00Z CPF 123 Maria' }),
      clientCapabilities: validCapabilities(),
      signals: deriveInstantSignals(validContext()),
    });

    expect(prompt).toContain('/lotePage');
    expect(prompt).toContain('"generatedAt":null');
    expect(prompt).not.toContain('cpf-123-Maria');
    expect(prompt).not.toContain('Lote da Maria');
    expect(prompt).not.toContain('CPF 123 Maria');
    expect(prompt).not.toContain('Maria');
  });

  test('prompt keeps valid ISO generatedAt and allowlisted resourceType', () => {
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/lotePage', recentRoutes: ['/lotePage'] },
      sessionNavigations: sanitizeSessionNavigations([{ route: '/lotePage', resourceType: 'lote' }]),
      operationalContext: normalizeOperationalContext({ generatedAt: '2026-06-30T10:00:00Z' }),
      clientCapabilities: validCapabilities(),
      signals: deriveInstantSignals(validContext()),
    });

    expect(prompt).toContain('"generatedAt":"2026-06-30T10:00:00.000Z"');
    expect(prompt).toContain('"resourceType":"lote"');
  });

  test('prompt removes PII and arbitrary strings from navigation and operational context', async () => {
    let capturedPrompt = '';

    await buildEnhancedInstantRecommendation({
      data: {
        navigationContext: {
          currentRoute: '/agendaPage?user=Maria',
          previousRoute: '/private/Joao',
          recentRoutes: ['/agendaPage', '/lotePage?name=Segredo'],
        },
        operationalContext: {
          agendaState: {
            nextActivity: {
              type: 'Tarefa do João CPF 123',
              status: 'status livre Maria',
              dueLabel: 'Vence para Maria',
            },
          },
          fieldNotebookState: { latestRecordType: 'Registro Maria' },
          alertState: { highestSeverity: 'Severo Maria', types: ['Alerta do João', 'critical'] },
        },
        clientCapabilities: validCapabilities(),
      },
      sessionNavigations: [{ route: '/agendaPage', resourceName: 'Lote do João', resourceType: 'lote' }],
      geminiApiKey: 'fake',
      geminiGenerateText: async ({ prompt }) => {
        capturedPrompt = prompt;
        return JSON.stringify(validGeminiResponse());
      },
    });

    expect(capturedPrompt).toContain('/agendaPage');
    expect(capturedPrompt).toContain('critical');
    expect(capturedPrompt).not.toContain('Maria');
    expect(capturedPrompt).not.toContain('João');
    expect(capturedPrompt).not.toContain('CPF');
    expect(capturedPrompt).not.toContain('resourceName');
    expect(capturedPrompt).not.toContain('/private/Joao');
    expect(capturedPrompt).not.toContain('/lotePage?name=Segredo');
  });

  test('fallback returns complete INSTANT contract with fallback.used true', () => {
    const response = buildEnhancedInstantFallback({ operationalContext: validContext(), reason: 'test' });

    expect(response.mode).toBe('INSTANT');
    expect(response.visualPriority).toBe('moderate');
    expect(response.fallback).toEqual({ used: true, reason: 'test' });
    expect(response.nextStepPrediction.targetRoute).toBe('/agendaPage');
    expect(response.sectionAdaptations[0].component).toBe('NextStepCard');
    expect(response.uiTreatment.showProgressBar).toBe(false);
    expect(response.dashboard).toBe('Tarefas Pendentes');
    expect(response.cardType).toBe('tarefas');
    expect(typeof response.reason).toBe('string');
    expect(response.reasonDetails.summary).toBe(response.reason);
  });

  test('normalizer parses JSON and validator rejects forbidden components and routes', () => {
    const capabilities = validCapabilities();
    const parsed = parseGeminiJson(`\`\`\`json\n${JSON.stringify(validGeminiResponse({
      nextStepPrediction: { ...validGeminiResponse().nextStepPrediction, targetRoute: '/loginPage' },
      sectionAdaptations: [{ ...validGeminiResponse().sectionAdaptations[0], component: 'ProgressStepper' }],
    }))}\n\`\`\``);
    const normalized = normalizeInstantResponse(parsed, capabilities);
    const validation = validateInstantResponse(normalized, capabilities);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('invalid_next_step_route');
    expect(validation.errors).toContain('unsupported_component');
    expect(validation.errors).toContain('forbidden_component');
  });

  test('raw validator rejects progress bars and excessive arrays before normalization', async () => {
    const capabilities = validCapabilities({ maxShortcuts: 1, maxSectionAdaptations: 1 });
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: validContext(), clientCapabilities: capabilities },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(validGeminiResponse({
        uiTreatment: { ...validGeminiResponse().uiTreatment, showProgressBar: true },
        shortcuts: [
          { route: '/agendaPage', confidence: 0.84, label: 'Abrir Agenda', reason: 'Atividades.' },
          { route: '/lotePage', confidence: 0.7, label: 'Abrir Lote', reason: 'Lote.' },
        ],
        sectionAdaptations: [
          validGeminiResponse().sectionAdaptations[0],
          { ...validGeminiResponse().sectionAdaptations[0], sectionId: 'secondary' },
        ],
      })),
    });

    expect(response.fallback.used).toBe(true);
    expect(response.fallback.reason).toContain('progress_bar_requested');
    expect(response.fallback.reason).toContain('too_many_shortcuts');
    expect(response.fallback.reason).toContain('too_many_sections');
  });

  test('raw validator rejects forbidden UI equivalents outside component and showProgressBar', () => {
    const validation = validateRawInstantResponse(validGeminiResponse({
      reasonDetails: { summary: 'usar checklist operacional', details: ['stepper visual'], display: 'info_icon' },
    }), validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('forbidden_ui_equivalent_requested');
  });

  test('validator rejects progress-equivalent components even when client declares support', () => {
    const capabilities = validCapabilities({
      supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'ProgressRing', 'CircularProgressIndicator'],
    });

    const validation = validateRawInstantResponse(validGeminiResponse({
      sectionAdaptations: [{ ...validGeminiResponse().sectionAdaptations[0], component: 'ProgressRing' }],
      focus: { ...validGeminiResponse().focus, component: 'CircularProgressIndicator' },
    }), capabilities);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('forbidden_component');
    expect(validation.errors).toContain('forbidden_focus_component');
    expect(validation.errors).not.toContain('unsupported_component');
    expect(validation.errors).not.toContain('unsupported_focus_component');
  });

  test('progress-equivalent component from Gemini generates fallback', async () => {
    const response = await buildEnhancedInstantRecommendation({
      data: {
        operationalContext: validContext(),
        clientCapabilities: validCapabilities({ supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'ProgressRing'] }),
      },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(validGeminiResponse({
        sectionAdaptations: [{ ...validGeminiResponse().sectionAdaptations[0], component: 'ProgressRing' }],
      })),
    });

    expect(response.fallback.used).toBe(true);
    expect(response.fallback.reason).toContain('forbidden_component');
  });

  test('raw validator rejects unsupported focus component', () => {
    const validation = validateRawInstantResponse(validGeminiResponse({
      focus: { component: 'UnsupportedBanner', message: 'Foco', targetSectionId: 'recommended_actions', priority: 'high' },
    }), validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('unsupported_focus_component');
  });

  test('valid Gemini response becomes adaptive moderate recommendation preserving legacy fields', async () => {
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: validContext(), clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(validGeminiResponse()),
    });

    expect(response.mode).toBe('INSTANT');
    expect(response.source).toBe('adaptive');
    expect(response.visualPriority).toBe('moderate');
    expect(response.fallback.used).toBe(false);
    expect(response.dashboardId).toBe('TAREFAS_PENDENTES');
    expect(response.shortcuts).toHaveLength(1);
    expect(typeof response.reason).toBe('string');
    expect(response.reason).toContain('Contexto operacional');
    expect(response.reasonDetails.summary).toContain('Contexto operacional');
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
    expect(response.nextStepPrediction.targetRoute).toBe('/agendaPage');
  });

  test('finalizer marks valid recommendations as moderate and non-fallback', () => {
    const normalized = normalizeInstantResponse(validGeminiResponse(), validCapabilities());
    const finalized = finalizeValidInstantResponse(normalized);

    expect(finalized.visualPriority).toBe('moderate');
    expect(finalized.fallback.used).toBe(false);
    expect(finalized.rulesApplied).toContain('RULE-010');
  });

  test('metrics support legacy and enhanced event names', () => {
    expect(LEGACY_METRIC_EVENTS).toContain('session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('adaptive_session_start');
    expect(ENHANCED_INSTANT_METRIC_EVENTS).toContain('instant_adaptation_applied');
  });
});
