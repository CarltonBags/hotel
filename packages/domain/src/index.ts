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
  daysBetween,
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
export { CALENDAR_RANGES, cellReservations, dropOutcome, packLanes, restrictionMarks, type CalendarBar, type CalendarRange, type DropOutcome, type DropRefusal, type DropTarget } from "./calendar";
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
export { APPROVAL_KINDS, APPROVAL_TTL_HOURS, OUTLET_APPROVAL_KINDS, approvalRight, approvalStatus, priceOverrideCheck, type ApprovalKind, type ApprovalStatus } from "./approvals";
export { auditOpen, auditOverdue, daysBehind, noShowFee, undecidedArrivals, type ArrivalDecision, type AuditClock } from "./night-audit";
export {
  CLEANLINESS,
  ROOM_BLOCK_KINDS,
  cleanlinessScope,
  isReady,
  preferredFeatures,
  roomViewScope,
  type Cleanliness,
  type CleanlinessSource,
  type RoomBlockKind,
  type RoomScope,
} from "./room-state";
export {
  DEFAULT_MINUTES,
  STAYOVER_RHYTHMS,
  TASK_KINDS,
  proposeDistribution,
  tasksForDay,
  workload,
  type PlanTask,
  type StayOnDay,
  type StayoverRhythm,
  type TaskKind,
  type TaskRules,
} from "./housekeeping";
export { PIN_MAX_TRIES, PIN_ROLES, canUsePin, deviceIdleMinutes, mayLookAfterPinUser, pinProblem, pinRolesFor } from "./devices";
export {
  FLOOR_LANGUAGES,
  HOUSEKEEPING_NOTE_CODES,
  LOST_PICKS,
  PROBLEM_PICKS,
  URGENCIES,
  floorSections,
  isFloorLanguage,
  isRtl,
  parsePhoneOp,
  type FloorLanguage,
  type HousekeepingNoteCode,
  type LostPick,
  type PhoneOp,
  type ProblemPick,
  type Urgency,
} from "./floor";
export { copySourceDate, parsePaste, planCopyPeriod, planFill, planPaste, type FillMode, type ToolPlan } from "./rates-tools";
export { CASH_MOVEMENT_KINDS, cashBookBalance, closeCount, countTotal, denominationsFor, movementSign, paidOutNeedsApproval, type CashCount, type CashMovementKind } from "./cash";
export { countMonth, monthBounds, statsRowFor, statsRows, statsVariant, type MonthCount, type StatsRow, type StatsStay, type StatsVariant } from "./tourism-stats";
export { AVAILABILITY_TARGET, INCIDENT_STATES, MAINTENANCE_NOTICE_DAYS, maintenanceProblem, monthlyAvailability, serviceState, supportReasonProblem, type IncidentImpact, type IncidentState, type ServiceState } from "./service-status";
export * from "./go-live";
export * from "./reports";
export * from "./report-text";
export * from "./downtime";
export * from "./registration";
export { CHECK_IN_CONDITIONS, checkInConditions, needsReception, selfRegistrationPath, type CheckInCondition, type CheckInFacts } from "./self-checkin";
export * from "./budget";
export * from "./report-builder";
export * from "./subscription";
export * from "./non-payment";
export * from "./messages";
export { ISSUE_PHOTO_DAYS } from "./maintenance";
export { FULL_PUSH_DAYS, channelRestriction, channelStatusText, compressDays, type ChannelRestrictionValue, type ChannelStatus } from "./channels";
export { addVat, channelNight, channelNights, splitCityTaxIncluded, type ChannelNightInput } from "./channel-bookings";
export { OTP_ATTEMPTS, OTP_MINUTES, PORTAL_DAYS_AFTER_DEPARTURE, PORTAL_LANGUAGES, cardLabel, depositDue, expressCheckoutOpen, extrasOpen, isArrivalTime, portalLanguage, portalLinkOpen, sameLastName, type PortalLanguage } from "./portal";
export { WHATSAPP_MEDIA_BYTES, WHATSAPP_TYPES, WINDOW_HOURS, asMetaTemplate, isWhatsAppType, storedForms, whatsAppNumber, sensitiveData, windowOpen, type WhatsAppType } from "./whatsapp";
export { CONVERSATION_FILE_BYTES, CONVERSATION_FILE_TYPES, QUICK_REPLY_PLACEHOLDERS, conversationExpired, deskMinutesBetween, isAutoReply, parseReplyAddress, replyAddress, deskNight, fillQuickReply, inDeskHours, isConversationFile, type DeskHours, type QuickReplyValues } from "./conversations";
export { AT_NOT_SIGNED_NOTICE, AT_OUTAGE_NOTICE, AT_OUTAGE_REPORT_DAYS, AT_OUTAGE_REPORT_HOURS, FISCAL_OUTAGE_NOTICE, FISCAL_SCOPES, atOutageReport, atVatKey, yearlyReceiptCheckBy, dsfinvkClosing, fiscalAmount, fiscalPayment, fiscalScopeCovers, fiscalSerial, fiscalVat, receiptVatAmounts, refundVatAmounts, vatSplit, type ClosingTransaction, type FiscalBusinessCase, type FiscalScope, type VatAmount } from "./fiscal";
export { VOUCHER_SALE_TENDERS, maskVoucherCode, normalizeVoucherCode, voucherBalance, voucherCode, type VoucherSaleTender } from "./vouchers";
export { GROUP_STATUSES, RELEASE_WARNING_DAYS, groupStatusAllowed, releaseDateFor, releaseWarningDue, seriesArrivals, tentativeShortfall, unsoldHeld, type GroupStatus } from "./groups";
export { checkRoomingList, depositStatus, parseRoomingList, roomsTogether, tourLeaderRegisters, type DepositInstallment, type FreeRoom, type RoomingProblem, type RoomingRow } from "./group-rooming";
export { OUTLET_KINDS, PRINTER_KINDS, billTotal, eposPrintXml, lineFor, mayManageOutlet, splitIsValid, ticketsFor, ticketText, worksAnOutlet, chargesPerTaxCode, decidesAtOutlet, discountNeedsApproval, roomChargeCheck, tapToPayAccepts, type OutletChargeLine, type RoomChargeCheck, type BillLineDraft, type Modifier, type OutletKind, type PrintTicket, type PrinterKind } from "./outlets";
export { appointmentProblem, instantAt, openSpaSlots, guestCancelDeadline, guestMayCancel, type AppointmentProblem, type Interval } from "./spa";
export { LIGHTSPEED_ROOM_CHARGE, fromLightspeed, taxCodeForRate, tillChargeGroups, type LightspeedAccount, type TillChargeGroup, type TillItem, type TillPosting, type TillTotal } from "./till";
export { KEY_HANDOVERS, automaticKeyKind, doorPin, handoverSupported, keyActions, keyPlan, keyValidUntil, type KeyHandover, type KeyKind, type KeyPlan, type KeyWarning, type LockCapabilities, type PlannedKey, type RevokeReason } from "./locks";
