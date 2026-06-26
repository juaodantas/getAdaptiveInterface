const {
  buildInstantHistoryText,
  enrichInstantLoteShortcutsWithHistory,
  findRealLoteResourceFromInstantNavigations,
  normalizeInstantNavigation,
  resolveEffectiveSessionId,
  sanitizeShortcutRouteResource,
  validateShortcuts,
} = require('../../index.js');

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
});
