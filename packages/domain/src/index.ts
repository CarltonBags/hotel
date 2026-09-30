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
