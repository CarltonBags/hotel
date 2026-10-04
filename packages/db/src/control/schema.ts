import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Control schema (ADR 0006). Mirrors migrations/control/*.sql; the SQL is the source of truth. */
export const control = pgSchema("control");

export const tenants = control.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  schemaName: text("schema_name").notNull().unique(),
  accent: text("accent").notNull().default("ocean"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
}, (t) => [check("user_preferences_floor_language_check", sql`${t.floorLanguage} in ('de', 'en', 'pl', 'ro', 'bg', 'hr', 'hu', 'tr', 'uk', 'ar')`)]);

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
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    enrolledBy: text("enrolled_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastUserId: text("last_user_id").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [index("devices_tenant_property_idx").on(t.tenantId, t.propertyId), check("devices_kind_check", sql`${t.kind} in ('staff', 'guest')`)],
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
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    userIds: text("user_ids").array().notNull().default(sql`'{}'`),
    createdBy: text("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [check("device_enrolments_kind_check", sql`${t.kind} in ('staff', 'guest')`)],
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

export const controlSchema = {
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
};
