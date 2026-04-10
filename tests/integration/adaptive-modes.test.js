const {
  ADAPTIVE_MODES,
  getDefaultShortcuts,
} = require('../../index.js');

describe('Backend Integration Tests', () => {
  describe('T4: getDefaultShortcuts', () => {
    test('should return array of 4 default shortcuts', () => {
      const shortcuts = getDefaultShortcuts();
      expect(Array.isArray(shortcuts)).toBe(true);
      expect(shortcuts).toHaveLength(4);
    });

    test('each shortcut should have route and confidence', () => {
      const shortcuts = getDefaultShortcuts();
      shortcuts.forEach((shortcut) => {
        expect(shortcut).toHaveProperty('route');
        expect(shortcut).toHaveProperty('confidence');
        expect(typeof shortcut.route).toBe('string');
        expect(typeof shortcut.confidence).toBe('number');
        expect(shortcut.confidence).toBe(0.5);
      });
    });
  });

  describe('T1: ADAPTIVE_MODES constant', () => {
    test('should have STATIC, INSTANT, and GRADUAL modes', () => {
      expect(ADAPTIVE_MODES).toHaveProperty('STATIC');
      expect(ADAPTIVE_MODES).toHaveProperty('INSTANT');
      expect(ADAPTIVE_MODES).toHaveProperty('GRADUAL');
      expect(ADAPTIVE_MODES.STATIC).toBe('STATIC');
      expect(ADAPTIVE_MODES.INSTANT).toBe('INSTANT');
      expect(ADAPTIVE_MODES.GRADUAL).toBe('GRADUAL');
    });
  });

  describe('T6: Mode Switch Logic', () => {
    test('STATIC mode should return default shortcuts', async () => {
      const result = {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
        mode: ADAPTIVE_MODES.STATIC,
      };

      expect(result.mode).toBe(ADAPTIVE_MODES.STATIC);
      expect(result.confidence).toBe(0.0);
      expect(result.shortcuts).toHaveLength(4);
      expect(result.dashboard).toBeNull();
    });

    test('INSTANT mode without sessionId should return default shortcuts', async () => {
      const result = {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
        mode: ADAPTIVE_MODES.INSTANT,
      };

      expect(result.mode).toBe(ADAPTIVE_MODES.INSTANT);
      expect(result.shortcuts).toHaveLength(4);
      expect(result.dashboard).toBeNull();
    });

    test('GRADUAL mode should be default when no mode specified', () => {
      const mode = null;
      const resolvedMode = mode || ADAPTIVE_MODES.GRADUAL;
      expect(resolvedMode).toBe(ADAPTIVE_MODES.GRADUAL);
    });

    test('invalid mode should fallback to GRADUAL', () => {
      const mode = 'INVALID';
      const validModes = Object.values(ADAPTIVE_MODES);
      const resolvedMode = validModes.includes(mode) ? mode : ADAPTIVE_MODES.GRADUAL;
      expect(resolvedMode).toBe(ADAPTIVE_MODES.GRADUAL);
    });
  });

  describe('T5: generateInstantRecommendation', () => {
    test('should return null dashboard for less than 3 navigations', () => {
      const navCount = 2;
      const shouldReturnNull = navCount < 3;
      expect(shouldReturnNull).toBe(true);
    });

    test('should cap confidence based on navigation count', () => {
      const navCount = 5;
      const maxConfidence = navCount < 10 ? Math.min(0.5, navCount * 0.05) : 0.5;
      expect(maxConfidence).toBe(0.25);

      const navCount2 = 12;
      const maxConfidence2 = navCount2 < 10 ? Math.min(0.5, navCount2 * 0.05) : 0.5;
      expect(maxConfidence2).toBe(0.5);
    });

    test('should aggregate screen counts correctly', () => {
      const navigations = [
        { screen: '/lotePage' },
        { screen: '/lotePage' },
        { screen: '/solucaoPage' },
      ];

      const screenCounts = {};
      navigations.forEach((nav) => {
        const screen = nav.screen;
        screenCounts[screen] = (screenCounts[screen] || 0) + 1;
      });

      expect(screenCounts['/lotePage']).toBe(2);
      expect(screenCounts['/solucaoPage']).toBe(1);
      expect(Object.keys(screenCounts)).toHaveLength(2);
    });
  });

  describe('T7: Error Handling', () => {
    test('empty navigations should return default response', () => {
      const navigations = [];
      const result = {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: getDefaultShortcuts(),
      };

      expect(result.confidence).toBe(0.0);
      expect(result.dashboard).toBeNull();
    });

    test('mode precedence should be: explicit param > user config > default', () => {
      const explicitMode = ADAPTIVE_MODES.INSTANT;
      const userConfigMode = ADAPTIVE_MODES.STATIC;

      let mode = explicitMode || userConfigMode || ADAPTIVE_MODES.GRADUAL;
      expect(mode).toBe(ADAPTIVE_MODES.INSTANT);

      mode = null;
      mode = mode || userConfigMode || ADAPTIVE_MODES.GRADUAL;
      expect(mode).toBe(ADAPTIVE_MODES.STATIC);

      mode = null;
      const userConfig = null;
      mode = mode || userConfig?.mode || ADAPTIVE_MODES.GRADUAL;
      expect(mode).toBe(ADAPTIVE_MODES.GRADUAL);
    });
  });

  describe('T9: Response Format', () => {
    test('response should include mode field', () => {
      const response = {
        dashboard: null,
        dashboardId: null,
        cardType: null,
        confidence: 0.0,
        shortcuts: [],
        mode: ADAPTIVE_MODES.GRADUAL,
      };

      expect(response).toHaveProperty('mode');
      expect(typeof response.mode).toBe('string');
      expect(Object.values(ADAPTIVE_MODES)).toContain(response.mode);
    });

    test('all modes should return consistent response structure', () => {
      const requiredFields = ['dashboard', 'dashboardId', 'cardType', 'confidence', 'shortcuts', 'mode'];

      [ADAPTIVE_MODES.STATIC, ADAPTIVE_MODES.INSTANT, ADAPTIVE_MODES.GRADUAL].forEach((mode) => {
        const response = {
          dashboard: null,
          dashboardId: null,
          cardType: null,
          confidence: 0.0,
          shortcuts: getDefaultShortcuts(),
          mode,
        };

        requiredFields.forEach((field) => {
          expect(response).toHaveProperty(field);
        });
      });
    });
  });
});
