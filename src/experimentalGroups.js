const { ADAPTIVE_MODES } = require('./adaptiveContract');

const EXPERIMENTS_COLLECTION = 'experimentalGroups';
const USER_CONFIG_COLLECTION = 'userAdaptiveConfig';
const SESSION_NAVIGATIONS_COLLECTION = 'sessionNavigations';

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function formatParticipantId(index) {
  return `P${String(index).padStart(3, '0')}`;
}

function participantIndex(participantId) {
  const match = typeof participantId === 'string' ? participantId.match(/^P(\d+)$/) : null;
  return match ? Number(match[1]) : 0;
}

function nextGlobalAssignmentIndex(experiment) {
  const participants = Array.isArray(experiment.participants) ? experiment.participants : [];
  const highestParticipantIndex = participants.reduce((highest, participant) => (
    Math.max(highest, participantIndex(participant?.participantId))
  ), 0);
  return Math.max(Number(experiment.assignmentIndex) || 0, highestParticipantIndex);
}

function generateSessionId(participantId, condition, period, date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${participantId}_${condition}_P${period}_${stamp}`;
}

function fail(message) {
  const error = new Error(message);
  error.isValidationError = true;
  throw error;
}

function validateGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    fail('groups deve conter ao menos um grupo');
  }

  const groupIds = new Set();
  groups.forEach((group) => {
    const groupId = normalizeString(group?.groupId);
    if (!groupId) fail('Cada grupo precisa de groupId');
    if (groupIds.has(groupId)) fail(`groupId duplicado: ${groupId}`);
    groupIds.add(groupId);

    if (!Array.isArray(group.conditions) || group.conditions.length === 0) {
      fail(`Grupo ${groupId} precisa de conditions`);
    }

    group.conditions.forEach((condition) => {
      const period = normalizePositiveInteger(condition?.period);
      if (!period) fail(`Condição inválida no grupo ${groupId}: period obrigatório`);
      if (!Object.values(ADAPTIVE_MODES).includes(condition.mode)) {
        fail(`Condição inválida no grupo ${groupId}: mode inválido`);
      }
    });
  });
}

function validateExperimentPayload(payload, isUpdate = false) {
  const experimentId = normalizeString(payload.experimentId || payload.id);
  if (!experimentId) fail('experimentId é obrigatório');
  if (!isUpdate || payload.groups !== undefined) validateGroups(payload.groups);

  const strategy = payload.assignmentStrategy || 'roundRobin';
  if (strategy !== 'roundRobin') fail('assignmentStrategy suportado: roundRobin');

  return experimentId;
}

function findGroup(experiment, groupId) {
  return (experiment.groups || []).find((group) => group.groupId === groupId) || null;
}

function findCondition(group, period) {
  return (group.conditions || []).find((condition) => Number(condition.period) === Number(period)) || null;
}

function buildUserConfig({ userId, experiment, group, participantId, period, admin, now }) {
  const condition = findCondition(group, period);
  if (!condition) fail(`Grupo ${group.groupId} não possui condição para período ${period}`);

  const mode = condition.mode;
  const sessionId = mode === ADAPTIVE_MODES.INSTANT
    ? generateSessionId(participantId, mode, period)
    : null;

  return {
    userId: String(userId),
    mode,
    experimentId: experiment.id,
    testGroup: group.groupId,
    groupName: group.name || group.groupId,
    participantId,
    period,
    condition: mode,
    sessionId,
    updatedAt: now || admin.firestore.FieldValue.serverTimestamp(),
  };
}

function writeSessionIfInstant(batchOrTransaction, db, config, admin) {
  if (config.mode !== ADAPTIVE_MODES.INSTANT || !config.sessionId) return;
  const sessionRef = db.collection(SESSION_NAVIGATIONS_COLLECTION).doc(config.sessionId);
  batchOrTransaction.set(sessionRef, {
    sessionId: config.sessionId,
    userId: config.userId,
    experimentId: config.experimentId,
    testGroup: config.testGroup,
    participantId: config.participantId,
    period: config.period,
    condition: config.condition,
    status: 'active',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function serializeConfig(config) {
  return {
    success: true,
    userId: config.userId,
    experimentId: config.experimentId || null,
    testGroup: config.testGroup || null,
    participantId: config.participantId || null,
    period: config.period || null,
    mode: config.mode || null,
    sessionId: config.sessionId || null,
  };
}

async function listExperiments(db) {
  const snap = await db.collection(EXPERIMENTS_COLLECTION).orderBy('createdAt', 'desc').get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function getExperiment(db, experimentId) {
  const doc = await db.collection(EXPERIMENTS_COLLECTION).doc(String(experimentId)).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function saveExperiment(db, admin, payload) {
  const experimentId = validateExperimentPayload(payload, Boolean(payload.id));
  const ref = db.collection(EXPERIMENTS_COLLECTION).doc(experimentId);
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    const existing = doc.exists ? doc.data() : {};
    const status = payload.status || existing.status || 'active';
    const autoAssign = payload.autoAssign !== undefined ? payload.autoAssign === true : existing.autoAssign === true;

    if (status === 'active' && autoAssign) {
      const activeSnap = await transaction.get(
        db.collection(EXPERIMENTS_COLLECTION)
          .where('status', '==', 'active')
          .where('autoAssign', '==', true),
      );
      const otherActive = activeSnap.docs.find((activeDoc) => activeDoc.id !== experimentId);
      if (otherActive) fail(`Já existe experimento ativo com autoatribuição: ${otherActive.id}`);
    }

    const canUpdateAssignmentIndex = !doc.exists || payload.allowAssignmentIndexUpdate === true;
    const data = {
      ...payload,
      id: experimentId,
      assignmentStrategy: payload.assignmentStrategy || existing.assignmentStrategy || 'roundRobin',
      assignmentIndex: canUpdateAssignmentIndex && Number.isInteger(Number(payload.assignmentIndex))
        ? Number(payload.assignmentIndex)
        : (existing.assignmentIndex || 0),
      currentPeriod: normalizePositiveInteger(payload.currentPeriod) || existing.currentPeriod || 1,
      maxPeriods: normalizePositiveInteger(payload.maxPeriods) || existing.maxPeriods || 2,
      participants: Array.isArray(payload.participants) ? payload.participants : (existing.participants || []),
      status,
      autoAssign,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    delete data.allowAssignmentIndexUpdate;
    if (!doc.exists) data.createdAt = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(ref, data, { merge: true });
  });
  return { success: true, id: experimentId };
}

async function deleteExperiment(db, experimentId) {
  if (!normalizeString(experimentId)) fail('id é obrigatório');
  await db.collection(EXPERIMENTS_COLLECTION).doc(String(experimentId)).delete();
  return { success: true, id: String(experimentId) };
}

async function findActiveExperiment(db) {
  const snap = await db.collection(EXPERIMENTS_COLLECTION)
    .where('status', '==', 'active')
    .where('autoAssign', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].ref;
}

async function autoAssignParticipant(db, admin, userId) {
  const uid = normalizeString(String(userId || ''));
  if (!uid) fail('userId é obrigatório');

  const configRef = db.collection(USER_CONFIG_COLLECTION).doc(uid);
  const existingConfig = await configRef.get();
  if (existingConfig.exists) return serializeConfig({ userId: uid, ...existingConfig.data() });

  const experimentRef = await findActiveExperiment(db);
  if (!experimentRef) return { success: false, userId: uid, reason: 'no_active_experiment' };

  return db.runTransaction(async (transaction) => {
    const configDoc = await transaction.get(configRef);
    if (configDoc.exists) return serializeConfig({ userId: uid, ...configDoc.data() });

    const experimentDoc = await transaction.get(experimentRef);
    if (!experimentDoc.exists) return { success: false, userId: uid, reason: 'no_active_experiment' };

    const experiment = { id: experimentDoc.id, ...experimentDoc.data() };
    if (experiment.status !== 'active' || experiment.autoAssign !== true) {
      return { success: false, userId: uid, reason: 'auto_assign_disabled' };
    }

    validateGroups(experiment.groups);
    const assignmentIndex = nextGlobalAssignmentIndex(experiment);
    const group = experiment.groups[assignmentIndex % experiment.groups.length];
    const participantId = formatParticipantId(assignmentIndex + 1);
    const config = buildUserConfig({ userId: uid, experiment, group, participantId, period: experiment.currentPeriod || 1, admin });
    const participants = Array.isArray(experiment.participants) ? experiment.participants : [];
    const participant = { userId: uid, participantId, groupId: group.groupId, assignedAt: admin.firestore.Timestamp.now() };

    transaction.set(configRef, { ...config, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    transaction.update(experimentRef, {
      assignmentIndex: assignmentIndex + 1,
      participants: [...participants.filter((item) => String(item.userId) !== uid), participant],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writeSessionIfInstant(transaction, db, config, admin);
    return serializeConfig(config);
  });
}

async function advanceExperimentPeriod(db, admin, experimentId) {
  const experiment = await getExperiment(db, experimentId);
  if (!experiment) fail('Experimento não encontrado');
  const currentPeriod = normalizePositiveInteger(experiment.currentPeriod) || 1;
  const maxPeriods = normalizePositiveInteger(experiment.maxPeriods) || 1;
  if (currentPeriod >= maxPeriods) fail('Experimento já está no último período');

  const nextPeriod = currentPeriod + 1;
  const participants = Array.isArray(experiment.participants) ? experiment.participants : [];
  const batch = db.batch();
  let updated = 0;

  const currentConfigs = await Promise.all(participants.map(async (participant) => {
    const configRef = db.collection(USER_CONFIG_COLLECTION).doc(String(participant.userId));
    const configDoc = await configRef.get();
    return { userId: String(participant.userId), data: configDoc.exists ? configDoc.data() : null };
  }));
  const currentConfigByUserId = new Map(currentConfigs.map((config) => [config.userId, config.data]));

  participants.forEach((participant) => {
    const group = findGroup(experiment, participant.groupId);
    if (!group) fail(`Grupo não encontrado: ${participant.groupId}`);
    const config = buildUserConfig({ userId: participant.userId, experiment, group, participantId: participant.participantId, period: nextPeriod, admin });
    const configRef = db.collection(USER_CONFIG_COLLECTION).doc(String(participant.userId));
    const currentConfig = currentConfigByUserId.get(String(participant.userId));
    const previousSessionId = currentConfig?.mode === ADAPTIVE_MODES.INSTANT ? normalizeString(currentConfig.sessionId) : null;
    if (previousSessionId && previousSessionId !== config.sessionId) {
      batch.set(db.collection(SESSION_NAVIGATIONS_COLLECTION).doc(previousSessionId), {
        status: 'completed',
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    batch.set(configRef, { ...config, sessionId: config.sessionId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    writeSessionIfInstant(batch, db, config, admin);
    updated += 1;
  });

  batch.update(db.collection(EXPERIMENTS_COLLECTION).doc(String(experimentId)), {
    currentPeriod: nextPeriod,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { success: true, experimentId: String(experimentId), period: nextPeriod, updated };
}

async function assignParticipantToGroup(db, admin, payload) {
  const uid = normalizeString(String(payload.userId || ''));
  const groupId = normalizeString(payload.groupId);
  if (!uid || !groupId) fail('userId e groupId são obrigatórios');
  const experimentRef = db.collection(EXPERIMENTS_COLLECTION).doc(String(payload.experimentId));

  return db.runTransaction(async (transaction) => {
    const experimentDoc = await transaction.get(experimentRef);
    if (!experimentDoc.exists) fail('Experimento não encontrado');
    const experiment = { id: experimentDoc.id, ...experimentDoc.data() };
    const group = findGroup(experiment, groupId);
    if (!group) fail('Grupo não encontrado');

    const participants = Array.isArray(experiment.participants) ? experiment.participants : [];
    const existing = participants.find((item) => String(item.userId) === uid);
    const nextIndex = nextGlobalAssignmentIndex(experiment);
    const participantId = existing?.participantId || formatParticipantId(nextIndex + 1);
    const participant = { userId: uid, participantId, groupId, assignedAt: existing?.assignedAt || admin.firestore.Timestamp.now() };
    const period = normalizePositiveInteger(payload.period) || normalizePositiveInteger(experiment.currentPeriod) || 1;
    const config = buildUserConfig({ userId: uid, experiment, group, participantId, period, admin });
    const assignmentIndex = existing ? nextIndex : Math.max(nextIndex + 1, Number(experiment.assignmentIndex) || 0);

    transaction.set(db.collection(USER_CONFIG_COLLECTION).doc(uid), { ...config, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    transaction.update(experimentRef, {
      assignmentIndex,
      participants: [...participants.filter((item) => String(item.userId) !== uid), participant],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writeSessionIfInstant(transaction, db, config, admin);
    return serializeConfig(config);
  });
}

async function completeExperiment(db, admin, experimentId) {
  if (!normalizeString(experimentId)) fail('experimentId é obrigatório');
  await db.collection(EXPERIMENTS_COLLECTION).doc(String(experimentId)).update({
    status: 'completed',
    autoAssign: false,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true, experimentId: String(experimentId), status: 'completed', autoAssign: false };
}

module.exports = {
  advanceExperimentPeriod, assignParticipantToGroup, autoAssignParticipant,
  completeExperiment, deleteExperiment, generateSessionId, getExperiment,
  listExperiments, saveExperiment, validateExperimentPayload,
};
