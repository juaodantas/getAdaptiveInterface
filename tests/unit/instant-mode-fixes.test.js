const {
  buildInstantHistoryText,
  enrichInstantLoteShortcutsWithHistory,
  findRealLoteResourceFromInstantNavigations,
  normalizeInstantNavigation,
  resolveEffectiveSessionId,
  sanitizeShortcutRouteResource,
  validateShortcuts,
} = require('../../index.js');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const { buildEnhancedInstantFallback } = require('../../src/instantFallbackBuilder');
const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');

describe('Instant mode recommendation fixes', () => {
  describe('normalizeInstantNavigation', () => {
    test('uses screen, route, and targetScreen fallbacks', () => {
      expect(normalizeInstantNavigation({ screen: ' /lotePage ' })).toEqual({
        screen: '/lotePage',
      });
      expect(normalizeInstantNavigation({ route: ' /solucaoPage ' })).toEqual({
        screen: '/solucaoPage',
      });
      expect(normalizeInstantNavigation({ targetScreen: ' /agendaPage ' })).toEqual({
        screen: '/agendaPage',
      });
    });

    test('ignores missing or empty normalized screens', () => {
      expect(normalizeInstantNavigation({})).toBeNull();
      expect(normalizeInstantNavigation({ screen: ' ', route: '', targetScreen: '   ' })).toBeNull();
      expect(normalizeInstantNavigation(null)).toBeNull();
    });

    test('preserves non-empty navigation resource fields', () => {
      expect(normalizeInstantNavigation({
        route: '/lotePage',
        resourceId: ' 42 ',
        resourceType: ' lote ',
        resourceName: ' Alface ',
      })).toEqual({
        screen: '/lotePage',
        resourceId: '42',
        resourceType: 'lote',
        resourceName: 'Alface',
      });
    });
  });

  describe('buildInstantHistoryText', () => {
    test('includes deterministic frequency and resource details from navigations', () => {
      const normalizedNavigations = [
        { screen: '/lotePage', resourceId: '42', resourceType: 'lote', resourceName: 'Alface' },
        { screen: '/lotePage', resourceId: '42', resourceType: 'lote', resourceName: 'Alface' },
        { screen: '/agendaPage' },
      ];

      expect(buildInstantHistoryText(normalizedNavigations)).toBe(
        '/lotePage | visitas=2x | resources: lote#42 "Alface"\n/agendaPage | visitas=1x'
      );
    });
  });

  describe('resolveEffectiveSessionId', () => {
    test('uses request session id before user config session id', () => {
      expect(resolveEffectiveSessionId(' request-session ', { sessionId: 'config-session' }))
        .toBe('request-session');
    });

    test('uses user config session id when request session id is empty', () => {
      expect(resolveEffectiveSessionId(' ', { sessionId: ' config-session ' }))
        .toBe('config-session');
    });

    test('returns null when no non-empty session id is available', () => {
      expect(resolveEffectiveSessionId('', { sessionId: ' ' })).toBeNull();
      expect(resolveEffectiveSessionId(undefined, null)).toBeNull();
    });
  });

  describe('sanitizeShortcutRouteResource', () => {
    test('falls back unsafe lote route to area cultivo page', () => {
      expect(sanitizeShortcutRouteResource({ route: '/lotePage', confidence: 0.8 })).toEqual({
        route: '/areaCultivoPage',
        confidence: 0.8,
        resourceId: null,
        resourceType: null,
        resourceName: null,
      });
    });

    test('preserves valid lote route with real lote resource', () => {
      const shortcut = {
        route: '/lotePage',
        confidence: 0.8,
        resourceId: '42',
        resourceType: 'lote',
        resourceName: 'Alface',
      };

      expect(sanitizeShortcutRouteResource(shortcut)).toBe(shortcut);
    });

    test('validates all shortcuts after lote route safety', () => {
      const result = validateShortcuts([
        { route: '/lotePage', confidence: 0.9 },
        { route: '/lotePage', confidence: 0.8, resourceId: '42', resourceType: 'lote' },
        { route: '/areaCultivoPage', confidence: 0.7 },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].route).toBe('/areaCultivoPage');
      expect(result[1].route).toBe('/lotePage');
      expect(result[2].route).toBe('/areaCultivoPage');
    });
  });

  describe('enrichInstantLoteShortcutsWithHistory', () => {
    test('uses first normalized lote navigation order to enrich route-only lote shortcut', () => {
      const normalizedNavigations = [
        { screen: '/lotePage', resourceId: 'first-lote', resourceType: 'lote', resourceName: 'Primeiro' },
        { screen: '/lotePage', resourceId: 'second-lote', resourceType: 'lote', resourceName: 'Segundo' },
      ];
      const shortcuts = [{ route: '/lotePage', confidence: 0.9 }];

      expect(findRealLoteResourceFromInstantNavigations(normalizedNavigations)).toEqual({
        resourceId: 'first-lote',
        resourceType: 'lote',
        resourceName: 'Primeiro',
      });
      expect(enrichInstantLoteShortcutsWithHistory(shortcuts, normalizedNavigations)).toEqual([
        {
          route: '/lotePage',
          confidence: 0.9,
          resourceId: 'first-lote',
          resourceType: 'lote',
          resourceName: 'Primeiro',
        },
      ]);
    });

    test('enriched route-only lote shortcut is preserved by final validation', () => {
      const enriched = enrichInstantLoteShortcutsWithHistory(
        [{ route: '/lotePage', confidence: 0.9 }],
        [{ screen: '/lotePage', resourceId: '42', resourceType: 'lote' }]
      );

      expect(validateShortcuts(enriched)).toEqual([
        { route: '/lotePage', confidence: 0.9, resourceId: '42', resourceType: 'lote' },
      ]);
    });

    test('route-only lote shortcut without real lote history still falls back to area cultivo page', () => {
      const enriched = enrichInstantLoteShortcutsWithHistory(
        [{ route: '/lotePage', confidence: 0.9 }],
        [
          { screen: '/lotePage', resourceId: '42', resourceType: 'setor' },
          { screen: '/areaCultivoPage' },
        ]
      );

      expect(validateShortcuts(enriched)).toEqual([
        {
          route: '/areaCultivoPage',
          confidence: 0.9,
          resourceId: null,
          resourceType: null,
          resourceName: null,
        },
      ]);
    });
  });

  describe('plan_next_lot priority', () => {
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

    test('returns plan_next_lot for active lot with protocol and no urgencies', () => {
      const result = deriveInstantSignals(continuityContext());

      expect(result.stepId).toBe('plan_next_lot');
      expect(result.targetRoute).toBe('/lotePage');
      expect(result.rulesApplied).toContain('RULE-016');
    });

    test('fallback does not return plan_next_lot when client lacks OperationalOnboardingCard', () => {
      const response = buildEnhancedInstantFallback({
        operationalContext: continuityContext(),
        clientCapabilities: normalizeClientCapabilities({
          supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner'],
          maxShortcuts: 3,
          maxSectionAdaptations: 4,
        }),
        reason: 'test',
      });

      expect(response.nextStepPrediction.stepId).toBe('check_generated_activities');
      expect(response.nextStepPrediction.stepId).not.toBe('plan_next_lot');
      expect(response.nextStepPrediction.targetRoute).toBe('/agendaPage');
      expect(response.operationalOnboarding).toBeNull();
      expect(response.rulesApplied).not.toContain('RULE-016');
    });

    test('critical alerts take priority over plan_next_lot', () => {
      const result = deriveInstantSignals(continuityContext({
        alertState: { hasCriticalAlerts: true, criticalCount: 1 },
      }));

      expect(result.stepId).toBe('review_critical_alerts');
    });

    test('overdue tasks take priority over plan_next_lot', () => {
      const result = deriveInstantSignals(continuityContext({
        agendaState: { hasGeneratedActivities: false, overdueActivitiesCount: 1 },
      }));

      expect(result.stepId).toBe('resolve_overdue_tasks');
    });

    test('today tasks take priority over plan_next_lot', () => {
      const result = deriveInstantSignals(continuityContext({
        agendaState: { hasGeneratedActivities: false, pendingActivitiesTodayCount: 1 },
      }));

      expect(result.stepId).toBe('review_today_tasks');
    });

    test.each([
      ['future due label', { nextActivityStatus: 'pending', nextActivityDueLabel: 'tomorrow' }],
      ['missing due label', { nextActivityStatus: 'pending' }],
    ])('does not block plan_next_lot for pending next activity with %s', (_, agendaState) => {
      const result = deriveInstantSignals(continuityContext({
        agendaState: {
          hasGeneratedActivities: false,
          pendingActivitiesTodayCount: 0,
          overdueActivitiesCount: 0,
          ...agendaState,
        },
      }));

      expect(result.stepId).toBe('plan_next_lot');
      expect(result.rulesApplied).toContain('RULE-016');
    });
  });

  describe('active lot protocol evidence', () => {
    function firstHomeContext(overrides = {}) {
      return normalizeOperationalContext({
        dashboardState: {
          hasActiveLots: true,
          activeLotsCount: 1,
          hasProtocolLinkedToLatestLot: false,
        },
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

    test('normalizes optional protocol evidence fields defensively', () => {
      const context = normalizeOperationalContext({
        dashboardState: {
          hasProtocolLinkedToActiveLot: true,
          latestLotProtocolId: ' latest-protocol ',
          selectedLotProtocolId: ' selected-protocol ',
          activeLotProtocolIds: [' one ', '', 'two', 'x'.repeat(100)],
        },
      });

      expect(context.dashboardState.hasProtocolLinkedToActiveLot).toBe(true);
      expect(context.dashboardState.latestLotProtocolId).toBe('latest-protocol');
      expect(context.dashboardState.selectedLotProtocolId).toBe('selected-protocol');
      expect(context.dashboardState.activeLotProtocolIds).toEqual(['one', 'two', 'x'.repeat(80)]);
    });

    test.each([
      ['active lot protocol flag', { dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: false, hasProtocolLinkedToActiveLot: true } }],
      ['latest lot protocol id', { dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: false, latestLotProtocolId: 'protocol-1' } }],
      ['active lot protocol id', { dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: false, activeLotProtocolIds: ['protocol-1'] } }],
      ['selected lot protocol id', { dashboardState: { hasActiveLots: true, activeLotsCount: 1, hasProtocolLinkedToLatestLot: false, selectedLotProtocolId: 'protocol-1' } }],
      ['protocol tasks', { agendaState: { hasGeneratedActivities: false, hasProtocolTasks: true, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 } }],
      ['next protocol activity', { agendaState: { hasGeneratedActivities: false, nextActivityType: 'protocol_activity', pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 } }],
      ['test sequence lot with protocol', { testSequenceSignals: { lotWithProtocolCreated: true } }],
      ['generated activities with active lot', { agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 0, overdueActivitiesCount: 0 } }],
    ])('does not recommend first lot onboarding when evidence is %s', (_, overrides) => {
      const result = deriveInstantSignals(firstHomeContext(overrides));

      expect(result.stepId).not.toBe('create_lot_with_protocol');
      expect(result.rulesApplied).not.toContain('RULE-001');
    });

    test('keeps first lot onboarding for active lot without protocol evidence', () => {
      const result = deriveInstantSignals(firstHomeContext());

      expect(result.stepId).toBe('create_lot_with_protocol');
      expect(result.rulesApplied).toContain('RULE-001');
    });
  });
});
