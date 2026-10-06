import { sql } from "drizzle-orm";
import { bigserial, boolean, customType, date, numeric, check, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

/** Control schema (ADR 0006). Mirrors migrations/control/*.sql; the SQL is the source of truth. */
export const control = pgSchema("control");

export const tenants = control.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  schemaName: text("schema_name").notNull().unique(),
  accent: text("accent").notNull().default("ocean"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  trialKind: text("trial_kind"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  goLiveCheckedBy: text("go_live_checked_by").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  goLiveCheckedAt: timestamp("go_live_checked_at", { withTimezone: true }),
  goLiveCheckedSetup: jsonb("go_live_checked_setup"),
  liveAt: timestamp("live_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedReason: text("ended_reason"),
  deletionDue: date("deletion_due"),
}, (t) => [check("tenants_end_check", sql`(${t.endedAt} is null) = (${t.deletionDue} is null)`)]);

export const tenantMigrations = control.table(
  "tenant_migrations",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.version] })],
);

// Better Auth tables. Column names match the SQL migration; Better Auth sees the property names.
export const user = control.table(
  "user",
  {
    id: text("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    username: text("username"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    pinOnly: boolean("pin_only").notNull().default(false),
  },
  (t) => [index("user_tenant_idx").on(t.tenantId), uniqueIndex("user_tenant_username_idx").on(t.tenantId, sql`lower(${t.username})`)],
);

export const session = control.table(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = control.table(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = control.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const userPreferences = control.table("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  theme: text("theme").notNull().default("system"),
  quickAccess: jsonb("quick_access"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  floorLanguage: text("floor_language"),
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(false),
  notifyPhone: text("notify_phone"),
  inboxSound: boolean("inbox_sound").notNull().default(false),
}, (t) => [
  check("user_preferences_floor_language_check", sql`${t.floorLanguage} in ('de', 'en', 'pl', 'ro', 'bg', 'hr', 'hu', 'tr', 'uk', 'ar')`),
  check("user_preferences_notify_phone_check", sql`${t.notifyPhone} ~ '^\\+[1-9][0-9]{6,14}$'`),
]);

export const userWorkspace = control.table(
  "user_workspace",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    propertyScope: text("property_scope").notNull(),
    pinnedTabs: jsonb("pinned_tabs").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.propertyScope] })],
);

export const notifications = control.table(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_tenant_user_idx").on(t.tenantId, t.userId, t.id)],
);

export const webhookEvents = control.table(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    headers: jsonb("headers").notNull(),
    body: jsonb("body"),
    rawBody: text("raw_body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("received"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [unique("webhook_events_source_external_id_key").on(t.source, t.externalId)],
);

export const externalIds = control.table(
  "external_ids",
  {
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.externalId] })],
);

export const devices = control.table(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    kind: text("kind").notNull(),
    guestMode: text("guest_mode").notNull().default("tablet"),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    handoffHash: text("handoff_hash").notNull().unique(),
    handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }).notNull(),
    sessionHash: text("session_hash").unique(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    enrolledBy: text("enrolled_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastUserId: text("last_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [index("devices_tenant_property_idx").on(t.tenantId, t.propertyId), check("devices_kind_check", sql`${t.kind} in ('staff', 'guest')`), check("devices_guest_mode_check", sql`${t.guestMode} in ('tablet', 'kiosk')`)],
);

export const deviceUsers = control.table(
  "device_users",
  {
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.userId] })],
);

export const deviceEnrolments = control.table(
  "device_enrolments",
  {
    codeHash: text("code_hash").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    kind: text("kind").notNull(),
    guestMode: text("guest_mode").notNull().default("tablet"),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    userIds: text("user_ids").array().notNull().default(sql`'{}'`),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [check("device_enrolments_kind_check", sql`${t.kind} in ('staff', 'guest')`), check("device_enrolments_guest_mode_check", sql`${t.guestMode} in ('tablet', 'kiosk')`)],
);

export const deviceSessions = control.table(
  "device_sessions",
  {
    sessionId: text("session_id").primaryKey().references(() => session.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    idleMinutes: integer("idle_minutes").notNull().default(2),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_sessions_device_idx").on(t.deviceId), check("device_sessions_idle_minutes_check", sql`${t.idleMinutes} between 1 and 10`)],
);

export const userPins = control.table("user_pins", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  failedCount: integer("failed_count").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  mustChange: boolean("must_change").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pinEvents = control.table(
  "pin_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    byUserId: text("by_user_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pin_events_user_idx").on(t.userId, t.at.desc()), check("pin_events_kind_check", sql`${t.kind} in ('success', 'wrong', 'lock', 'reset', 'changed')`)],
);

export const deviceChangeKeys = control.table(
  "device_change_keys",
  {
    keyHash: text("key_hash").primaryKey(),
    deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("device_change_keys_device_idx").on(t.deviceId)],
);

export const supportStaff = control.table("support_staff", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  addedBy: text("added_by"),
});

export const supportAccesses = control.table(
  "support_accesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffUserId: text("staff_user_id").notNull().references(() => user.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("support_accesses_tenant_idx").on(t.tenantId, t.startedAt.desc()), check("support_accesses_reason_check", sql`length(trim(${t.reason})) >= 10`)],
);

export const statusIncidents = control.table(
  "status_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    impact: text("impact").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
  },
  (t) => [
    check("status_incidents_title_check", sql`length(trim(${t.title})) > 0`),
    check("status_incidents_impact_check", sql`${t.impact} in ('minor', 'major')`),
    check("status_incidents_resolved_check", sql`${t.resolvedAt} is null or ${t.resolvedAt} >= ${t.startedAt}`),
  ],
);

export const statusIncidentUpdates = control.table(
  "status_incident_updates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    incidentId: uuid("incident_id").notNull().references(() => statusIncidents.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    message: text("message").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    byUser: text("by_user").notNull(),
  },
  (t) => [index("status_incident_updates_incident_idx").on(t.incidentId, t.at), check("status_incident_updates_state_check", sql`${t.state} in ('investigating', 'identified', 'monitoring', 'resolved')`)],
);

export const maintenanceWindows = control.table(
  "maintenance_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [check("maintenance_windows_dates_check", sql`${t.endsAt} > ${t.startsAt}`)],
);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const priceList = control.table(
  "price_list",
  {
    key: text("key").notNull(),
    validFrom: date("valid_from").notNull(),
    unit: text("unit").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    setBy: text("set_by"),
  },
  (t) => [primaryKey({ columns: [t.key, t.validFrom] }), check("price_list_unit_check", sql`${t.unit} in ('room', 'property', 'percent')`), check("price_list_amount_check", sql`${t.amount} >= 0`)],
);

export const platformSeller = control.table(
  "platform_seller",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name").notNull(),
    addressLine1: text("address_line1").notNull(),
    postalCode: text("postal_code").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    vatId: text("vat_id"),
    taxNumber: text("tax_number"),
    iban: text("iban"),
    bic: text("bic"),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
  },
  (t) => [check("platform_seller_one", sql`${t.id}`)],
);

export const subscriptions = control.table(
  "subscriptions",
  {
    tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    yearlyFrom: date("yearly_from"),
    paymentMethod: text("payment_method").notNull().default("sepa"),
    accountHolder: text("account_holder"),
    mandateReference: text("mandate_reference"),
    cardToken: text("card_token"),
    accountLast4: text("account_last4"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [check("subscriptions_method_check", sql`${t.paymentMethod} in ('sepa', 'card', 'transfer')`)],
);

export const usageEvents = control.table(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull(),
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    propertyId: uuid("property_id"),
  },
  (t) => [check("usage_events_quantity_check", sql`${t.quantity} > 0`), check("usage_events_cost_check", sql`${t.cost} >= 0`), index("usage_events_tenant_idx").on(t.tenantId, t.at), index("usage_events_property_idx").on(t.tenantId, t.propertyId, t.kind, t.at)],
);

export const roomCounts = control.table(
  "room_counts",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull(),
    month: date("month").notNull(),
    rooms: integer("rooms").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.propertyId, t.month] })],
);

export const subscriptionInvoices = control.table(
  "subscription_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    month: date("month").notNull(),
    number: text("number").notNull().unique(),
    document: jsonb("document").notNull(),
    pdf: bytea("pdf"),
    xml: text("xml"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: text("paid_by"),
  },
  (t) => [unique("subscription_invoices_once").on(t.tenantId, t.legalEntityId, t.month)],
);

export const subscriptionReminders = control.table(
  "subscription_reminders",
  {
    invoiceId: uuid("invoice_id").notNull().references(() => subscriptionInvoices.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.day] })],
);

export const tenantDeletions = control.table("tenant_deletions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedReason: text("ended_reason"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  deletedBy: text("deleted_by").notNull(),
  filesDeletedAt: timestamp("files_deleted_at", { withTimezone: true }),
});

export const counters = control.table("counters", {
  key: text("key").primaryKey(),
  last: integer("last").notNull().default(0),
});

export const senderDomains = control.table("sender_domains", {
  domain: text("domain").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bridgeTokens = control.table("bridge_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bridgeId: uuid("bridge_id").notNull().unique("bridge_tokens_bridge_id_key"),
});

export const bridgePluginVersions = control.table(
  "bridge_plugin_versions",
  {
    name: text("name").notNull(),
    version: text("version").notNull(),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    sha256: text("sha256").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.name, t.version] }),
    check("bridge_plugin_versions_name_check", sql`${t.name} ~ '^[a-z0-9-]{2,40}$'`),
    check("bridge_plugin_versions_version_check", sql`${t.version} ~ '^\\d+\\.\\d+\\.\\d+$'`),
    check("bridge_plugin_versions_kind_check", sql`${t.kind} in ('lock', 'till')`),
  ],
);

export const controlSchema = {
  bridgeTokens,
  bridgePluginVersions,
  senderDomains,
  supportStaff,
  supportAccesses,
  statusIncidents,
  statusIncidentUpdates,
  maintenanceWindows,
  deviceChangeKeys,
  devices,
  deviceUsers,
  deviceEnrolments,
  deviceSessions,
  userPins,
  pinEvents,
  tenants,
  tenantMigrations,
  user,
  session,
  account,
  verification,
  userPreferences,
  userWorkspace,
  notifications,
  webhookEvents,
  externalIds,
  priceList,
  platformSeller,
  subscriptions,
  usageEvents,
  roomCounts,
  subscriptionInvoices,
  counters,
  subscriptionReminders,
  tenantDeletions,
};
