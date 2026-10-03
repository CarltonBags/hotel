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
export { LANGUAGES, formatCurrency, formatDate, formatDateTime, formatNumber, isCalendarDate, isLanguage, localeFor, weekStartsOn, type Language } from "./formats";
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
  SALUTATIONS,
  type Salutation,
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
export {
  RESERVATION_CHANGE_ACTIONS,
  cancellationFee,
  nightsNeedingRoom,
  nightsToReprice,
  sameAges,
  splitAssignment,
  zonedInstant,
  type AssignmentSegment,
  type FeePolicy,
  type ReservationChangeAction,
  type StayShape,
} from "./reservation-edit";
export { CALENDAR_RANGES, dropOutcome, packLanes, type CalendarBar, type CalendarRange, type DropOutcome, type DropRefusal, type DropTarget } from "./calendar";
export { includesBreakfast, occupancyPercent, personsByMealPlan, sortRows, type PersonsByMealPlan } from "./lists";
export { DATA_CHANGE_PREFIX, DATA_KINDS, isDataChange, type DataKind } from "./live";
export { earlyDepartureFee, folioTotals, routeCharge, staySync, type PostedStayCharge, type TaxCodeTotal, type TotalsInput, type WantedStayCharge } from "./folio";
export { WORLD_COUNTRIES } from "./world-countries";
export {
  WORKSPACE_SORT_KEYS,
  fixedChargeNights,
  isFrontOfficeOnly,
  registrationFields,
  registrationGaps,
  workspaceRows,
  type RegistrationField,
  type WorkspaceFilters,
  type WorkspaceRow,
  type WorkspaceSortKey,
  type WorkspaceView,
} from "./front-office";
export {
  HOLD_WARNING_HOURS,
  PAYMENT_STATUSES,
  DESK_TENDERS,
  PROVIDER_TENDERS,
  TENDERS,
  captureAmount,
  folioBalance,
  holdExpiry,
  holdIncrementAllowed,
  holdWarningAt,
  refundCheck,
  refundableAmount,
  type HoldChannel,
  type PaymentStatus,
  type RefundVerdict,
  type Tender,
} from "./payments";
export {
  allocateDeposit,
  formatInvoiceNumber,
  invoiceLines,
  invoiceTotals,
  isInvoiceNumberFormat,
  type InvoiceCharge,
  type InvoiceLine,
  type InvoiceTotals,
  type PrecedingDeposit,
  type TaxPart,
} from "./invoices";
export {
  AGEING_BUCKETS,
  REMINDER_LEVELS,
  ageing,
  bucketOf,
  daysOverdue,
  nextReminderLevel,
  type AgeingBucket,
  type ReminderLevel,
} from "./receivables";
export {
  CITY_TAX_EVIDENCE,
  CITY_TAX_EXEMPTION_REASONS,
  CITY_TAX_KINDS,
  CITY_TAX_PASS_ON,
  CITY_TAX_PRESETS,
  MANUAL_EXEMPTION_REASONS,
  cityTax,
  formatCityTaxFlat,
  formatCityTaxSteps,
  parseCityTaxFlat,
  parseCityTaxSteps,
  stepAmount,
  versionFor,
  type CityTaxEvidence,
  type CityTaxExemptKey,
  type CityTaxExemptionReason,
  type CityTaxFlat,
  type CityTaxKind,
  type CityTaxNight,
  type CityTaxPassOn,
  type CityTaxPreset,
  type CityTaxReasonSetting,
  type CityTaxRuleSpec,
  type CityTaxStay,
  type CityTaxStep,
  type CityTaxVersion,
} from "./city-tax";
