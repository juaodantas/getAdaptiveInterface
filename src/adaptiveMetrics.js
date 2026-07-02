const LEGACY_METRIC_EVENTS = [
  'session_start',
  'shortcuts_shown',
  'shortcut_clicked',
  'dashboard_shown',
  'dashboard_changed',
  'first_productive_navigation',
];

const ENHANCED_INSTANT_METRIC_EVENTS = [
  'adaptive_session_start',
  'instant_adaptation_applied',
  'next_step_shown',
  'next_step_clicked',
  'section_highlight_shown',
  'section_highlight_clicked',
  'info_icon_opened',
  'info_card_shown',
  'info_card_clicked',
  'contextual_onboarding_shown',
  'contextual_onboarding_clicked',
];

const SUPPORTED_METRIC_EVENTS = [
  ...LEGACY_METRIC_EVENTS,
  ...ENHANCED_INSTANT_METRIC_EVENTS,
];

function getSupportedMetricEventsSqlList() {
  return SUPPORTED_METRIC_EVENTS.map((eventName) => `'${eventName}'`).join(', ');
}

module.exports = {
  LEGACY_METRIC_EVENTS,
  ENHANCED_INSTANT_METRIC_EVENTS,
  SUPPORTED_METRIC_EVENTS,
  getSupportedMetricEventsSqlList,
};
