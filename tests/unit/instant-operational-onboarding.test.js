const {
  normalizeOperationalOnboarding,
  validateOperationalOnboarding,
  buildOperationalOnboardingFallback,
  STEP_IDS_WITH_ONBOARDING,
  OPERATIONAL_ONBOARDING_FALLBACK,
} = require('../../src/instantOperationalOnboardingBuilder');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'OperationalOnboardingCard'],
    maxShortcuts: 3,
    maxSectionAdaptations: 4,
    ...overrides,
  });
}

function noCapability(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner'],
    maxShortcuts: 3,
    maxSectionAdaptations: 4,
    ...overrides,
  });
}

function fullSignals(overrides = {}) {
  return {
    stepId: 'create_lot_with_protocol',
    targetRoute: '/protocoloPage',
    rulesApplied: ['RULE-001', 'RULE-010'],
    ...overrides,
  };
}

function testSignals(overrides = {}) {
  return {
    stepId: 'test_create_lot_with_protocol',
    targetRoute: '/lotePage',
    rulesApplied: ['RULE-016', 'RULE-010'],
    ...overrides,
  };
}

function otherSignals(overrides = {}) {
  return {
    stepId: 'check_generated_activities',
    targetRoute: '/agendaPage',
    rulesApplied: ['RULE-002', 'RULE-010'],
    ...overrides,
  };
}

function continuitySignals(overrides = {}) {
  return {
    stepId: 'plan_next_lot',
    targetRoute: '/lotePage',
    rulesApplied: ['RULE-016', 'RULE-010'],
    ...overrides,
  };
}

function completeSignals(overrides = {}) {
  return {
    stepId: 'test_complete',
    targetRoute: '/relatoriosPage',
    rulesApplied: ['RULE-006', 'RULE-010'],
    ...overrides,
  };
}

function validGeminiInput(overrides = {}) {
  return {
    title: 'Como começar',
    message: 'Crie seu primeiro lote com protocolo para iniciar o acompanhamento.',
    steps: [
      'Cadastre ou selecione um protocolo',
      'Crie o primeiro lote',
      'Acompanhe as atividades geradas na agenda',
    ],
    ctaLabel: 'Criar primeiro lote',
    targetRoute: '/protocoloPage',
    reason: 'Usuário ainda não possui lote ativo com protocolo.',
    priority: 20,
    ...overrides,
  };
}

function validValidationShape(overrides = {}) {
  return {
    title: 'Como começar',
    message: 'Crie seu primeiro lote com protocolo.',
    steps: ['Passo 1', 'Passo 2'],
    ctaLabel: 'Criar',
    targetRoute: '/protocoloPage',
    reason: 'Usuário ainda não possui lote ativo com protocolo.',
    priority: 20,
    ...overrides,
  };
}

function continuityContext(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 },
    alertState: { hasCriticalAlerts: false, criticalCount: 0 },
    fieldNotebookState: { hasRecentNotes: false, hasNutritionAdjustmentRecord: false },
    productionState: { hasProductionData: false },
    cultivationState: { culturesCount: 0, speciesInProgressCount: 0 },
    reservoirState: { hasReservoirs: false },
    teamState: { activeMembers: 0, onTimeActivities: 0, overdueActivities: 0 },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('STEP_IDS_WITH_ONBOARDING constant', () => {
  test('contains supported onboarding steps', () => {
    expect(STEP_IDS_WITH_ONBOARDING).toEqual(['create_lot_with_protocol', 'plan_next_lot']);
  });

  test('const variable cannot be reassigned', () => {
    expect(() => {
      // In strict module context, const reassignment throws
      STEP_IDS_WITH_ONBOARDING = ['another_step'];
    }).toThrow();
  });
});

describe('OPERATIONAL_ONBOARDING_FALLBACK constant', () => {
  test('has expected shape and values', () => {
    expect(OPERATIONAL_ONBOARDING_FALLBACK).toEqual({
      title: 'Como começar',
      message: 'Crie seu primeiro lote com protocolo para iniciar o acompanhamento.',
      steps: [
        'Cadastre ou selecione um protocolo',
        'Crie o primeiro lote',
        'Acompanhe as atividades geradas na agenda',
      ],
      ctaLabel: 'Criar primeiro lote',
      priority: 20,
    });
  });

  test('does not include targetRoute or reason (they are dynamic)', () => {
    expect(OPERATIONAL_ONBOARDING_FALLBACK).not.toHaveProperty('targetRoute');
    expect(OPERATIONAL_ONBOARDING_FALLBACK).not.toHaveProperty('reason');
  });
});

// ---------------------------------------------------------------------------
// Scenario 1 — stepId = create_lot_with_protocol, capability present
// ---------------------------------------------------------------------------

describe('Scenario 1: create_lot_with_protocol with OperationalOnboardingCard capability', () => {
  test('normalizeOperationalOnboarding returns fallback when Gemini returns null', () => {
    const result = normalizeOperationalOnboarding(null, fullSignals(), capabilities());

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
    expect(result.message).toBe('Crie seu primeiro lote com protocolo para iniciar o acompanhamento.');
    expect(result.steps).toEqual([
      'Cadastre ou selecione um protocolo',
      'Crie o primeiro lote',
      'Acompanhe as atividades geradas na agenda',
    ]);
    expect(result.ctaLabel).toBe('Criar primeiro lote');
    expect(result.targetRoute).toBe('/areaCultivoPage');
    expect(result.reason).toBe('Não há lote com protocolo: recomendar cadastro de lote com protocolo.');
    expect(result.priority).toBe(20);
  });

  test('normalizeOperationalOnboarding returns fallback when Gemini returns undefined', () => {
    const result = normalizeOperationalOnboarding(undefined, fullSignals(), capabilities());

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
    expect(result.targetRoute).toBe('/areaCultivoPage');
  });
});

describe('Scenario 1b: plan_next_lot with OperationalOnboardingCard capability', () => {
  test('normalizeOperationalOnboarding returns continuity fallback when Gemini returns null', () => {
    const result = normalizeOperationalOnboarding(null, continuitySignals(), capabilities());

    expect(result).toEqual({
      title: 'Planejar próximo lote',
      message: 'Seu lote ativo está em acompanhamento. Planeje o próximo lote para manter a produção organizada.',
      steps: [
        'Revise a capacidade disponível',
        'Crie o próximo lote',
        'Vincule um protocolo antes de iniciar',
      ],
      ctaLabel: 'Planejar próximo lote',
      priority: 20,
      targetRoute: '/lotePage',
      reason: 'Há lote ativo com protocolo e nenhuma urgência operacional no momento.',
    });
  });

  test('normalizeOperationalOnboarding preserves valid Gemini copy with continuity route', () => {
    const result = normalizeOperationalOnboarding(
      validGeminiInput({ title: '  Planejar  ', targetRoute: '/protocoloPage' }),
      continuitySignals(),
      capabilities(),
    );

    expect(result.title).toBe('Planejar');
    expect(result.targetRoute).toBe('/lotePage');
  });

  test('fallbacks use semantic reason from real derived signals instead of RULE-010', () => {
    const context = continuityContext();
    const signals = deriveInstantSignals(context);

    expect(signals.stepId).toBe('plan_next_lot');
    expect(signals.rulesApplied).toEqual(['RULE-010', 'RULE-016']);

    const onboardingFallback = buildOperationalOnboardingFallback({ signals });
    const enhancedFallback = buildEnhancedInstantFallback({
      operationalContext: context,
      clientCapabilities: capabilities(),
      reason: 'test',
    });

    expect(onboardingFallback.reason).toBe('Há lote ativo com protocolo e nenhuma urgência operacional no momento.');
    expect(enhancedFallback.operationalOnboarding.reason).toBe('Há lote ativo com protocolo e nenhuma urgência operacional no momento.');
    expect(onboardingFallback.reason).not.toBe('Componente de progresso, stepper ou checklist é proibido.');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — legacy test_create_lot_with_protocol is not an onboarding step
// ---------------------------------------------------------------------------

describe('Scenario 2: test_create_lot_with_protocol with OperationalOnboardingCard capability', () => {
  test('normalizeOperationalOnboarding returns null', () => {
    const result = normalizeOperationalOnboarding(null, testSignals(), capabilities());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — stepId = create_lot_with_protocol, capability absent
// ---------------------------------------------------------------------------

describe('Scenario 3: create_lot_with_protocol without OperationalOnboardingCard capability', () => {
  test('normalizeOperationalOnboarding returns null', () => {
    const result = normalizeOperationalOnboarding(null, fullSignals(), noCapability());

    expect(result).toBeNull();
  });

  test('normalizeOperationalOnboarding returns null even with valid Gemini input', () => {
    const result = normalizeOperationalOnboarding(validGeminiInput(), fullSignals(), noCapability());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — stepId = check_generated_activities, capability present
// ---------------------------------------------------------------------------

describe('Scenario 4: check_generated_activities with capability — not an onboarding step', () => {
  test('normalizeOperationalOnboarding returns null', () => {
    const result = normalizeOperationalOnboarding(null, otherSignals(), capabilities());

    expect(result).toBeNull();
  });

  test('normalizeOperationalOnboarding returns null even with valid Gemini input', () => {
    const result = normalizeOperationalOnboarding(validGeminiInput(), otherSignals(), capabilities());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — stepId = test_complete, capability present
// ---------------------------------------------------------------------------

describe('Scenario 5: test_complete with capability — not an onboarding step', () => {
  test('normalizeOperationalOnboarding returns null', () => {
    const result = normalizeOperationalOnboarding(null, completeSignals(), capabilities());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Gemini returns valid operationalOnboarding but stepId does not match
// ---------------------------------------------------------------------------

describe('Scenario 6: valid Gemini input but non-matching stepId', () => {
  test('normalizeOperationalOnboarding returns null because stepId check comes first', () => {
    const result = normalizeOperationalOnboarding(
      validGeminiInput({ targetRoute: '/agendaPage', reason: 'Irrelevant.' }),
      otherSignals(),
      capabilities(),
    );

    expect(result).toBeNull();
  });

  test('normalizeOperationalOnboarding returns null for test_complete even with valid Gemini', () => {
    const result = normalizeOperationalOnboarding(
      validGeminiInput(),
      completeSignals(),
      capabilities(),
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — Gemini returns invalid operationalOnboarding and stepId matches
// ---------------------------------------------------------------------------

describe('Scenario 7: invalid Gemini input but matching stepId', () => {
  test('normalizeOperationalOnboarding uses fallback when Gemini value has empty title', () => {
    const result = normalizeOperationalOnboarding(
      validGeminiInput({ title: '' }),
      fullSignals(),
      capabilities(),
    );

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
    expect(result.targetRoute).toBe('/areaCultivoPage');
  });

  test('normalizeOperationalOnboarding uses fallback when Gemini value has missing fields', () => {
    const result = normalizeOperationalOnboarding({}, fullSignals(), capabilities());

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
    expect(result.targetRoute).toBe('/areaCultivoPage');
  });

  test('normalizeOperationalOnboarding uses fallback when Gemini value is an array (invalid type)', () => {
    const result = normalizeOperationalOnboarding([], fullSignals(), capabilities());

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — Gemini returns no operationalOnboarding and stepId matches
// ---------------------------------------------------------------------------

describe('Scenario 8: no Gemini operationalOnboarding but matching stepId', () => {
  test('normalizeOperationalOnboarding uses fallback when raw is null', () => {
    const result = normalizeOperationalOnboarding(null, fullSignals(), capabilities());

    expect(result).not.toBeNull();
    expect(result.title).toBe('Como começar');
  });

  test('normalizeOperationalOnboarding uses fallback when raw is undefined', () => {
    const result = normalizeOperationalOnboarding(undefined, testSignals(), capabilities());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenarios 9-13 — Validation
// ---------------------------------------------------------------------------

describe('validateOperationalOnboarding', () => {
  test('returns empty array for a valid shape', () => {
    const errors = validateOperationalOnboarding(validValidationShape());
    expect(errors).toEqual([]);
  });

  // Scenario 9
  test('returns invalid_title when title is empty', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ title: '' }));
    expect(errors).toEqual(['invalid_title']);
  });

  test('returns invalid_title when title is only whitespace', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ title: '   ' }));
    expect(errors).toEqual(['invalid_title']);
  });

  test('returns invalid_title when title exceeds 60 chars', () => {
    const errors = validateOperationalOnboarding(
      validValidationShape({ title: 'a'.repeat(61) }),
    );
    expect(errors).toEqual(['invalid_title']);
  });

  test('returns invalid_title when title is not a string', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ title: 123 }));
    expect(errors).toEqual(['invalid_title']);
  });

  // Scenario 10
  test('returns invalid_priority when priority is 0', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ priority: 0 }));
    expect(errors).toEqual(['invalid_priority']);
  });

  // Scenario 11
  test('returns invalid_priority when priority is 101', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ priority: 101 }));
    expect(errors).toEqual(['invalid_priority']);
  });

  test('returns invalid_priority when priority is a float', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ priority: 1.5 }));
    expect(errors).toEqual(['invalid_priority']);
  });

  test('returns invalid_priority when priority is missing', () => {
    const { priority, ...rest } = validValidationShape();
    const errors = validateOperationalOnboarding(rest);
    expect(errors).toEqual(['invalid_priority']);
  });

  // Scenario 12
  test('returns invalid_steps when steps is an empty array', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ steps: [] }));
    expect(errors).toEqual(['invalid_steps']);
  });

  test('returns invalid_steps when steps has more than 5 items', () => {
    const errors = validateOperationalOnboarding(
      validValidationShape({ steps: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    );
    expect(errors).toEqual(['invalid_steps']);
  });

  test('returns invalid_steps when a step is empty string', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ steps: ['valid', ''] }));
    expect(errors).toEqual(['invalid_steps']);
  });

  test('returns invalid_steps when a step exceeds 80 chars', () => {
    const errors = validateOperationalOnboarding(
      validValidationShape({ steps: ['valid', 'a'.repeat(81)] }),
    );
    expect(errors).toEqual(['invalid_steps']);
  });

  test('returns invalid_steps when steps is not an array', () => {
    const errors = validateOperationalOnboarding(validValidationShape({ steps: 'not-an-array' }));
    expect(errors).toEqual(['invalid_steps']);
  });

  // Scenario 13
  test('returns invalid_target_route when route is not in ALLOWED_INSTANT_ROUTES', () => {
    const errors = validateOperationalOnboarding(
      validValidationShape({ targetRoute: '/invalidRoute' }),
    );
    expect(errors).toEqual(['invalid_target_route']);
  });

  test('returns invalid_target_route when route is missing', () => {
    const { targetRoute, ...rest } = validValidationShape();
    const errors = validateOperationalOnboarding(rest);
    expect(errors).toEqual(['invalid_target_route']);
  });

  // Additional validation edge cases
  test('returns missing_or_invalid when value is null', () => {
    const errors = validateOperationalOnboarding(null);
    expect(errors).toEqual(['missing_or_invalid']);
  });

  test('returns missing_or_invalid when value is undefined', () => {
    const errors = validateOperationalOnboarding(undefined);
    expect(errors).toEqual(['missing_or_invalid']);
  });

  test('returns missing_or_invalid when value is a string', () => {
    const errors = validateOperationalOnboarding('not-an-object');
    expect(errors).toEqual(['missing_or_invalid']);
  });

  test('returns multiple errors when several fields are invalid', () => {
    const errors = validateOperationalOnboarding({
      title: '',
      message: '',
      steps: [],
      ctaLabel: '',
      targetRoute: '/bogus',
      reason: '',
      priority: 0,
    });

    expect(errors).toContain('invalid_title');
    expect(errors).toContain('invalid_message');
    expect(errors).toContain('invalid_steps');
    expect(errors).toContain('invalid_cta_label');
    expect(errors).toContain('invalid_target_route');
    expect(errors).toContain('invalid_reason');
    expect(errors).toContain('invalid_priority');
  });
});

// ---------------------------------------------------------------------------
// Scenario 14 — Fallback response includes operationalOnboarding when stepId matches
// ---------------------------------------------------------------------------

describe('Scenario 14: buildOperationalOnboardingFallback with matching stepId', () => {
  test('returns full shape with create_lot_with_protocol signals', () => {
    const result = buildOperationalOnboardingFallback({ signals: fullSignals() });

    expect(result).toEqual({
      title: 'Como começar',
      message: 'Crie seu primeiro lote com protocolo para iniciar o acompanhamento.',
      steps: [
        'Cadastre ou selecione um protocolo',
        'Crie o primeiro lote',
        'Acompanhe as atividades geradas na agenda',
      ],
      ctaLabel: 'Criar primeiro lote',
      priority: 20,
      targetRoute: '/areaCultivoPage',
      reason: 'Não há lote com protocolo: recomendar cadastro de lote com protocolo.',
    });
  });

  test('returns null with test_create_lot_with_protocol signals', () => {
    const result = buildOperationalOnboardingFallback({ signals: testSignals() });

    expect(result).toBeNull();
  });

  test('falls back to default route when signals.targetRoute is missing', () => {
    const result = buildOperationalOnboardingFallback({
      signals: fullSignals({ targetRoute: undefined }),
    });

    expect(result.targetRoute).toBe('/areaCultivoPage');
  });
});

// ---------------------------------------------------------------------------
// Scenario 15 — Fallback does NOT include operationalOnboarding when stepId doesn't match
// ---------------------------------------------------------------------------

describe('Scenario 15: buildOperationalOnboardingFallback with non-matching stepId', () => {
  test('returns null for check_generated_activities', () => {
    const result = buildOperationalOnboardingFallback({ signals: otherSignals() });
    expect(result).toBeNull();
  });

  test('returns null for test_complete', () => {
    const result = buildOperationalOnboardingFallback({ signals: completeSignals() });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: normalizeOperationalOnboarding with valid Gemini input
// ---------------------------------------------------------------------------

describe('normalizeOperationalOnboarding with valid Gemini input', () => {
  test('returns normalized version with trimmed fields', () => {
    const raw = {
      title: '  Como começar  ',
      message: '  Crie seu primeiro lote  ',
      steps: ['  Passo um  ', '  Passo dois  '],
      ctaLabel: '  Criar  ',
      targetRoute: '/areaCultivoPage',
      reason: '  Motivo qualquer  ',
      priority: 30,
    };

    const result = normalizeOperationalOnboarding(raw, fullSignals(), capabilities());

    expect(result).toEqual({
      title: 'Como começar',
      message: 'Crie seu primeiro lote',
      steps: ['Passo um', 'Passo dois'],
      ctaLabel: 'Criar',
      targetRoute: '/areaCultivoPage',
      reason: 'Motivo qualquer',
      priority: 30,
    });
  });

  test('returns null for legacy test-specific targetRoute from Gemini', () => {
    const raw = validGeminiInput({ targetRoute: '/lotePage', priority: 50 });
    const result = normalizeOperationalOnboarding(raw, testSignals(), capabilities());

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: buildOperationalOnboardingFallback with null signals
// ---------------------------------------------------------------------------

describe('buildOperationalOnboardingFallback edge cases', () => {
  test('returns null when signals is null', () => {
    const result = buildOperationalOnboardingFallback({ signals: null });
    expect(result).toBeNull();
  });

  test('returns null when signals is undefined', () => {
    const result = buildOperationalOnboardingFallback({ signals: undefined });
    expect(result).toBeNull();
  });

  test('returns null when called without arguments', () => {
    const result = buildOperationalOnboardingFallback();
    expect(result).toBeNull();
  });

  test('returns null when signals has no stepId', () => {
    const result = buildOperationalOnboardingFallback({ signals: { targetRoute: '/x' } });
    expect(result).toBeNull();
  });

  test('returns null when signals.stepId is not in STEP_IDS_WITH_ONBOARDING', () => {
    const result = buildOperationalOnboardingFallback({
      signals: { stepId: 'unknown_step', targetRoute: '/x' },
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 1 — FINAL_INSTANT_RESPONSE_KEYS includes 'operationalOnboarding'
// ---------------------------------------------------------------------------

describe('FINAL_INSTANT_RESPONSE_KEYS', () => {
  it('includes operationalOnboarding', () => {
    const { FINAL_INSTANT_RESPONSE_KEYS } = require('../../src/instantResponseValidator');
    expect(FINAL_INSTANT_RESPONSE_KEYS).toContain('operationalOnboarding');
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — DEFAULT_SUPPORTED_COMPONENTS includes OperationalOnboardingCard
// ---------------------------------------------------------------------------

describe('DEFAULT_SUPPORTED_COMPONENTS', () => {
  it('includes OperationalOnboardingCard', () => {
    const { DEFAULT_SUPPORTED_COMPONENTS } = require('../../src/adaptiveContract');
    expect(DEFAULT_SUPPORTED_COMPONENTS).toContain('OperationalOnboardingCard');
  });
});

// ---------------------------------------------------------------------------
// Gap 3 — normalizeInstantResponse pipeline integration
// ---------------------------------------------------------------------------

describe('normalizeInstantResponse integration', () => {
  const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
  const { normalizeInstantResponse } = require('../../src/instantResponseNormalizer');

  function capabilities() {
    return normalizeClientCapabilities({
      supportedComponents: [
        'NextStepCard', 'AdaptiveFocusBanner',
        'OperationalOnboardingCard', 'HomeInfoCard',
      ],
      maxShortcuts: 3,
      maxSectionAdaptations: 4,
      supportedInfoTypes: ['today_cultivation', 'basic_tip', 'day_progress'],
    });
  }

  it('populates operationalOnboarding when stepId matches and raw is valid', () => {
    const raw = {
      responseVersion: '1.0',
      dashboard: 'Lotes em Produção',
      dashboardId: 'LOTE_PRODUCAO',
      cardType: 'lotes',
      confidence: 0.5,
      nextStepPrediction: {
        stepId: 'create_lot_with_protocol',
        confidence: 0.5,
        title: 'Criar lote',
        description: 'Crie seu primeiro lote',
        targetRoute: '/protocoloPage',
        actionLabel: 'Criar',
      },
      sectionAdaptations: [{
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: 'Test',
        description: 'Test',
      }],
      shortcuts: [{ route: '/lotePage', confidence: 0.5, label: 'Test', reason: 'Test' }],
      focus: { component: 'AdaptiveFocusBanner', message: 'Test', targetSectionId: 'recommended_actions', priority: 'high' },
      uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
      reason: 'Test reason',
      reasonDetails: { summary: 'Test', details: ['RULE-001'], display: 'info_icon' },
      rulesApplied: ['RULE-001', 'RULE-010'],
      infoRecommendation: {
        type: 'basic_tip',
        source: 'local_tip',
        priority: 'high',
        title: 'Dica operacional',
        reason: 'Há um próximo passo seguro para continuar o fluxo.',
        ctaRoute: '/protocoloPage',
        category: 'protocolo',
      },
      operationalOnboarding: {
        title: 'Custom Title from Gemini',
        message: 'Custom message',
        steps: ['Step 1', 'Step 2'],
        ctaLabel: 'Custom CTA',
        targetRoute: '/lotePage',
        reason: 'Custom reason from Gemini',
        priority: 30,
      },
    };

    const signals = {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/protocoloPage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const result = normalizeInstantResponse(raw, capabilities(), signals, {});
    expect(result.operationalOnboarding).not.toBeNull();
    expect(result.operationalOnboarding.title).toBe('Custom Title from Gemini');
    expect(result.operationalOnboarding.targetRoute).toBe('/areaCultivoPage');
    expect(result.operationalOnboarding.priority).toBe(30);
    expect(result.infoRecommendation).toBeNull();
  });

  it('sets operationalOnboarding to null when stepId does not match', () => {
    const raw = {
      responseVersion: '1.0',
      dashboard: 'Tarefas Pendentes',
      dashboardId: 'TAREFAS_PENDENTES',
      cardType: 'tarefas',
      confidence: 0.5,
      nextStepPrediction: {
        stepId: 'check_generated_activities',
        confidence: 0.5,
        title: 'Check',
        description: 'Check activities',
        targetRoute: '/agendaPage',
        actionLabel: 'Check',
      },
      sectionAdaptations: [{
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: 'Test',
        description: 'Test',
      }],
      shortcuts: [{ route: '/agendaPage', confidence: 0.5, label: 'Test', reason: 'Test' }],
      focus: { component: 'AdaptiveFocusBanner', message: 'Test', targetSectionId: 'recommended_actions', priority: 'high' },
      uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
      reason: 'Test',
      reasonDetails: { summary: 'Test', details: ['RULE-002'], display: 'info_icon' },
      rulesApplied: ['RULE-002', 'RULE-010'],
      operationalOnboarding: {
        title: 'Should be null',
        message: 'Should be null',
        steps: ['Step 1'],
        ctaLabel: 'CTA',
        targetRoute: '/lotePage',
        reason: 'Should be null',
        priority: 20,
      },
    };

    const signals = {
      stepId: 'check_generated_activities',
      targetRoute: '/agendaPage',
      rulesApplied: ['RULE-002', 'RULE-010'],
    };

    const result = normalizeInstantResponse(raw, capabilities(), signals, {});
    expect(result.operationalOnboarding).toBeNull();
  });

  it('sets operationalOnboarding to fallback when Gemini provides invalid data but stepId matches', () => {
    const raw = {
      responseVersion: '1.0',
      dashboard: 'Lotes em Produção',
      dashboardId: 'LOTE_PRODUCAO',
      cardType: 'lotes',
      confidence: 0.5,
      nextStepPrediction: {
        stepId: 'create_lot_with_protocol',
        confidence: 0.5,
        title: 'Criar lote',
        description: 'Crie seu primeiro lote',
        targetRoute: '/protocoloPage',
        actionLabel: 'Criar',
      },
      sectionAdaptations: [{
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: 'Test',
        description: 'Test',
      }],
      shortcuts: [{ route: '/lotePage', confidence: 0.5, label: 'Test', reason: 'Test' }],
      focus: { component: 'AdaptiveFocusBanner', message: 'Test', targetSectionId: 'recommended_actions', priority: 'high' },
      uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
      reason: 'Test',
      reasonDetails: { summary: 'Test', details: ['RULE-001'], display: 'info_icon' },
      rulesApplied: ['RULE-001', 'RULE-010'],
      operationalOnboarding: { title: '', message: '', steps: [], ctaLabel: '', targetRoute: '/badRoute', reason: '', priority: 0 },
    };

    const signals = {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/protocoloPage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const result = normalizeInstantResponse(raw, capabilities(), signals, {});
    // Should fall through to deterministic fallback
    expect(result.operationalOnboarding).not.toBeNull();
    expect(result.operationalOnboarding.title).toBe('Como começar');
    expect(result.operationalOnboarding.priority).toBe(20);
  });

  it('sets operationalOnboarding to null when clientCapabilities lacks the component', () => {
    const raw = {
      responseVersion: '1.0',
      dashboard: 'Lotes em Produção',
      dashboardId: 'LOTE_PRODUCAO',
      cardType: 'lotes',
      confidence: 0.5,
      nextStepPrediction: {
        stepId: 'create_lot_with_protocol',
        confidence: 0.5,
        title: 'Criar lote',
        description: 'Crie seu primeiro lote',
        targetRoute: '/protocoloPage',
        actionLabel: 'Criar',
      },
      sectionAdaptations: [{
        sectionId: 'recommended_actions',
        component: 'NextStepCard',
        priority: 'high',
        treatment: 'prominent',
        title: 'Test',
        description: 'Test',
      }],
      shortcuts: [{ route: '/lotePage', confidence: 0.5, label: 'Test', reason: 'Test' }],
      focus: { component: 'AdaptiveFocusBanner', message: 'Test', targetSectionId: 'recommended_actions', priority: 'high' },
      uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
      reason: 'Test',
      reasonDetails: { summary: 'Test', details: ['RULE-001'], display: 'info_icon' },
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const noCardCapabilities = normalizeClientCapabilities({
      supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'HomeInfoCard'],
      maxShortcuts: 3,
      maxSectionAdaptations: 4,
      supportedInfoTypes: ['today_cultivation', 'basic_tip'],
    });

    const signals = {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/protocoloPage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const result = normalizeInstantResponse(raw, noCardCapabilities, signals, {});
    expect(result.operationalOnboarding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 4 — fallback pipeline (buildEnhancedInstantFallback)
// ---------------------------------------------------------------------------

describe('buildEnhancedInstantFallback integration', () => {
  const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
  const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
  const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');

  function onboardingContext() {
    return normalizeOperationalContext({
      dashboardState: { hasActiveLots: false, hasProtocolLinkedToLatestLot: false },
      agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0 },
      testSequenceSignals: {},
    });
  }

  function continuityContext() {
    return normalizeOperationalContext({
      dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: true },
      agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 },
      fieldNotebookState: { hasRecentNotes: false, hasNutritionAdjustmentRecord: false },
      alertState: { hasCriticalAlerts: false, criticalCount: 0 },
      testSequenceSignals: {},
    });
  }

  function capabilities() {
    return normalizeClientCapabilities({
      supportedComponents: [
        'NextStepCard', 'AdaptiveFocusBanner',
        'OperationalOnboardingCard', 'HomeInfoCard',
      ],
      maxShortcuts: 3,
      maxSectionAdaptations: 4,
      supportedInfoTypes: ['basic_tip'],
    });
  }

  it('populates operationalOnboarding with fallback data when stepId matches', () => {
    const result = buildEnhancedInstantFallback({
      operationalContext: onboardingContext(),
      clientCapabilities: capabilities(),
    });

    expect(result.operationalOnboarding).not.toBeNull();
    expect(result.operationalOnboarding.title).toBe('Como começar');
    expect(result.operationalOnboarding.steps).toHaveLength(3);
    expect(result.operationalOnboarding.priority).toBe(20);
    expect(result.operationalOnboarding.targetRoute).toBe('/areaCultivoPage');
    expect(result.operationalOnboarding.recommendedActions).toBeUndefined();
    expect(result.infoRecommendation).toBeNull();
    expect(result.nextStepPrediction.targetRoute).toBe('/lotePage');
    expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/protocoloPage', '/areaCultivoPage']);
  });

  it('populates continuity operationalOnboarding with plan_next_lot data', () => {
    const result = buildEnhancedInstantFallback({
      operationalContext: continuityContext(),
      clientCapabilities: capabilities(),
    });

    expect(result.nextStepPrediction.stepId).toBe('plan_next_lot');
    expect(result.nextStepPrediction.targetRoute).toBe('/lotePage');
    expect(result.operationalOnboarding).toMatchObject({
      title: 'Planejar próximo lote',
      targetRoute: '/lotePage',
      ctaLabel: 'Planejar próximo lote',
      priority: 20,
    });
    expect(result.infoRecommendation).toBeNull();
    expect(result.shortcuts[0].route).toBe('/lotePage');
  });

  it('sets operationalOnboarding to null when clientCapabilities lacks the component', () => {
    const noCardCapabilities = normalizeClientCapabilities({
      supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner', 'HomeInfoCard'],
      maxShortcuts: 3,
      maxSectionAdaptations: 4,
      supportedInfoTypes: ['basic_tip'],
    });

    const result = buildEnhancedInstantFallback({
      operationalContext: onboardingContext(),
      clientCapabilities: noCardCapabilities,
    });

    expect(result.operationalOnboarding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 5 — finalizeValidInstantResponse passes through operationalOnboarding
// ---------------------------------------------------------------------------

describe('finalizeValidInstantResponse integration', () => {
  const { finalizeValidInstantResponse, sanitizeFinalInstantResponse } = require('../../src/instantResponseValidator');
  const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');

  function capabilities() {
    return normalizeClientCapabilities({
      supportedComponents: [
        'NextStepCard', 'AdaptiveFocusBanner',
        'OperationalOnboardingCard', 'HomeInfoCard',
      ],
      maxShortcuts: 3,
      maxSectionAdaptations: 4,
      supportedInfoTypes: ['today_cultivation', 'basic_tip'],
    });
  }

  const minimalValidResponse = {
    responseVersion: '1.0',
    dashboard: 'Lotes em Produção',
    dashboardId: 'LOTE_PRODUCAO',
    cardType: 'lotes',
    confidence: 0.6,
    nextStepPrediction: {
      stepId: 'create_lot_with_protocol',
      confidence: 0.6,
      title: 'Criar lote',
      description: 'Crie seu primeiro lote',
      targetRoute: '/lotePage',
      actionLabel: 'Criar',
    },
    sectionAdaptations: [{
      sectionId: 'recommended_actions',
      component: 'NextStepCard',
      priority: 'high',
      treatment: 'prominent',
      title: 'Test',
      description: 'Test',
    }],
    shortcuts: [
      { route: '/lotePage', confidence: 0.6, label: 'Criar primeiro lote', description: '', group: 'primary', reason: 'Test' },
      { route: '/protocoloPage', confidence: 0.5, label: 'Protocolo', description: '', group: 'secondary', reason: 'Test' },
      { route: '/areaCultivoPage', confidence: 0.4, label: 'Área', description: '', group: 'contextual', reason: 'Test' },
    ],
    focus: { component: 'AdaptiveFocusBanner', message: 'Test', targetSectionId: 'recommended_actions', priority: 'high' },
    uiTreatment: { density: 'comfortable', emphasis: 'moderate', animation: 'subtle', explanationVisibility: 'low', showProgressBar: false },
    reason: 'Test',
    reasonDetails: { summary: 'Test', details: ['RULE-001'], display: 'info_icon' },
    rulesApplied: ['RULE-001', 'RULE-010'],
    infoRecommendation: { type: 'basic_tip', source: 'local_tip', priority: 'low', title: 'Dica operacional', reason: 'Há um próximo passo seguro.', ctaRoute: '/protocoloPage', category: 'protocolo' },
  };

  it('preserves operationalOnboarding when it is populated', () => {
    const response = {
      ...minimalValidResponse,
      operationalOnboarding: {
        title: 'Como começar',
        message: 'Crie seu primeiro lote',
        steps: ['Cadastre', 'Crie', 'Acompanhe'],
        ctaLabel: 'Criar',
        targetRoute: '/areaCultivoPage',
        reason: 'Usuário sem lote ativo',
        priority: 20,
      },
    };

    const signals = {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/lotePage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const result = finalizeValidInstantResponse(response, capabilities(), signals);
    expect(result.operationalOnboarding).not.toBeNull();
    expect(result.operationalOnboarding.title).toBe('Como começar');
    expect(result.operationalOnboarding.priority).toBe(20);
    expect(result.operationalOnboarding.recommendedActions).toBeUndefined();
    expect(result.infoRecommendation).toBeNull();
    expect(result.nextStepPrediction.targetRoute).toBe('/lotePage');
    // Opção E: ensurePrimaryShortcut insere /lotePage como shortcuts[0]
    expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/lotePage', '/protocoloPage', '/areaCultivoPage']);
  });

  it('backfills canonical secondary shortcuts when only the primary create-lot shortcut remains', () => {
    const response = {
      ...minimalValidResponse,
      shortcuts: [
        { route: '/lotePage', confidence: 0.6, label: 'Criar primeiro lote', description: '', group: 'primary', reason: 'Test' },
      ],
      operationalOnboarding: {
        title: 'Como começar',
        message: 'Crie seu primeiro lote',
        steps: ['Cadastre', 'Crie', 'Acompanhe'],
        ctaLabel: 'Criar',
        targetRoute: '/areaCultivoPage',
        reason: 'Usuário sem lote ativo',
        priority: 20,
      },
    };

    const result = finalizeValidInstantResponse(response, capabilities(), {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/lotePage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    });

    expect(result.infoRecommendation).toBeNull();
    // Opção E: ensurePrimaryShortcut reinsere /lotePage após canonical backfill
    expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/lotePage', '/protocoloPage', '/areaCultivoPage']);
    expect(result.shortcuts).toHaveLength(3);
  });

  it('removes create-lot intent shortcuts by label before canonical backfill', () => {
    const response = {
      ...minimalValidResponse,
      shortcuts: [
        { route: '/protocoloPage', confidence: 0.6, label: 'Criar primeiro lote', description: '', group: 'secondary', reason: 'Criar primeiro lote' },
        { route: '/areaCultivoPage', confidence: 0.5, label: 'Área', description: '', group: 'contextual', reason: 'Configurar estrutura' },
      ],
      operationalOnboarding: {
        title: 'Como começar',
        message: 'Crie seu primeiro lote',
        steps: ['Cadastre', 'Crie', 'Acompanhe'],
        ctaLabel: 'Criar',
        targetRoute: '/areaCultivoPage',
        reason: 'Usuário sem lote ativo',
        priority: 20,
      },
    };

    const result = finalizeValidInstantResponse(response, capabilities(), {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/lotePage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    });

    // Opção E: ensurePrimaryShortcut insere /lotePage como shortcuts[0]
    expect(result.shortcuts.map((shortcut) => shortcut.route)).toEqual(['/lotePage', '/protocoloPage', '/areaCultivoPage']);
    expect(result.shortcuts[1].label).toBe('Ver protocolos de cultivo');
    expect(result.shortcuts[1].reason).not.toContain('Criar primeiro lote');
  });

  it('rejects final onboarding info slot when targetRoute is not areaCultivoPage', () => {
    const response = {
      ...minimalValidResponse,
      operationalOnboarding: {
        title: 'Como começar',
        message: 'Crie seu primeiro lote',
        steps: ['Cadastre', 'Crie', 'Acompanhe'],
        ctaLabel: 'Criar',
        targetRoute: '/areaCultivoPage',
        reason: 'Usuário sem lote ativo',
        priority: 20,
      },
    };
    const finalized = finalizeValidInstantResponse(response, capabilities(), {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/lotePage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    });
    const invalidCached = {
      ...finalized,
      operationalOnboarding: {
        ...finalized.operationalOnboarding,
        targetRoute: '/protocoloPage',
      },
    };

    expect(sanitizeFinalInstantResponse(invalidCached, capabilities())).toBeNull();
  });

  it('rejects stale cached final response with bad onboarding target and non-null infoRecommendation', () => {
    const response = {
      ...minimalValidResponse,
      operationalOnboarding: {
        title: 'Como começar',
        message: 'Crie seu primeiro lote',
        steps: ['Cadastre', 'Crie', 'Acompanhe'],
        ctaLabel: 'Criar',
        targetRoute: '/areaCultivoPage',
        reason: 'Usuário sem lote ativo',
        priority: 20,
      },
    };
    const finalized = finalizeValidInstantResponse(response, capabilities(), {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/lotePage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    });
    const invalidCached = {
      ...finalized,
      infoRecommendation: minimalValidResponse.infoRecommendation,
      operationalOnboarding: {
        ...finalized.operationalOnboarding,
        targetRoute: '/protocoloPage',
      },
    };

    expect(sanitizeFinalInstantResponse(invalidCached, capabilities())).toBeNull();
  });

  it('coerces undefined operationalOnboarding to null', () => {
    const response = { ...minimalValidResponse };
    delete response.operationalOnboarding;

    const signals = {
      stepId: 'create_lot_with_protocol',
      targetRoute: '/protocoloPage',
      rulesApplied: ['RULE-001', 'RULE-010'],
    };

    const result = finalizeValidInstantResponse(response, capabilities(), signals);
    expect(result.operationalOnboarding).toBeNull();
  });
});
