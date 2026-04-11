const {
  filterExcludedPages,
  validateShortcutResource,
  validateShortcuts,
  normalizeRecommendation,
} = require('../../index.js');

describe('Shortcut Validation Tests', () => {
  describe('filterExcludedPages', () => {
    test('should remove excluded pages from shortcuts', () => {
      const shortcuts = [
        { route: '/lotePage', confidence: 0.8 },
        { route: '/loginPage', confidence: 0.7 },
        { route: '/solucaoPage', confidence: 0.6 },
        { route: '/splashPage', confidence: 0.5 },
      ];

      const result = filterExcludedPages(shortcuts);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.route)).toEqual(['/lotePage', '/solucaoPage']);
    });

    test('should return all shortcuts if none are excluded', () => {
      const shortcuts = [
        { route: '/agendaPage', confidence: 0.8 },
        { route: '/gerenciarEquipePage', confidence: 0.7 },
      ];

      const result = filterExcludedPages(shortcuts);

      expect(result).toHaveLength(2);
      expect(result).toEqual(shortcuts);
    });

    test('should handle empty shortcuts array', () => {
      const result = filterExcludedPages([]);
      expect(result).toHaveLength(0);
    });

    test('should handle shortcuts with missing route', () => {
      const shortcuts = [
        { confidence: 0.8 },
        { route: '/lotePage', confidence: 0.7 },
      ];

      const result = filterExcludedPages(shortcuts);
      expect(result).toHaveLength(2);
    });
  });

  describe('validateShortcutResource', () => {
    test('should validate shortcuts with resource requirements', () => {
      const validShortcut = {
        route: '/lotePage',
        confidence: 0.8,
        resourceId: '123',
        resourceType: 'lote',
      };

      expect(validateShortcutResource(validShortcut)).toBe(true);
    });

    test('should reject shortcuts without required resourceId', () => {
      const invalidShortcut = {
        route: '/setorPage',
        confidence: 0.8,
      };

      expect(validateShortcutResource(invalidShortcut)).toBe(false);
    });

    test('should reject shortcuts with empty resourceId', () => {
      const invalidShortcut = {
        route: '/solucaoPage',
        confidence: 0.8,
        resourceId: '',
        resourceType: 'solucao',
      };

      expect(validateShortcutResource(invalidShortcut)).toBe(false);
    });

    test('should reject shortcuts with empty resourceType', () => {
      const invalidShortcut = {
        route: '/reservatoriosPage',
        confidence: 0.8,
        resourceId: '456',
        resourceType: null,
      };

      expect(validateShortcutResource(invalidShortcut)).toBe(false);
    });

    test('should allow shortcuts without resource for non-required pages', () => {
      const shortcut = {
        route: '/agendaPage',
        confidence: 0.8,
      };

      expect(validateShortcutResource(shortcut)).toBe(true);
    });

    test('should allow shortcuts with resource for non-required pages', () => {
      const shortcut = {
        route: '/agendaPage',
        confidence: 0.8,
        resourceId: '789',
        resourceType: 'tarefa',
      };

      expect(validateShortcutResource(shortcut)).toBe(true);
    });
  });

  describe('validateShortcuts', () => {
    test('should apply both exclusion and resource validation', () => {
      const shortcuts = [
        { route: '/loginPage', confidence: 0.9 },
        { route: '/lotePage', confidence: 0.8, resourceId: '123', resourceType: 'lote' },
        { route: '/setorPage', confidence: 0.7 },
        { route: '/agendaPage', confidence: 0.6 },
        { route: '/homePage', confidence: 0.5 },
        { route: '/solucaoPage', confidence: 0.4, resourceId: '456', resourceType: 'solucao' },
      ];

      const result = validateShortcuts(shortcuts);

      expect(result).toHaveLength(3);
      const routes = result.map((s) => s.route);
      expect(routes).toContain('/lotePage');
      expect(routes).toContain('/agendaPage');
      expect(routes).toContain('/solucaoPage');
      expect(routes).not.toContain('/loginPage');
      expect(routes).not.toContain('/setorPage');
      expect(routes).not.toContain('/homePage');
    });

    test('should return empty array if all shortcuts are invalid', () => {
      const shortcuts = [
        { route: '/loginPage', confidence: 0.9 },
        { route: '/setorPage', confidence: 0.8 },
        { route: '/splashPage', confidence: 0.7 },
      ];

      const result = validateShortcuts(shortcuts);
      expect(result).toHaveLength(0);
    });
  });

  describe('normalizeRecommendation with validation', () => {
    test('should normalize and validate shortcuts correctly', () => {
      const rawRecommendation = {
        dashboard: 'Lotes em Produção',
        dashboardId: 'LOTE_PRODUCAO',
        cardType: 'lotes',
        confidence: 0.85,
        shortcuts: [
          { route: '/lotePage', confidence: 0.9, resourceId: '10', resourceType: 'lote' },
          { route: '/loginPage', confidence: 0.8 },
          { route: '/setorPage', confidence: 0.7, resourceId: '20', resourceType: 'setor' },
          { route: '/solucaoPage', confidence: 0.6 },
        ],
      };

      const result = normalizeRecommendation(rawRecommendation);

      expect(result.dashboard).toBe('Lotes em Produção');
      expect(result.shortcuts).toHaveLength(2);
      const routes = result.shortcuts.map((s) => s.route);
      expect(routes).toContain('/lotePage');
      expect(routes).toContain('/setorPage');
      expect(routes).not.toContain('/loginPage');
      expect(routes).not.toContain('/solucaoPage');
    });

    test('should handle raw recommendation without shortcuts', () => {
      const rawRecommendation = {
        dashboard: 'Tarefas Pendentes',
        dashboardId: 'TAREFAS_PENDENTES',
        cardType: 'tarefas',
        confidence: 0.7,
      };

      const result = normalizeRecommendation(rawRecommendation);
      expect(result.shortcuts).toHaveLength(0);
    });

    test('should return normalized structure with null dashboard if invalid', () => {
      const rawRecommendation = {
        dashboard: 'Dashboard Inexistente',
        confidence: 0.5,
        shortcuts: [
          { route: '/lotePage', confidence: 0.8, resourceId: '1', resourceType: 'lote' },
          { route: '/cadastroPage', confidence: 0.7 },
        ],
      };

      const result = normalizeRecommendation(rawRecommendation);

      expect(result.dashboard).toBeNull();
      expect(result.dashboardId).toBeNull();
      expect(result.cardType).toBeNull();
      expect(result.confidence).toBe(0.0);
      expect(result.shortcuts).toHaveLength(1);
      expect(result.shortcuts[0].route).toBe('/lotePage');
    });
  });
});
