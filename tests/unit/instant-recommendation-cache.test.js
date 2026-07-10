const { normalizeClientCapabilities } = require('../../src/clientCapabilitiesValidator');
const { normalizeOperationalContext } = require('../../src/operationalContextValidator');
const { deriveInstantSignals } = require('../../src/instantDomainRules');
const {
  DEFAULT_TTL_MS,
  INSTANT_CACHE_PROMPT_VERSION,
  VOLATILE_TTL_MS,
  buildCacheEntry,
  buildCacheLookup,
  deriveCapabilityProfile,
  getWriteCacheability,
  isEntryUsable,
} = require('../../src/instantRecommendationCache');
const {
  COLLECTION_NAME,
  createInstantRecommendationCacheFirestoreAdapter,
} = require('../../src/instantRecommendationCacheFirestoreAdapter');

function context(overrides = {}) {
  return normalizeOperationalContext({
    dashboardState: { hasActiveLots: true, hasProtocolLinkedToLatestLot: true },
    agendaState: { hasGeneratedActivities: true, pendingActivitiesTodayCount: 2 },
    testSequenceSignals: { lotWithProtocolCreated: true, generatedActivitiesSeen: true, adjustmentRecorded: false },
    ...overrides,
  });
}

function capabilities(overrides = {}) {
  return normalizeClientCapabilities({
    supportedComponents: ['NextStepCard', 'AdaptiveFocusBanner'],
    maxShortcuts: 4,
    maxSectionAdaptations: 4,
    ...overrides,
  });
}

function lookupFor(operationalContext = context(), clientCapabilities = capabilities(), promptVersion = INSTANT_CACHE_PROMPT_VERSION) {
  const signals = deriveInstantSignals(operationalContext);
  return buildCacheLookup({ operationalContext, signals, clientCapabilities, promptVersion });
}

function recommendation(overrides = {}) {
  return {
    responseVersion: '1.0',
    mode: 'INSTANT',
    source: 'adaptive',
    dashboard: 'Tarefas Pendentes',
    dashboardId: 'TAREFAS_PENDENTES',
    cardType: 'tarefas',
    confidence: 0.84,
    nextStepPrediction: { stepId: 'review_field_notes', targetRoute: '/cadernoCampoPage' },
    sectionAdaptations: [{ component: 'NextStepCard' }],
    shortcuts: [{ route: '/agendaPage', confidence: 0.8 }],
    focus: { component: 'AdaptiveFocusBanner' },
    uiTreatment: { showProgressBar: false },
    reason: 'Contexto operacional compartilhado.',
    rulesApplied: ['RULE-010'],
    fallback: { used: false, reason: null },
    ...overrides,
  };
}

function firestoreMock({ failGet = false, failSet = false } = {}) {
  const docs = new Map();
  const writes = [];
  const db = {
    collection: jest.fn((name) => ({
      doc: jest.fn((id) => ({
        get: jest.fn(async () => {
          if (failGet) throw new Error('get_failed');
          return { exists: docs.has(id), data: () => docs.get(id) };
        }),
        set: jest.fn(async (data, options) => {
          if (failSet) throw new Error('set_failed');
          writes.push({ id, data, options });
          docs.set(id, { ...(docs.get(id) || {}), ...data });
        }),
      })),
    })),
  };
  const admin = {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        increment: jest.fn((value) => ({ increment: value })),
      },
    },
  };
  return { db, admin, docs, writes };
}

describe('instantRecommendationCache policy', () => {
  test('generates same key for equivalent context with different identity fields', () => {
    const first = lookupFor(context({ userId: 'user-a', sessionId: 'session-a' }));
    const second = lookupFor(context({ userId: 'user-b', sessionId: 'session-b' }));

    expect(first.cacheKey).toBe(second.cacheKey);
    expect(JSON.stringify(first.cacheKeyCanonical)).not.toContain('user-a');
    expect(JSON.stringify(first.cacheKeyCanonical)).not.toContain('session-a');
  });

  test('changes key for promptVersion, stepId, and contextProfile changes', () => {
    const base = lookupFor();
    const differentVersion = lookupFor(context(), capabilities(), 'instant-v2');
    const critical = lookupFor(context({ alertState: { hasCriticalAlerts: true, criticalCount: 1 } }));
    const finalStep = lookupFor(context({ testSequenceSignals: { finalHomeChecked: true } }));

    expect(differentVersion.cacheKey).not.toBe(base.cacheKey);
    expect(critical.cacheKey).not.toBe(base.cacheKey);
    expect(finalStep.cacheKey).not.toBe(base.cacheKey);
  });

  test('canonical excludes exact timestamps, ids, raw routes and free text', () => {
    const lookup = lookupFor(context({
      generatedAt: '2026-07-10T10:11:12Z',
      agendaState: { nextActivity: { id: 'task-123', title: 'Tarefa do João CPF 123', lotName: 'Lote Maria' } },
      testSequenceSignals: { changedAt: '2026-07-10T10:11:12Z', lastRelevantEvent: 'Evento livre' },
    }));
    const canonical = JSON.stringify(lookup.cacheKeyCanonical);

    expect(canonical).not.toContain('2026-07-10T10:11:12Z');
    expect(canonical).not.toContain('task-123');
    expect(canonical).not.toContain('João');
    expect(canonical).not.toContain('Maria');
    expect(canonical).not.toContain('CPF');
  });

  test('bypasses writes for fallback, low confidence, and unsafe text', () => {
    expect(getWriteCacheability(recommendation({ fallback: { used: true, reason: 'gemini_error' } }))).toEqual({ cacheable: false, reason: 'fallback_used' });
    expect(getWriteCacheability(recommendation({ confidence: 0.69 }))).toEqual({ cacheable: false, reason: 'low_confidence' });
    expect(getWriteCacheability(recommendation({ reason: 'Contato maria@example.com' }))).toEqual({ cacheable: false, reason: 'unsafe_text' });
  });

  test('detects stale entries and logical prompt version mismatch', () => {
    const lookup = lookupFor();
    const entry = buildCacheEntry({ lookup, recommendation: recommendation(), now: new Date('2026-07-10T00:00:00Z') }).entry;

    expect(isEntryUsable(entry, lookup, new Date('2026-07-10T01:00:00Z')).usable).toBe(true);
    expect(isEntryUsable(entry, lookup, new Date('2026-07-11T00:00:01Z'))).toEqual({ usable: false, reason: 'stale' });
    expect(isEntryUsable({ ...entry, promptVersion: 'instant-v0' }, lookup, new Date('2026-07-10T01:00:00Z'))).toEqual({ usable: false, reason: 'version_mismatch' });
  });

  test('uses volatile TTL for critical or overdue context and default TTL otherwise', () => {
    const stable = lookupFor();
    const volatile = lookupFor(context({ agendaState: { overdueActivitiesCount: 1 } }));

    expect(stable.ttlMs).toBe(DEFAULT_TTL_MS);
    expect(volatile.ttlMs).toBe(VOLATILE_TTL_MS);
  });

  test('capability profile only includes shape-affecting restrictions', () => {
    expect(deriveCapabilityProfile(capabilities({ supportsHighlightFrame: true }))).toBeNull();
    expect(deriveCapabilityProfile(capabilities({ maxShortcuts: 2 }))).toEqual({ maxShortcuts: 2 });
    expect(deriveCapabilityProfile(capabilities({ supportedInfoTypes: ['basic_tip'] }))).toEqual({ supportedInfoTypes: ['basic_tip'] });
  });
});

describe('instantRecommendationCache Firestore adapter', () => {
  test('sets document schema in instantRecommendationCache collection', async () => {
    const { db, admin, writes } = firestoreMock();
    const adapter = createInstantRecommendationCacheFirestoreAdapter(db, admin);
    const lookup = lookupFor();
    const entry = buildCacheEntry({ lookup, recommendation: recommendation() }).entry;

    const result = await adapter.set(entry);

    expect(result).toEqual({ ok: true });
    expect(db.collection).toHaveBeenCalledWith(COLLECTION_NAME);
    expect(writes[0].id).toBe(entry.cacheKey);
    expect(writes[0].options).toEqual({ merge: true });
    expect(writes[0].data).toMatchObject({
      cacheKey: entry.cacheKey,
      cacheKeyCanonical: entry.cacheKeyCanonical,
      promptVersion: INSTANT_CACHE_PROMPT_VERSION,
      mode: 'INSTANT',
      stepId: lookup.stepId,
      responseVersion: '1.0',
      recommendation: entry.recommendation,
      status: 'active',
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(JSON.stringify(writes[0].data)).not.toContain('userId');
    expect(JSON.stringify(writes[0].data)).not.toContain('sessionId');
  });

  test('returns read and write errors without throwing', async () => {
    const failingRead = createInstantRecommendationCacheFirestoreAdapter(firestoreMock({ failGet: true }).db);
    const failingWrite = createInstantRecommendationCacheFirestoreAdapter(firestoreMock({ failSet: true }).db);
    const lookup = lookupFor();

    await expect(failingRead.get(lookup.cacheKey)).resolves.toMatchObject({ ok: false });
    await expect(failingWrite.set(buildCacheEntry({ lookup, recommendation: recommendation() }).entry)).resolves.toMatchObject({ ok: false });
  });

  test('tolerates same-key writes and best-effort markHit', async () => {
    const mock = firestoreMock();
    const adapter = createInstantRecommendationCacheFirestoreAdapter(mock.db, mock.admin);
    const lookup = lookupFor();
    const entry = buildCacheEntry({ lookup, recommendation: recommendation() }).entry;

    await expect(Promise.all([adapter.set(entry), adapter.set(entry)])).resolves.toEqual([{ ok: true }, { ok: true }]);
    await expect(adapter.markHit(entry.cacheKey)).resolves.toEqual({ ok: true });
    expect(mock.writes.length).toBe(3);
    expect(mock.writes[2].data.stats.hitCount).toEqual({ increment: 1 });
  });
});
