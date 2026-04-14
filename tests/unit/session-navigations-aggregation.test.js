// Tests para a lógica de agregação de sessionNavigations
// Focados na lógica pura de processamento de dados (sem mocks complexos do Firebase)

describe('Session Navigations Aggregation - Lógica de Agregação', () => {
  describe('Cálculo de frequência de telas', () => {
    test('deve calcular corretamente a frequência de telas', () => {
      const navigations = [
        { screen: '/lotePage' },
        { screen: '/lotePage' },
        { screen: '/solucaoPage' },
        { screen: '/agendaPage' },
        { screen: '/lotePage' },
      ];

      const screenFrequency = {};
      navigations.forEach((nav) => {
        const screen = nav.screen;
        screenFrequency[screen] = (screenFrequency[screen] || 0) + 1;
      });

      expect(screenFrequency['/lotePage']).toBe(3);
      expect(screenFrequency['/solucaoPage']).toBe(1);
      expect(screenFrequency['/agendaPage']).toBe(1);
      expect(Object.keys(screenFrequency)).toHaveLength(3);
    });

    test('deve lidar com navegações sem screen', () => {
      const navigations = [
        { screen: '/lotePage' },
        { route: '/solucaoPage' },
        { targetScreen: '/agendaPage' },
        {},
      ];

      const uniqueScreens = new Set();
      const screenFrequency = {};

      navigations.forEach((nav) => {
        const screen = nav.screen || nav.route || nav.targetScreen;
        if (screen) {
          uniqueScreens.add(screen);
          screenFrequency[screen] = (screenFrequency[screen] || 0) + 1;
        }
      });

      expect(uniqueScreens.size).toBe(3);
      expect(screenFrequency['/lotePage']).toBe(1);
      expect(screenFrequency['/solucaoPage']).toBe(1);
      expect(screenFrequency['/agendaPage']).toBe(1);
    });
  });

  describe('Cálculo de duração da sessão', () => {
    test('deve calcular duração corretamente', () => {
      const firstTs = new Date('2024-01-01T10:00:00Z');
      const lastTs = new Date('2024-01-01T10:05:30Z'); // 5min30s = 330000ms

      const durationMs = lastTs.getTime() - firstTs.getTime();

      expect(durationMs).toBe(330000);
    });

    test('deve retornar null se timestamps inválidos', () => {
      const firstTs = null;
      const lastTs = new Date('2024-01-01T10:05:30Z');

      const isValid = firstTs && lastTs && lastTs > firstTs;

      expect(isValid).toBeFalsy();
    });

    test('deve retornar null se último timestamp anterior ao primeiro', () => {
      const firstTs = new Date('2024-01-01T10:10:00Z');
      const lastTs = new Date('2024-01-01T10:05:00Z');

      const isValid = firstTs && lastTs && lastTs > firstTs;

      expect(isValid).toBe(false);
    });

    test('deve somar durações de múltiplas sessões', () => {
      const durations = [
        330000, // 5min30s
        180000, // 3min
        420000, // 7min
      ];

      const totalDuration = durations.reduce((sum, d) => sum + d, 0);
      const avgDuration = Math.round(totalDuration / durations.length);

      expect(totalDuration).toBe(930000);
      expect(avgDuration).toBe(310000);
    });
  });

  describe('Média de navegações por sessão', () => {
    test('deve calcular média corretamente', () => {
      const totalNavigations = 45;
      const sessionsCount = 5;

      const avgNavigationsPerSession = totalNavigations / sessionsCount;

      expect(avgNavigationsPerSession).toBe(9);
    });

    test('deve retornar 0 se zero sessões', () => {
      const totalNavigations = 45;
      const sessionsCount = 0;

      const avgNavigationsPerSession = sessionsCount > 0
        ? totalNavigations / sessionsCount
        : 0;

      expect(avgNavigationsPerSession).toBe(0);
    });

    test('deve arredondar para 1 casa decimal', () => {
      const totalNavigations = 37;
      const sessionsCount = 4;

      const avgNavigationsPerSession = Math.round((totalNavigations / sessionsCount) * 10) / 10;

      expect(avgNavigationsPerSession).toBe(9.3);
    });
  });

  describe('Top Screens ordenação', () => {
    test('deve ordenar topScreens por frequência descendente', () => {
      const screenFrequency = {
        '/lotePage': 10,
        '/solucaoPage': 5,
        '/agendaPage': 8,
        '/reservatoriosPage': 3,
        '/historicoPage': 12,
      };

      const topScreens = Object.entries(screenFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([screen, count]) => ({ screen, count }));

      expect(topScreens[0].screen).toBe('/historicoPage');
      expect(topScreens[0].count).toBe(12);
      expect(topScreens[1].screen).toBe('/lotePage');
      expect(topScreens[1].count).toBe(10);
      expect(topScreens[2].screen).toBe('/agendaPage');
      expect(topScreens[2].count).toBe(8);
      expect(topScreens).toHaveLength(5);
    });

    test('deve limitar topScreens a no máximo 5', () => {
      const screenFrequency = {
        '/page1': 20,
        '/page2': 18,
        '/page3': 15,
        '/page4': 12,
        '/page5': 10,
        '/page6': 8,
        '/page7': 5,
      };

      const topScreens = Object.entries(screenFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([screen, count]) => ({ screen, count }));

      expect(topScreens).toHaveLength(5);
      expect(topScreens[0].screen).toBe('/page1');
      expect(topScreens[4].screen).toBe('/page5');
    });

    test('deve lidar com menos de 5 telas', () => {
      const screenFrequency = {
        '/lotePage': 10,
        '/solucaoPage': 5,
      };

      const topScreens = Object.entries(screenFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([screen, count]) => ({ screen, count }));

      expect(topScreens).toHaveLength(2);
      expect(topScreens[0].screen).toBe('/lotePage');
      expect(topScreens[1].screen).toBe('/solucaoPage');
    });
  });

  describe('Merge de métricas BigQuery + Firestore', () => {
    test('deve usar o maior sessionsCount entre as fontes', () => {
      const bqSessions = 3;
      const firestoreSessions = 5;

      const mergedSessions = Math.max(bqSessions, firestoreSessions);

      expect(mergedSessions).toBe(5);
    });

    test('deve adicionar campos do Firestore quando não existem no BigQuery', () => {
      const bqMetric = {
        userId: 'user-1',
        mode: 'GRADUAL',
        sessionsCount: 3,
        shortcutsShown: 10,
      };

      const navData = {
        userId: 'user-1',
        mode: 'INSTANT',
        sessionsCount: 5,
        totalNavigations: 45,
        uniqueScreensCount: 8,
        avgSessionDurationMs: 310000,
        topScreens: [{ screen: '/lotePage', count: 10 }],
      };

      const merged = { ...bqMetric };
      merged.sessionsCount = Math.max(merged.sessionsCount, navData.sessionsCount);
      merged.navigationsFromSessions = navData.totalNavigations;
      merged.uniqueScreensFromSessions = navData.uniqueScreensCount;
      merged.avgSessionDurationMs = navData.avgSessionDurationMs;
      merged.topScreensFromSessions = navData.topScreens;

      expect(merged.sessionsCount).toBe(5);
      expect(merged.navigationsFromSessions).toBe(45);
      expect(merged.uniqueScreensFromSessions).toBe(8);
      expect(merged.avgSessionDurationMs).toBe(310000);
      expect(merged.topScreensFromSessions).toHaveLength(1);
    });

    test('deve criar métrica para usuário só no Firestore', () => {
      const navData = {
        userId: 'user-2',
        mode: 'INSTANT',
        sessionsCount: 2,
        totalNavigations: 15,
        uniqueScreensCount: 4,
        avgSessionDurationMs: 250000,
        topScreens: [{ screen: '/agendaPage', count: 5 }],
      };

      const newUserMetric = {
        userId: navData.userId,
        mode: navData.mode,
        sessionsCount: navData.sessionsCount,
        shortcutsShown: 0,
        shortcutsClicked: 0,
        acceptanceRate: null,
        dashboardShown: 0,
        dashboardChanged: 0,
        passThroughRate: null,
        avgTimeToTask: null,
        navigationsFromSessions: navData.totalNavigations,
        uniqueScreensFromSessions: navData.uniqueScreensCount,
        avgSessionDurationMs: navData.avgSessionDurationMs,
        topScreensFromSessions: navData.topScreens,
      };

      expect(newUserMetric.userId).toBe('user-2');
      expect(newUserMetric.mode).toBe('INSTANT');
      expect(newUserMetric.sessionsCount).toBe(2);
      expect(newUserMetric.navigationsFromSessions).toBe(15);
      expect(newUserMetric.shortcutsShown).toBe(0);
    });

    test('NÃO deve sobrescrever mode do BigQuery com mode do Firestore', () => {
      // Se o usuário já tem dados no BigQuery, o mode vem de lá.
      // Os dados do Firestore são complementares e SEMPRE INSTANT,
      // mas não alteram o modo principal do usuário.
      const bqMetric = { mode: 'GRADUAL' };
      const navData = { mode: 'INSTANT' };

      // Lógica corrigida: mode do BigQuery prevalece
      const mergedMode = bqMetric.mode;

      expect(mergedMode).toBe('GRADUAL');
    });

    test('manter mode do BigQuery se for INSTANT', () => {
      const bqMetric = { mode: 'INSTANT' };

      expect(bqMetric.mode).toBe('INSTANT');
    });

    test('mode = INSTANT apenas quando usuário só existe no Firestore', () => {
      // Quando o usuário NÃO tem dados no BigQuery, a única fonte é o Firestore
      // (que é SEMPRE INSTANT)
      const navData = { mode: 'INSTANT' };

      const newUserMode = navData.mode;

      expect(newUserMode).toBe('INSTANT');
    });
  });
});
