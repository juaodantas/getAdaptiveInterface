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

function recordCadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2 },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false },
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

function geminiResponse(overrides = {}) {
  return {
    responseVersion: '1.0',
    confidence: 0.84,
    enrichedRoutes: [
      { title: 'Verifique as atividades geradas na Agenda', description: 'Há atividades geradas para conferir.', actionLabel: 'Abrir Agenda', reason: 'Atividades pendentes.' },
      { title: 'Consulte os lotes', description: 'Veja lotes vinculados.', actionLabel: 'Ver Lotes', reason: null },
      { title: 'Revise o protocolo', description: 'Confira o protocolo.', actionLabel: 'Abrir Protocolo', reason: null },
    ],
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

  test('prompt contains ranking routes and enrichedRoutes schema, omits PII', () => {
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
    expect(prompt).toContain('enrichedRoutes');
    expect(prompt).toContain('actionLabel');
    expect(prompt).not.toContain('timestamp');
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
    expect(prompt).toContain('enrichedRoutes');
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
        return JSON.stringify(geminiResponse());
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

  test('normalizer parses JSON and validator rejects missing enrichedRoutes', () => {
    const capabilities = validCapabilities();
    const parsed = parseGeminiJson(`\`\`\`json\n${JSON.stringify(geminiResponse({ enrichedRoutes: undefined }))}\n\`\`\``);
    const normalized = normalizeInstantResponse(parsed, capabilities, deriveInstantSignals(validContext()));
    const validation = validateInstantResponse(normalized, capabilities);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('missing_enriched_routes');
  });

  test('raw validator rejects progress bars and forbidden UI equivalents', async () => {
    const capabilities = validCapabilities({ maxShortcuts: 1, maxSectionAdaptations: 1 });
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: validContext(), clientCapabilities: capabilities },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse({
        uiTreatment: { showProgressBar: true },
      })),
    });

    expect(response.fallback.used).toBe(true);
    expect(response.fallback.reason).toContain('progress_bar_requested');
  });

  test('raw validator rejects forbidden UI equivalents in text', () => {
    const validation = validateRawInstantResponse(geminiResponse({
      reasonDetails: { summary: 'usar checklist operacional', details: ['stepper visual'], display: 'info_icon' },
    }), validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('forbidden_ui_equivalent_requested');
  });

  test('raw validator rejects unsupported focus component', () => {
    const parsed = parseGeminiJson(JSON.stringify(geminiResponse()));
    const validation = validateRawInstantResponse({
      ...parsed,
      focus: { component: 'UnsupportedBanner', message: 'Foco', targetSectionId: 'recommended_actions', priority: 'high' },
    }, validCapabilities());

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('unsupported_focus_component');
  });

  test('valid Gemini response becomes adaptive moderate recommendation with unique routes', async () => {
    const ctx = recordCadernoContext();
    const response = await buildEnhancedInstantRecommendation({
      data: { operationalContext: ctx, clientCapabilities: validCapabilities() },
      sessionNavigations: [],
      geminiApiKey: 'fake',
      geminiGenerateText: async () => JSON.stringify(geminiResponse({
        enrichedRoutes: [
          { title: 'Registre o ajuste', description: 'Ajuste pendente', actionLabel: 'Abrir Caderno', reason: 'Ajuste.' },
          { title: 'Ver solução', description: 'Solução disponível', actionLabel: 'Ver Solução', reason: null },
          { title: 'Consultar agenda', description: 'Atividades', actionLabel: 'Abrir Agenda', reason: null },
        ],
      })),
    });

    expect(response.mode).toBe('INSTANT');
    expect(response.source).toBe('adaptive');
    expect(response.visualPriority).toBe('moderate');
    expect(response.fallback.used).toBe(false);

    const routes = [response.nextStepPrediction.targetRoute, response.infoRecommendation.ctaRoute, ...response.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length);
    expect(typeof response.reason).toBe('string');
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
    const signals = deriveInstantSignals(recordCadernoContext());
    const normalized = normalizeInstantResponse(geminiResponse({
      enrichedRoutes: [
        { title: 'Registre', description: 'Ajuste', actionLabel: 'Abrir', reason: null },
        { title: 'Solução', description: 'Solução', actionLabel: 'Ver', reason: null },
      ],
    }), validCapabilities(), signals);
    const finalized = finalizeValidInstantResponse(normalized, validCapabilities(), signals);

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
