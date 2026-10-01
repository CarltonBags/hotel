/** Pure domain rules, no I/O. Vocabulary follows CONTEXT.md. */
export { assertTenantSlug, isTenantSlug, requestHost, resolveTenantSlug, resolveTenantSlugFromHeaders, tenantSchemaFromSlug } from "./tenant-slug";
export {
  PROPERTY_ACTIONS,
  PROPERTY_ROLES,
  ROLE_LABELS,
  TENANT_ACTIONS,
  TENANT_ROLES,
  can,
  canAtAnyProperty, canViewAnyProperty,
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
export { POSTING_RHYTHMS, TAX_PRESETS, isPostingRhythm, isTaxPresetCountry, splitGross, taxRateOn, todayIn, type DatedRate, type GrossSplit, type PostingRhythm, type TaxPreset } from "./tax";
export {
  CHANNEL_LIMITS,
  DERIVATION_KINDS,
  FEE_KINDS,
  INHERIT_ALL,
  MEAL_PLANS,
  OPEN_RESTRICTION,
  PAYMENT_KINDS,
  RESTRICTION_FIELDS,
  SUPPLEMENT_KINDS,
  checkPlanLimits,
  derivedPrice,
  effectiveRestriction,
  isOneOf,
  occupancyPrice,
  occupancyPrices,
  type AgeBandRef,
  type Derivation,
  type DerivationKind,
  type FeeKind,
  type MealPlan,
  type Occupancy,
  type PaymentKind,
  type PricedPlan,
  type Restriction,
  type RestrictionField,
  type RestrictionInheritance,
  type Supplement,
  type SupplementKind,
} from "./rates";
export { roundMoney } from "./money";
export {
  PRICE_ACTIONS,
  addDays,
  cellKey,
  datesFrom,
  planBulkEdit,
  weekdayIndex,
  type BulkEdit,
  type BulkPlan,
  type BulkPreview,
  type GridRow,
  type GridState,
  type PriceAction,
} from "./rates-grid";
export { ROUTING_CATEGORIES, type RoutingCategory } from "./companies";
export {
  DOCUMENT_TYPES,
  EMPTY_GUEST,
  mergeGuestData,
  needsPostalCode,
  normaliseEmail,
  normalisePhone,
  phoneSearchDigits,
  type DocumentType,
  type GuestData,
} from "./guests";
export { nightsOf, quoteStay, type PriceComponent, type QuoteInput, type QuoteReason, type QuotedNight, type StayQuote } from "./stay-quote";
export { BOOKING_SOURCES, OCCUPYING_STATUSES, RESERVATION_STATUSES, type BookingSource, type ReservationStatus } from "./reservations";
