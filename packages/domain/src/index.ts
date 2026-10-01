/** Pure domain rules, no I/O. Vocabulary follows CONTEXT.md. */
export { assertTenantSlug, isTenantSlug, requestHost, resolveTenantSlug, resolveTenantSlugFromHeaders, tenantSchemaFromSlug } from "./tenant-slug";
export {
  PROPERTY_ACTIONS,
  PROPERTY_ROLES,
  ROLE_LABELS,
  TENANT_ACTIONS,
  TENANT_ROLES,
  can,
  canViewAnyProperty,
  isTenantAction,
  rolesAt,
  type Action,
  type Actor,
  type PropertyAction,
  type PropertyRole,
  type PropertyRoleAssignment,
  type TenantAction,
  type TenantRole,
} from "./permissions";
export {
  COUNTRIES,
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatInPropertyTime,
  isCountryCode,
  isCurrencyCode,
  isTimeZone,
  type CountryCode,
  type CurrencyCode,
} from "./reference";
export { isUsername, normaliseUsername, suggestUsername } from "./username";
export { LANGUAGES, formatCurrency, formatDate, formatDateTime, formatNumber, isLanguage, localeFor, weekStartsOn, type Language } from "./formats";
export { ACCENTS, DEFAULT_ACCENT, defaultQuickAccess, isAccentId, isTheme, type AccentId, type Theme } from "./shell";
export { ageBandFor, validateAgeBands, type AgeBandInput, type AgeBandIssue, type AgeBandProblem } from "./age-bands";
export { GUEST_LANGUAGES, localizedName, mergeNames, type LocalizedName, type Names } from "./names";
export { expandRoomNumbers } from "./room-numbers";
