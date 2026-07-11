const { STEP_SHORTCUTS } = require('./instantDomainRules');

const ONBOARDING_INFO_SLOT_STEP_ID = 'create_lot_with_protocol';
const ONBOARDING_INFO_SLOT_TARGET_ROUTE = '/areaCultivoPage';
const CREATE_LOT_ROUTE = '/lotePage';
const CANONICAL_SECONDARY_ROUTES = ['/protocoloPage', '/areaCultivoPage'];

const CREATE_LOT_INTENT_TOKENS = [
  'criarprimeirolote',
  'criaroprimeirolote',
  'crieprimeirolote',
  'crieoprimeirolote',
  'crieseuprimeirolote',
  'criandoseuprimeirolote',
  'comececriandoseuprimeirolote',
  'criarlote',
  'createlot',
  'createfirstlot',
];

function normalizeIntentText(value) {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
    : '';
}

function hasCreateLotIntentText(shortcut) {
  const intentText = [shortcut.label, shortcut.reason, shortcut.description, shortcut.title]
    .map(normalizeIntentText)
    .join('');

  return CREATE_LOT_INTENT_TOKENS.some((token) => intentText.includes(token));
}

function duplicatesPrimaryCreateLotIntent(shortcut) {
  return shortcut?.route === CREATE_LOT_ROUTE || hasCreateLotIntentText(shortcut || {});
}

function hasOnboardingInfoSlotTarget(operationalOnboarding) {
  return operationalOnboarding?.targetRoute === ONBOARDING_INFO_SLOT_TARGET_ROUTE;
}

function shouldUseOnboardingInfoSlot(stepId, operationalOnboarding) {
  return stepId === ONBOARDING_INFO_SLOT_STEP_ID && hasOnboardingInfoSlotTarget(operationalOnboarding);
}

function canonicalShortcutForRoute(route, existingShortcut, index) {
  const canonical = STEP_SHORTCUTS.create_lot_with_protocol.find((shortcut) => shortcut.route === route);
  const source = existingShortcut || canonical;
  const description = source.description || source.reason || canonical.description;

  return {
    route,
    confidence: typeof source.confidence === 'number' ? source.confidence : index === 0 ? 0.72 : 0.64,
    label: source.label || canonical.label,
    description,
    group: source.group || canonical.group,
    reason: source.reason || description,
  };
}

function canonicalizeOnboardingSecondaryShortcuts(stepId, operationalOnboarding, shortcuts) {
  if (!shouldUseOnboardingInfoSlot(stepId, operationalOnboarding)) {
    return shortcuts;
  }

  const secondaryShortcuts = Array.isArray(shortcuts)
    ? shortcuts.filter((shortcut) => !duplicatesPrimaryCreateLotIntent(shortcut))
    : [];

  return CANONICAL_SECONDARY_ROUTES.map((route, index) => canonicalShortcutForRoute(
    route,
    secondaryShortcuts.find((shortcut) => shortcut.route === route),
    index,
  ));
}

module.exports = {
  ONBOARDING_INFO_SLOT_STEP_ID,
  ONBOARDING_INFO_SLOT_TARGET_ROUTE,
  canonicalizeOnboardingSecondaryShortcuts,
  hasOnboardingInfoSlotTarget,
  shouldUseOnboardingInfoSlot,
};
