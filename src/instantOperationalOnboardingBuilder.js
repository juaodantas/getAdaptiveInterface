const { ALLOWED_INSTANT_ROUTES } = require('./adaptiveContract');
const { DOMAIN_RULES, RULE_IDS } = require('./instantDomainRules');

const STEP_IDS_WITH_ONBOARDING = ['create_lot_with_protocol', 'plan_next_lot'];

const OPERATIONAL_ONBOARDING_FALLBACKS = {
  create_lot_with_protocol: {
    title: 'Como começar',
    message: 'Crie seu primeiro lote com protocolo para iniciar o acompanhamento.',
    steps: [
      'Cadastre ou selecione um protocolo',
      'Crie o primeiro lote',
      'Acompanhe as atividades geradas na agenda',
    ],
    ctaLabel: 'Criar primeiro lote',
    priority: 20,
  },
  plan_next_lot: {
    title: 'Planejar próximo lote',
    message: 'Seu lote ativo está em acompanhamento. Planeje o próximo lote para manter a produção organizada.',
    steps: [
      'Revise a capacidade disponível',
      'Crie o próximo lote',
      'Vincule um protocolo antes de iniciar',
    ],
    ctaLabel: 'Planejar próximo lote',
    priority: 20,
  },
};

const OPERATIONAL_ONBOARDING_FALLBACK = OPERATIONAL_ONBOARDING_FALLBACKS.create_lot_with_protocol;

function resolveOperationalOnboardingTargetRoute(signals) {
  if (signals?.stepId === 'create_lot_with_protocol') return '/areaCultivoPage';
  if (signals?.stepId === 'plan_next_lot') return '/lotePage';
  return signals?.targetRoute || '/protocoloPage';
}

function resolveReason(signals) {
  const rulesApplied = Array.isArray(signals && signals.rulesApplied) ? signals.rulesApplied : [];
  for (const ruleId of rulesApplied) {
    if (ruleId === RULE_IDS.NO_PROGRESS_BAR) {
      continue;
    }
    const rule = DOMAIN_RULES.find((r) => r.id === ruleId);
    if (rule) {
      return rule.description;
    }
  }
  return 'Usuário ainda não possui lote ativo com protocolo.';
}

function stepUsesOperationalOnboardingInfoSlot(stepId) {
  return STEP_IDS_WITH_ONBOARDING.includes(stepId);
}

function validateOperationalOnboarding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['missing_or_invalid'];
  }

  const errors = [];

  if (typeof value.title !== 'string' || value.title.trim() === '' || value.title.trim().length > 60) {
    errors.push('invalid_title');
  }

  if (typeof value.message !== 'string' || value.message.trim() === '' || value.message.trim().length > 120) {
    errors.push('invalid_message');
  }

  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 5) {
    errors.push('invalid_steps');
  } else if (value.steps.some((step) => typeof step !== 'string' || step.trim() === '' || step.trim().length > 80)) {
    errors.push('invalid_steps');
  }

  if (typeof value.ctaLabel !== 'string' || value.ctaLabel.trim() === '' || value.ctaLabel.trim().length > 40) {
    errors.push('invalid_cta_label');
  }

  if (typeof value.targetRoute !== 'string' || !ALLOWED_INSTANT_ROUTES.includes(value.targetRoute)) {
    errors.push('invalid_target_route');
  }

  if (typeof value.reason !== 'string' || value.reason.trim() === '' || value.reason.trim().length > 160) {
    errors.push('invalid_reason');
  }

  if (typeof value.priority !== 'number' || !Number.isInteger(value.priority) || value.priority < 1 || value.priority > 100) {
    errors.push('invalid_priority');
  }

  return errors;
}

function buildOperationalOnboardingFallback({ signals } = {}) {
  if (!signals || !STEP_IDS_WITH_ONBOARDING.includes(signals.stepId)) {
    return null;
  }
  const fallback = OPERATIONAL_ONBOARDING_FALLBACKS[signals.stepId] || OPERATIONAL_ONBOARDING_FALLBACK;

  return {
    ...fallback,
    targetRoute: resolveOperationalOnboardingTargetRoute(signals),
    reason: resolveReason(signals),
  };
}

function normalizeOperationalOnboarding(raw, signals, clientCapabilities) {
  const stepId = signals && signals.stepId;
  if (!STEP_IDS_WITH_ONBOARDING.includes(stepId)) {
    return null;
  }

  const supportedComponents = Array.isArray(clientCapabilities && clientCapabilities.supportedComponents)
    ? clientCapabilities.supportedComponents
    : [];
  if (!supportedComponents.includes('OperationalOnboardingCard')) {
    return null;
  }

  if (validateOperationalOnboarding(raw).length === 0) {
    return {
      title: raw.title.trim(),
      message: raw.message.trim(),
      steps: raw.steps.map((s) => s.trim()),
      ctaLabel: raw.ctaLabel.trim(),
      targetRoute: resolveOperationalOnboardingTargetRoute(signals),
      reason: raw.reason.trim(),
      priority: raw.priority,
    };
  }

  return buildOperationalOnboardingFallback({ signals });
}

module.exports = {
  normalizeOperationalOnboarding,
  validateOperationalOnboarding,
  buildOperationalOnboardingFallback,
  stepUsesOperationalOnboardingInfoSlot,
  STEP_IDS_WITH_ONBOARDING,
  OPERATIONAL_ONBOARDING_FALLBACK,
  OPERATIONAL_ONBOARDING_FALLBACKS,
};
