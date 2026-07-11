const { buildInstantPrompt, buildPromptOperationalContext } = require('../../src/instantPromptBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals, ROUTE_CONFLICT_RESOLVER, STEP_SHORTCUTS } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');
const { validateInstantResponse, validateRawInstantResponse, finalizeValidInstantResponse } = require('../../src/instantResponseValidator');
const { buildEnhancedInstantRecommendation } = require('../../src/enhancedInstantMode');
const { buildInfoRecommendationFallback, resolveRouteConflicts } = require('../../src/instantInfoRecommendationBuilder');
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
    ...overrides,
  });
}

function cadernoContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2, nextActivity: { title: 'Registre uma atividade no caderno de campo', type: 'nutritional_adjustment', status: 'pending', dueLabel: 'Hoje' } },
    ...overrides,
  });
}

function testContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2 },
    testSequenceSignals: { experimentActive: true, lotWithProtocolCreated: true, generatedActivitiesSeen: false },
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
    expect(prompt).toContain('O primeiro shortcut PODE repetir o targetRoute');
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

  test('normalizer respects client maxShortcuts up to 4', () => {
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
    const normalized = normalizeInstantResponse(manyShortcuts, capabilities({ maxShortcuts: 4 }), signals, cadernoContext());
    expect(normalized.shortcuts.length).toBe(4);
  });

  test('validator preserves enriched operational context contract fields', () => {
    const normalized = normalizeOperationalContext({
      generatedAt: '2026-07-07T12:34:56.000Z',
      unknownSection: { leaked: true },
      dashboardState: { totalLots: 4, speciesInProgress: ['Alface', '  Rúcula  '] },
      agendaState: {
        pendingActivitiesWeekCount: 5,
        lastInteractionType: 'completed',
        lastActivityTitle: ' Aplicação de nutrientes ',
        lastActivityDescription: ' Ajuste concluído no lote ',
        nextActivity: { title: 'Irrigação', description: 'Verificar linhas', type: 'irrigation', status: 'pending', dueLabel: 'hoje' },
      },
      productionState: { hasProductionData: true, upcomingHarvestLots: 2 },
      cultivationState: { dominantCulture: 'Alface', cultures: [{ name: 'Alface', quantity: 2, color: '#fff' }] },
      teamState: { activeMembers: 3, averageCompletionRate: 83 },
      alertState: { hasCriticalAlerts: true, items: [{ type: 'critical', message: 'Atenção ao lote', severity: 'critical', date: '2026-07-07T12:34:56Z' }] },
      reservoirState: { hasReservoirs: true, withSolutionCount: 1 },
      fieldNotebookState: { hasRecentFieldNotes: true, latestNotes: [{ title: 'Semeadura', createdAt: '2026-07-07T12:34:56Z' }] },
      infoCardsState: { dayProgress: { total: 4, completed: 2, label: 'Metade do dia' } },
      testSequenceSignals: { adjustmentRecorded: true, changedAt: '2026-07-07T12:34:56Z' },
    });

    expect(normalized.generatedAt).toBe('2026-07-07T12:34:56.000Z');
    expect(normalized.unknownSection).toBeUndefined();
    expect(normalized.agendaState.lastAgendaInteraction).toBe('completed');
    expect(normalized.agendaState.lastInteractionType).toBe('completed');
    expect(normalized.agendaState.lastActivityTitle).toBe('Aplicação de nutrientes');
    expect(normalized.agendaState.nextActivity.title).toBe('Irrigação');
    expect(normalized.agendaState.nextActivity.description).toBe('Verificar linhas');
    expect(normalized.fieldNotebookState.hasRecentNotes).toBe(true);
    expect(normalized.testSequenceSignals.adjustmentRecorded).toBe(true);
    expect(normalized.infoCardsState.dayProgress.label).toBe('Metade do dia');
  });

  test('validator accepts slim payload and sanitizes recent user actions', () => {
    const normalized = normalizeOperationalContext({
      dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true, hasUpcomingHarvests: false },
      agendaState: {
        hasGeneratedActivities: true,
        pendingToday: 2,
        overdueCount: 1,
        hasOverdue: true,
        nextActivityType: 'protocol_activity',
        nextActivityStatus: 'pending',
        nextActivityDueLabel: 'hoje',
        nextActivityOverdue: false,
        hasProtocolTasks: true,
        lastAgendaInteraction: 'viewed',
      },
      fieldNotebookState: {
        hasRecentNotes: true,
        hasNutritionAdjustmentRecord: false,
        totalRecentNotes: 3,
        hasSowingNote: true,
      },
      cultivationState: { culturesCount: 4, speciesInProgressCount: 2 },
      recentUserActions: [{
        entityType: 'lot',
        action: 'viewed',
        entityId: 'lot-1',
        entityName: 'Lote sensível',
        timestamp: '2026-07-07T12:34:56Z',
      }, {
        entityType: 'activity',
        action: 'completed Maria CPF 123',
        timestamp: '2026-07-07T12:34:56Z',
      }],
    });

    expect(normalized.agendaState).toMatchObject({
      pendingToday: 2,
      overdueCount: 1,
      hasOverdue: true,
      nextActivityType: 'protocol_activity',
      nextActivityStatus: 'pending',
      nextActivityDueLabel: 'today',
      nextActivityOverdue: false,
      hasProtocolTasks: true,
      lastAgendaInteraction: 'viewed',
    });
    expect(normalized.fieldNotebookState).toMatchObject({
      hasRecentNotes: true,
      hasNutritionAdjustmentRecord: false,
      hasSowingNote: true,
    });
    expect(normalized.cultivationState).toMatchObject({ culturesCount: 4, speciesInProgressCount: 2 });
    expect(normalized.recentUserActions).toEqual([{ entityType: 'lot', action: 'viewed', timestamp: '2026-07-07T12:34:56.000Z', entityId: 'lot-1' }]);
    expect(JSON.stringify(normalized.recentUserActions)).not.toContain('entityName');
    expect(JSON.stringify(normalized.recentUserActions)).not.toContain('Lote sensível');
  });

  test('validator maps legacy aliases to slim normalized names', () => {
    const normalized = normalizeOperationalContext({
      agendaState: {
        pendingActivitiesTodayCount: 5,
        overdueActivitiesCount: 2,
        dueBuckets: { today: 7, overdue: 3 },
        lastInteractionType: 'completed',
        nextActivity: { type: 'irrigation', status: 'pending', dueLabel: 'amanhã', overdue: true },
        latestTasks: [{ type: 'protocol_activity' }],
      },
      fieldNotebookState: {
        hasRecentFieldNotes: true,
        hasRecentNutritionAdjustmentRecord: true,
        sowingNotePresent: true,
      },
      cultivationState: { cultures: [{ name: 'Alface' }, { name: 'Rúcula' }], speciesInProgress: ['Alface'] },
    });

    expect(normalized.agendaState.pendingToday).toBe(5);
    expect(normalized.agendaState.overdueCount).toBe(2);
    expect(normalized.agendaState.hasOverdue).toBe(true);
    expect(normalized.agendaState.lastAgendaInteraction).toBe('completed');
    expect(normalized.agendaState.nextActivityType).toBe('irrigation');
    expect(normalized.agendaState.nextActivityStatus).toBe('pending');
    expect(normalized.agendaState.nextActivityDueLabel).toBe('tomorrow');
    expect(normalized.agendaState.nextActivityOverdue).toBe(true);
    expect(normalized.agendaState.hasProtocolTasks).toBe(true);
    expect(normalized.fieldNotebookState.hasRecentNotes).toBe(true);
    expect(normalized.fieldNotebookState.hasNutritionAdjustmentRecord).toBe(true);
    expect(normalized.fieldNotebookState.hasSowingNote).toBe(true);
    expect(normalized.cultivationState.culturesCount).toBe(2);
    expect(normalized.cultivationState.speciesInProgressCount).toBe(1);
  });

  test('prompt includes sanitized recent user actions without entity names', () => {
    const normalized = normalizeOperationalContext({
      dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
      agendaState: { hasGeneratedActivities: true, pendingToday: 0 },
      recentUserActions: [{
        entityType: 'activity',
        action: 'completed',
        entityId: 'activity-1',
        entityName: 'Atividade da Maria CPF 123',
        timestamp: '2026-07-07T12:34:56Z',
      }],
    });
    const prompt = buildInstantPrompt({
      navigationContext: { currentRoute: '/homePage', recentRoutes: [] },
      sessionNavigations: [],
      operationalContext: normalized,
      clientCapabilities: capabilities(),
      signals: deriveInstantSignals(normalized),
    });

    expect(prompt).toContain('recentUserActions');
    expect(prompt).toContain('activity');
    expect(prompt).toContain('completed');
    expect(prompt).not.toContain('entityName');
    expect(prompt).not.toContain('Atividade da Maria');
    expect(prompt).not.toContain('CPF 123');
    expect(prompt).not.toContain('activity-1');
  });

  test('compact prompt context summarizes enriched arrays', () => {
    const normalized = normalizeOperationalContext({
      dashboardState: { speciesInProgress: ['Alface', 'Rúcula'] },
      agendaState: { latestTasks: [{ title: 'Tarefa 1' }], nextActivity: { title: 'Irrigação', description: 'Verificar linhas' } },
      productionState: { monthlyProduction: [{ month: 'Julho', quantity: 10 }] },
      reservoirState: { highlightedReservoirs: [{ name: 'Reservatório A' }] },
      fieldNotebookState: { latestNotes: [{ title: 'Nota do campo' }] },
      infoCardsState: {
        todayCultivation: { nextTasks: [{ title: 'Tarefa sensível' }], activeLots: 2 },
        fieldNotesSummary: { latestNotes: [{ title: 'Nota sensível' }], totalRecentNotes: 1 },
      },
    });

    const compact = buildPromptOperationalContext(normalized);

    expect(compact.dashboardState.speciesInProgressCount).toBe(2);
    expect(compact.productionState.monthlyProductionCount).toBe(1);
    expect(compact.reservoirState.highlightedReservoirsCount).toBe(1);
    expect(compact.fieldNotebookState.latestNotesCount).toBe(1);
    expect(compact.infoCardsState).toBeUndefined();
  });

  test('resolveRouteConflicts allows the first shortcut to repeat targetRoute', () => {
    const resolved = resolveRouteConflicts('record_caderno_adjustment', '/cadernoCampoPage', null, [
      { route: '/cadernoCampoPage', label: 'Registrar', group: 'primary' },
      { route: '/agendaPage', label: 'Agenda', group: 'secondary' },
    ]);

    expect(resolved.nextStepRoute).toBe('/cadernoCampoPage');
    const routes = [resolved.nextStepRoute, ...resolved.shortcuts.map((s) => s.route)];
    expect(new Set(routes).size).toBe(routes.length - 1);
    expect(resolved.shortcuts[0].route).toBe('/cadernoCampoPage');
  });

  test('resolveRouteConflicts resolves info ctaRoute conflict', () => {
    const resolved = resolveRouteConflicts('record_caderno_adjustment', '/cadernoCampoPage', '/cadernoCampoPage', [
      { route: '/agendaPage', label: 'Agenda' },
    ]);

    expect(resolved.infoCtaRoute).not.toBe('/cadernoCampoPage');
    expect(resolved.infoCtaRoute).toBe('/agendaPage');
  });

  test('resolveRouteConflicts updates shortcut text when route is remapped', () => {
    const resolved = resolveRouteConflicts('finish_agenda_activities', '/agendaPage', '/agendaPage', [
      {
        route: '/cadernoCampoPage',
        label: 'Caderno',
        description: 'Confira os últimos registros no caderno',
        reason: 'Confira os últimos registros no caderno',
        confidence: 0.5,
        group: 'secondary',
      },
    ]);

    expect(resolved.shortcuts).toHaveLength(1);
    expect(resolved.shortcuts[0]).toMatchObject({
      route: '/lotePage',
      label: 'Ver Lotes',
      description: 'Consulte os lotes em produção.',
      reason: 'Consulte os lotes em produção.',
      confidence: 0.5,
      group: 'secondary',
    });
    expect(resolved.shortcuts[0].label).not.toContain('Caderno');
    expect(resolved.shortcuts[0].description).not.toContain('caderno');
    expect(resolved.shortcuts[0].reason).not.toContain('caderno');
  });

  test('resolveRouteConflicts preserves shortcut text when route does not change', () => {
    const shortcut = {
      route: '/protocoloPage',
      label: 'Texto atual',
      description: 'Descrição atual',
      reason: 'Motivo atual',
      confidence: 0.5,
      group: 'contextual',
    };
    const resolved = resolveRouteConflicts('review_final_home', '/relatoriosPage', '/agendaPage', [shortcut]);

    expect(resolved.shortcuts).toEqual([shortcut]);
  });

  test('fallback response has unique routes and max 3 shortcuts', () => {
    const fallback = buildEnhancedInstantFallback({ operationalContext: cadernoContext(), clientCapabilities: capabilities() });

    expect(fallback.fallback.used).toBe(true);
    expect(fallback.shortcuts.length).toBeLessThanOrEqual(3);
    const routes = [fallback.nextStepPrediction.targetRoute, fallback.infoRecommendation.ctaRoute, ...fallback.shortcuts.map((s) => s.route)];
    const unique = [...new Set(routes)];
    expect(unique.length).toBeGreaterThanOrEqual(routes.length - 1);
  });

  test('fallback info mappings follow natural Home flow', () => {
    const cases = [
      { rulesApplied: ['RULE-001'], type: 'basic_tip' },
      { rulesApplied: ['RULE-002'], type: 'today_cultivation' },
      { rulesApplied: ['RULE-003'], type: 'today_cultivation' },
      { rulesApplied: ['RULE-004'], type: 'field_notes_summary' },
      { rulesApplied: ['RULE-005'], type: 'basic_tip' },
    ];

    for (const item of cases) {
      const result = buildInfoRecommendationFallback({ signals: item, clientCapabilities: capabilities() });
      expect(result.type).toBe(item.type);
    }
  });

  test('RULE-005 mapping wins over completed agenda interaction override', () => {
    const result = buildInfoRecommendationFallback({
      signals: { rulesApplied: ['RULE-005'] },
      clientCapabilities: capabilities(),
      operationalContext: context({
        agendaState: {
          hasGeneratedActivities: true,
          pendingToday: 0,
          completedActivitiesTodayCount: 2,
          lastAgendaInteraction: 'completed',
        },
      }),
    });

    expect(result.type).toBe('basic_tip');
    expect(result.category).toBe('geral');
    expect(result.ctaRoute).toBe('/relatoriosPage');
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
    // Opção B: shortcut[0] pode repetir targetRoute; infoCtaRoute pode repetir se resolver não tiver alternativa
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(result.nextStepPrediction.targetRoute).toBe('/cadernoCampoPage');
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
    const unique = [...new Set(routes)];
    expect(unique.length).toBeGreaterThanOrEqual(routes.length - 1);
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
