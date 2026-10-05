import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { controlSchema } from "./control/schema";
import { tenantSchema } from "./tenant/schema";
import { withTenant } from "./tenant/with-tenant";

export { migrateControl } from "./control/migrate-control";
export { assertContiguous, type Migration } from "./migrations/versions";
export { findSchemaQualifiedNames, type Finding } from "./tenant/check-tenant-sql";
export { migrateTenants, type MigrateResult } from "./tenant/migrate-tenants";
export { deleteExpiredDemoTenants, deleteTenant, findTenantById, findTenantBySlug, provisionTenant, setTenantAccent, trialsInLastHour, type NewTenant, type Tenant } from "./tenant/provision";
export { GoLiveBlocked, goLive, goLiveCheckCurrent, goLiveChecklistOf, markGoLiveChecked, tenantLifecycle, testRecordCounts, type TenantLifecycle, type TestRecordCounts } from "./tenant/go-live";
export { seedDemoData } from "./tenant/demo";
/** Kept with the rates for the app's Rates page; the domain owns it. */
export { PRICE_HORIZON_DAYS } from "@hoteloftware/domain";
export { getFloorLanguage, getNotificationChannels, getPreferences, getWorkspace, notificationChannelsOf, setFloorLanguage, setNotificationChannels, setPinnedTabs, setPreferences, type NotificationChannels, type PinnedTab, type Preferences, type Workspace } from "./control/preferences";
export { assertTenantSlug, isTenantSlug, resolveTenantSlug, tenantSchemaFromSlug } from "@hoteloftware/domain";
export { assertTenantSchemaName, inTenantTransaction, isTenantSchemaName, withTenant } from "./tenant/with-tenant";
export { controlSchema } from "./control/schema";
export {
  countOwners,
  emailForUsername,
  findTenantUser,
  inControlTransaction,
  listTenantUsers,
  loadActor,
  setPropertyRoles,
  setTenantRole,
  setUsername,
  type TenantUser,
} from "./control/roles";
export { createLegalEntity, findLegalEntity, listLegalEntities, updateLegalEntity, type LegalEntity, type LegalEntityInput } from "./tenant/legal-entities";
export { createProperty, findProperty, listProperties, setDeviceIdleMinutes, updateProperty, type Property, type PropertyInput } from "./tenant/properties";
export { tenantSchema } from "./tenant/schema";

export type ControlDb = NodePgDatabase<typeof controlSchema>;
export type TenantDb = NodePgDatabase<typeof tenantSchema>;

export function createPool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max });
}

/** Drizzle over the control schema; tables are schema-qualified, no search path needed. */
export function controlDb(pool: Pool): ControlDb {
  return drizzle(pool, { schema: controlSchema });
}

/**
 * Run a Drizzle callback against one tenant. The client is the transaction
 * from withTenant, so every query inside runs in the tenant's schema.
 * The neon-http driver cannot be used here (no transactions); see research.
 */
export function withTenantDb<T>(pool: Pool, schema: string, fn: (db: TenantDb, tx: PoolClient) => Promise<T>): Promise<T> {
  return withTenant(pool, schema, (tx) => fn(drizzle(tx, { schema: tenantSchema }), tx));
}
export {
  createRoomFeature,
  createRoomType,
  createRooms,
  createSection,
  deleteRoom,
  deleteRoomFeature,
  deleteRoomType,
  deleteSection,
  listAgeBands,
  listRoomFeatures,
  listRoomTypes,
  listRooms,
  listSections,
  renameSection,
  roomCapacityHistory,
  saveAgeBands,
  updateRoom,
  updateRoomFeature,
  updateRoomType,
  AgeBandError,
  type AgeBand,
  type Names,
  type Room,
  type RoomFeature,
  type RoomPatch,
  type RoomType,
  type RoomTypeInput,
  type Section,
} from "./tenant/rooms";
export { addTaxRate, applyTaxPreset, createTaxCode, listTaxCodes, removeTaxRate, renameTaxCode, taxRateFor, type TaxCode } from "./tenant/tax-codes";
export { createService, findService, listServices, updateService, type Service, type ServiceInput, type ServicePatch } from "./tenant/services";
export { PRESET_RATE_START } from "./tenant/catalogue-common";
export {
  createCancellationPolicy,
  createPaymentPolicy,
  listCancellationPolicies,
  listPaymentPolicies,
  updateCancellationPolicy,
  updatePaymentPolicy,
  type CancellationPolicy,
  type CancellationPolicyInput,
  type PaymentPolicy,
  type PaymentPolicyInput,
} from "./tenant/policies";
export { createRatePlan, findRatePlan, listRatePlans, updateRatePlan, type IncludedService, type RatePlan, type RatePlanInput, type RatePlanPatch } from "./tenant/rate-plans";
export {
  applyBulkEdit,
  applyRatesTool,
  createEventMarker,
  deleteEventMarker,
  listEventMarkers,
  type EventMarker,
  type RatesTool,
  applyGridEdit,
  listBelowFloor,
  listPriceEnds,
  undoLastChange,
  type BelowFloor,
  type PriceEnd,
  closeProperty,
  closeRoomType,
  datesBetween,
  listRateChanges,
  listRates,
  listRestrictions,
  setRates,
  setRestrictions,
  type DateRange,
  type RateCell,
  type RateChange,
  type RateWriteResult,
  type RestrictionCell,
  type RestrictionCellPatch,
} from "./tenant/rates";
export {
  createGuest,
  findGuest,
  findGuestDuplicates,
  guestHistory,
  listGuestMerges,
  mergeGuests,
  searchGuests,
  updateGuest,
  type DuplicateReason,
  type Guest,
  type GuestChange,
  type GuestDuplicate,
  type GuestInput,
  type GuestMerge,
  type GuestPatch,
  type GuestSummary,
} from "./tenant/guests";
export { companyHistory, createCompany, findCompany, listCompanyNames, searchCompanies, updateCompany, type Company, type CompanyChange, type CompanyData } from "./tenant/companies";
export {
  createBooking,
  findReservation,
  listGuestReservations,
  quoteStays,
  type GuestReservation,
  type NewBooking,
  type NewReservation,
  type QuotedPlan,
  type QuotedRoomType,
  type ReservationDetail,
  type StayQuotes,
  type StayRequest,
} from "./tenant/reservations";
export {
  assignRoom,
  cancelBooking,
  cancelReservation,
  changeStayIntoRoom,
  listFreeRooms,
  listOverbooked,
  listRoomChoices,
  type RoomChoice,
  moveRoom,
  moveRoomInHouse,
  previewBookingCancellation,
  previewCancellation,
  previewReservationChange,
  restoreAssignments,
  reservationHistory,
  setCancellationFeeStatus,
  unassignRooms,
  updateBookingNotes,
  updateReservation,
  OverbookingNeeded,
  type ChangeOptions,
  type ChangePreview,
  type OverbookedReservation,
  type ReservationChange,
  type ReservationPatch,
} from "./tenant/reservation-changes";
export { loadCalendar, type CalendarData, type CalendarDay, type CalendarReservation, type CalendarRoom, type CalendarRoomType } from "./tenant/calendar";
export {
  breakfastList,
  houseList,
  listArrivals,
  listDepartures,
  listInHouse,
  searchReservations,
  todaySummary,
  workspaceCounts,
  workspaceList,
  WORKSPACE_LISTS,
  type WorkspaceList,
  type BreakfastList,
  type ListRow,
  type ReservationHit,
  type TodaySummary,
} from "./tenant/operations";
export {
  addFixedCharge,
  addFolio,
  cancelCheckIn,
  chargeHistory,
  listFixedCharges,
  removeFixedCharge,
  type FixedCharge,
  RoomNotReady,
  checkIn,
  loadFolios,
  moveCharge,
  postFreeTextCharge,
  postServiceCharge,
  setRouting,
  voidCharge,
  ShorteningNeedsConfirmation,
  type Charge,
  type ChargeEvent,
  type ChargeOrigin,
  type AutoVoid,
  type Folio,
  type FolioView,
} from "./tenant/folios";
export {
  cancelPendingPayment,
  coverBalanceWithHold,
  retryOpenRefunds,
  captureCardHold,
  incrementCardHold,
  listCardHolds,
  listPaymentAccounts,
  listTerminalReaders,
  onboardPaymentAccount,
  placeCardHold,
  refreshPaymentAccount,
  refreshPaymentAccountById,
  refundPayment,
  registerTerminalReader,
  releaseCardHold,
  removeTerminalReader,
  renewExpiringHolds,
  setRefundLimit,
  simulateCard,
  syncByIntent,
  syncCardHold,
  syncPayment,
  syncRefund,
  takePayment,
  listRecentPayments,
  type PaymentListRow,
  type CardHold,
  type HoldWarning,
  type Payment,
  type PaymentAccount,
  type TerminalReader,
} from "./tenant/payments";
export { mapProviderAccount } from "./control/external-ids";
export {
  CheckOutBlocked,
  DEFAULT_FORMATS,
  cancelInvoice,
  checkOut,
  listCancellationInvoices,
  type CancellationListRow,
  invoiceDocument,
  invoiceFiles,
  keepInvoiceFile,
  issueDepositInvoiceIfDue,
  issueInvoice,
  listInvoiceNumberRanges,
  listInvoices,
  setInvoiceNumberRange,
  type IssuedInvoice,
  type NumberRange,
  type RangeKind,
} from "./tenant/invoices";
export { issueReminder, keepReminderPdf, listReceivables, matchTransfer, reminderDocument, type ReceivableRow, type Receivables, type TransferMatch } from "./tenant/receivables";
export {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_TYPES,
  addCityTaxVersion,
  cityTaxEvidence,
  cityTaxReport,
  createCityTaxRule,
  getCityTaxRule,
  listCityTaxExemptions,
  removeCityTaxExemption,
  removeCityTaxVersion,
  setCityTaxExemption,
  setCityTaxPassOn,
  updateCityTaxRule,
  type CityTaxChange,
  type CityTaxExemption,
  type CityTaxReport,
  type CityTaxRuleView,
} from "./tenant/city-tax";
export { ApprovalRequired, decideApproval, findApproval, listApprovals, requestApproval, type Approval, type ApprovalSubject } from "./tenant/approvals";
export { overrideNightPrices } from "./tenant/price-override";
export { auditLog, type AuditArea, type AuditEntry, type AuditFilter } from "./tenant/audit-log";
export {
  closeNightAudit,
  keepNightAuditPdf,
  listNightAuditReports,
  markAuditAlerted,
  nightAuditReport,
  nightAuditView,
  overdueAudits,
  saveArrivalDecision,
  type AuditWarnings,
  type MissingArrival,
  type NightAuditReport,
  type NightAuditReportRow,
  type NightAuditView,
  type OverdueDeparture,
} from "./tenant/night-audit";
export {
  assignHousekeeping,
  createRoomBlock,
  endRoomBlock,
  listRoomStates,
  propertyOfRoom,
  setCleanliness,
  setInspectionRequired,
  type BlockConflict,
  type RoomBlock,
  type RoomState,
  type Viewer,
} from "./tenant/room-state";
export {
  TaskStarted,
  failInspection,
  generateHousekeepingTasks,
  housekeepingBoard,
  moveHousekeepingTask,
  propertyOfTask,
  proposeHousekeeping,
  publishHousekeeping,
  setWaitingForRoom,
  setHousekeepingRules,
  setRoomTypeHousekeeping,
  workHousekeepingTask,
  type BoardTask,
  type HousekeepingBoard,
} from "./tenant/housekeeping";
export {
  addHousekeepingNote,
  applyPhoneChange,
  floorDay,
  floorPhoto,
  listHousekeepingNotes,
  listLostItems,
  removeHousekeepingNote,
  setLostItemStatus,
  type FloorDay,
  type FloorIssue,
  type FloorNote,
  type FloorTask,
  type LostItem,
  decodePhoto,
  phoneChangeSeen,
  type PhoneChangeOutcome,
} from "./tenant/floor";
export {
  cashBook,
  cashMovementPhoto,
  cashSettings,
  closeShiftWithReason,
  createCashRegister,
  listCashRegisters,
  myOpenShift,
  openShift,
  OpeningDifference,
  receiptByToken,
  receiptsOfReservation,
  recordCashMovement,
  setCashDesk,
  setCashRegisterActive,
  submitCloseCount,
  type CashBookRow,
  type CashMovementInput,
  type CashRegister,
  type CashSettings,
  type CloseResult,
  type OpenShift,
  type OpenShiftInfo,
  type ReceiptView,
} from "./tenant/cash";
export {
  addClosedPeriod,
  dueTourismReport,
  dueTourismReports,
  removeClosedPeriod,
  setStatsExclusion,
  setStatsSettings,
  statsDeadline,
  statsExclusionOf,
  statsSettings,
  submitTourismReport,
  tourismReport,
  type StatsSettings,
  type TourismReportData,
  type TourismReportVersion,
} from "./tenant/tourism-stats";
export { claimIncidentsToAlert,
  addSupportStaff,
  endSupportAccess,
  isSupportStaff,
  listSupportAccesses,
  listTenantsForSupport,
  redeemSupportHandoff,
  reportIncident,
  scheduleMaintenance,
  startSupportAccess,
  statusPage,
  supportSessionFor,
  updateIncident,
  type Incident,
  type StatusPage,
  type SupportAccessEntry,
  type SupportSession,
} from "./control/support";
export { logReportExport, runReport, type ReportRequest } from "./tenant/reports";
export { createReportSchedule, deleteReportSchedule, dueReportSchedules, listReportSchedules, markReportScheduleSent, stopReportSchedule, type ReportSchedule, type ScheduleOptions } from "./tenant/report-schedules";
export { dispatchOutboxes, queueMail, queueSms, type OutgoingMail } from "./tenant/mail-outbox";
export { catchUp, downtimeSet, emergencyReport, endOutage, getDowntimeOptions, listOutages, logOutage, setDowntimeOptions, type CatchUpInput, type DowntimeGuestRow, type DowntimeSet, type EmergencyReport, type Outage, type RoomRackRow } from "./tenant/downtime";
export {
  addRegistrationPerson,
  completeRegistrationPerson,
  confirmSignedOnPaper,
  deleteExpiredRegistrations,
  findRegistration,
  openRegistration,
  recordIdCheck,
  registrationDocument,
  registrationPdf,
  registrationPersonProperty,
  renderRegistration,
  TabletProblem,
  sendToTablet,
  tabletState,
  tabletStep,
  takeBackFromTablet,
  type GuestDetails,
  type PersonInput,
  type RegistrationDocument,
  type RegistrationPersonView,
  type RegistrationView,
  type TabletInput,
  type TabletPerson,
  type TabletState,
} from "./tenant/registration";
export { getBudget, setBudget } from "./tenant/budget";
export { BUILDER_ROW_LIMIT, RAW_ROW_LIMIT, deleteSavedReport, listSavedReports, runBuilder, saveReport, type SavedReport } from "./tenant/report-builder";
export { modulePeriods, propertyModules, setModuleStep, switchModuleOff, switchModuleOn, type PropertyModule } from "./tenant/modules";
export { getSubscription, issueSubscriptionInvoices, listSubscriptionInvoices, pricesOn, recordUsage, setBankTransfer, setDirectDebit, setPrice, setYearly, subscriptionInvoiceFile, type Subscription, type SubscriptionInvoiceRow } from "./control/subscription";
export { claimDueReminders, deleteEndedTenants, deleteFilesOfDeletedTenants, endTenant, markSubscriptionInvoicePaid, markSubscriptionInvoicePaidByNumber, nonPaymentStatus, releaseReminder, tenantEnd, type NonPaymentStatus } from "./control/exit";
export { exitExport } from "./tenant/exit-export";
export {
  checkSenderDomain,
  dispatchMessages,
  messageText,
  messagingSettings,
  previewMessage,
  queueGuestMessageIn,
  recordMailEvent,
  reservationMessages,
  resetMessageText,
  scanGuestMessages,
  sendGuestMessage,
  sendTestMessage,
  setMessageText,
  setMessagingSettings,
  setSenderDomain,
  type BouncedMessage,
  type GuestMessageRow,
  type MessageStatus,
  type PortalLinks,
  type MessagingSettings,
  type MessagingSettingsInput,
} from "./tenant/messages";
export { FileRefused, MAX_FILE_BYTES, deleteExpiredFiles, findFile, storeFile, type FileKind, type StoredFile } from "./tenant/files";
export { fixIssue, listIssues, reportIssue, seesIssues, takeIssue, visibleFile, type FixedIssue, type IssueFix, type IssueReport, type IssueRow } from "./tenant/maintenance";
export { channelConnection, channelOverview, connectChannels, connectedProperties, enqueueFullPushOf, enqueueFullPushes, pruneChannelOutbox, pushChannels, type ChannelConnection, type ChannelOverview, type PushResult } from "./tenant/channels";
export { CHANNEL_USER, applyChannelRevision, channelProblems, channelSettings, ensureBookingWebhook, processChannelFeed, resolveChannelProblem, setChannelSetting, setGoogleChannel, type AppliedRevision, type ChannelProblem, type ChannelSetting, type FeedResult } from "./tenant/channel-bookings";
export { MAX_COMPANIONS, PORTAL_USER, addPortalDocument, addPortalExtra, invitePortalGuest, portalInvoice, portalKeys, portalPhoto, portalSettings, portalSummary, portalView, type BookingRoom, type Companion, setPortalSettings, type PortalSummary, requestPortalCode, revokePortalLink, savePrecheckin, verifyPortalCode, type PortalView, type PrecheckinInput } from "./tenant/portal";
export { cardGuaranteeOf, chargeStoredCard, claimDeclineNotice, closeUnfinishedPortalPayments, expressCheckout, expressCheckoutView, finishCardSetup, finishPortalPayment, portalProviderRef, startCardSetup, startPortalPayment, type CardGuarantee, type ExpressCheckout, type PortalPaymentResult, type PortalPaymentStart } from "./tenant/portal-payments";
