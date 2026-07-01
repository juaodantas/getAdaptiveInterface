const { ALLOWED_INSTANT_ROUTES, SCREEN_RESOURCE_REQUIREMENTS, normalizeNonEmptyString } = require('./adaptiveContract');

const ALLOWED_RESOURCE_TYPES = [
  ...new Set(Object.values(SCREEN_RESOURCE_REQUIREMENTS).map((requirement) => requirement.type)),
];

function normalizeAllowedRoute(value) {
  const route = normalizeNonEmptyString(value);
  return route && ALLOWED_INSTANT_ROUTES.includes(route) ? route : null;
}

function normalizeRecentRoutes(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeAllowedRoute).filter(Boolean).slice(0, 10);
}

function normalizeResourceType(value) {
  const resourceType = normalizeNonEmptyString(value);
  const normalized = resourceType ? resourceType.toLowerCase() : null;
  return normalized && ALLOWED_RESOURCE_TYPES.includes(normalized) ? normalized : null;
}

function resolveRequestSessionId(data) {
  return normalizeNonEmptyString(data?.session?.sessionId)
    || normalizeNonEmptyString(data?.sessionId);
}

function normalizeNavigationContext(data, sessionNavigations) {
  const raw = data?.navigationContext && typeof data.navigationContext === 'object'
    ? data.navigationContext
    : {};
  const navigationRoutes = (sessionNavigations || [])
    .map((nav) => normalizeNonEmptyString(nav?.screen)
      || normalizeNonEmptyString(nav?.route)
      || normalizeNonEmptyString(nav?.targetScreen))
    .map(normalizeAllowedRoute)
    .filter(Boolean);

  return {
    currentRoute: normalizeAllowedRoute(raw.currentRoute) || navigationRoutes[navigationRoutes.length - 1] || null,
    previousRoute: normalizeAllowedRoute(raw.previousRoute) || navigationRoutes[navigationRoutes.length - 2] || null,
    recentRoutes: normalizeRecentRoutes(raw.recentRoutes).length > 0
      ? normalizeRecentRoutes(raw.recentRoutes)
      : navigationRoutes.slice(-10),
    sessionClickCount: Number.isInteger(raw.sessionClickCount) && raw.sessionClickCount >= 0
      ? raw.sessionClickCount
      : navigationRoutes.length,
  };
}

function sanitizeSessionNavigations(sessionNavigations) {
  return (sessionNavigations || []).map((nav) => {
    const route = normalizeNonEmptyString(nav?.screen)
      || normalizeNonEmptyString(nav?.route)
      || normalizeNonEmptyString(nav?.targetScreen);
    const allowedRoute = normalizeAllowedRoute(route);
    if (!allowedRoute) {
      return null;
    }

    const sanitized = { route: allowedRoute };
    const resourceType = normalizeResourceType(nav?.resourceType);
    if (resourceType) sanitized.resourceType = resourceType;
    return sanitized;
  }).filter(Boolean);
}

module.exports = {
  resolveRequestSessionId,
  normalizeNavigationContext,
  sanitizeSessionNavigations,
  normalizeAllowedRoute,
  normalizeResourceType,
};
