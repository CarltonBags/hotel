import { sql } from "drizzle-orm";
import { bigserial, boolean, char, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Tenant tables are declared UNQUALIFIED (pgTable, no schema): the same
 * definition serves every tenant through the transaction's search path.
 * Never use pgSchema(...) here. Mirrors migrations/tenant/*.sql.
 */
export const tenantSettings = pgTable("tenant_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  addressLine1: text("address_line1").notNull().default(""),
  addressLine2: text("address_line2").notNull().default(""),
  postalCode: text("postal_code").notNull().default(""),
  city: text("city").notNull().default(""),
  country: char("country", { length: 2 }).notNull(),
  vatId: text("vat_id").notNull().default(""),
  iban: text("iban").notNull().default(""),
  bic: text("bic").notNull().default(""),
  accountHolder: text("account_holder").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    name: text("name").notNull(),
    country: char("country", { length: 2 }).notNull(),
    timeZone: text("time_zone").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("properties_legal_entity_idx").on(t.legalEntityId)],
);

export const roomTypes = pgTable(
  "room_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    names: jsonb("names").notNull().default({}),
    maxOccupancy: integer("max_occupancy").notNull(),
    maxAdults: integer("max_adults").notNull(),
    bedPlaces: integer("bed_places").notNull().default(2),
    extraBeds: integer("extra_beds").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("room_types_property_id_code_key").on(t.propertyId, t.code),
    check("room_types_max_occupancy_check", sql`${t.maxOccupancy} >= 1`),
    check("room_types_max_adults_check", sql`${t.maxAdults} >= 1`),
    check("room_types_bed_places_check", sql`${t.bedPlaces} >= 0`),
    check("room_types_extra_beds_check", sql`${t.extraBeds} >= 0`),
  ],
);

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [unique("sections_property_id_name_key").on(t.propertyId, t.name)],
);

export const roomFeatures = pgTable(
  "room_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    names: jsonb("names").notNull().default({}),
  },
  (t) => [unique("room_features_property_id_code_key").on(t.propertyId, t.code)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
    number: text("number").notNull(),
    name: text("name").notNull().default(""),
    names: jsonb("names").notNull().default({}),
    floor: text("floor").notNull().default(""),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    bedPlaces: integer("bed_places").notNull(),
    extraBeds: integer("extra_beds").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("rooms_property_id_number_key").on(t.propertyId, t.number),
    index("rooms_property_type_idx").on(t.propertyId, t.roomTypeId),
    check("rooms_bed_places_check", sql`${t.bedPlaces} >= 0`),
    check("rooms_extra_beds_check", sql`${t.extraBeds} >= 0`),
  ],
);

export const roomFeatureAssignments = pgTable(
  "room_feature_assignments",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => roomFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.featureId] })],
);

export const roomCapacityHistory = pgTable(
  "room_capacity_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    validFrom: date("valid_from").notNull(),
    bedPlaces: integer("bed_places").notNull(),
    extraBeds: integer("extra_beds").notNull(),
  },
  (t) => [
    unique("room_capacity_history_room_id_valid_from_key").on(t.roomId, t.validFrom),
    check("room_capacity_history_bed_places_check", sql`${t.bedPlaces} >= 0`),
    check("room_capacity_history_extra_beds_check", sql`${t.extraBeds} >= 0`),
  ],
);

export const ageBands = pgTable(
  "age_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    minAge: integer("min_age").notNull(),
    maxAge: integer("max_age"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("age_bands_property_idx").on(t.propertyId, t.minAge),
    check("age_bands_min_age_check", sql`${t.minAge} >= 0`),
    check("age_bands_max_age_check", sql`${t.maxAge} is null or ${t.maxAge} >= ${t.minAge}`),
  ],
);

export const taxCodes = pgTable(
  "tax_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalEntityId: uuid("legal_entity_id")
      .notNull()
      .references(() => legalEntities.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tax_codes_legal_entity_id_code_key").on(t.legalEntityId, t.code)],
);

export const taxCodeRates = pgTable(
  "tax_code_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taxCodeId: uuid("tax_code_id")
      .notNull()
      .references(() => taxCodes.id, { onDelete: "cascade" }),
    validFrom: date("valid_from").notNull(),
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  },
  (t) => [unique("tax_code_rates_tax_code_id_valid_from_key").on(t.taxCodeId, t.validFrom), check("tax_code_rates_rate_check", sql`${t.rate} >= 0 and ${t.rate} <= 100`)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    names: jsonb("names").notNull().default({}),
    defaultPrice: numeric("default_price", { precision: 12, scale: 2 }).notNull(),
    taxCodeId: uuid("tax_code_id")
      .notNull()
      .references(() => taxCodes.id),
    revenueAccount: text("revenue_account").notNull().default(""),
    postingRhythm: text("posting_rhythm").notNull(),
    bookableOnline: boolean("bookable_online").notNull().default(false),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("services_property_id_code_key").on(t.propertyId, t.code),
    index("services_property_idx").on(t.propertyId, t.sortOrder),
    check("services_default_price_check", sql`${t.defaultPrice} >= 0`),
    check("services_posting_rhythm_check", sql`${t.postingRhythm} in ('once', 'per_night', 'per_person_night')`),
  ],
);

export const tenantSchema = {
  tenantSettings,
  legalEntities,
  properties,
  roomTypes,
  sections,
  roomFeatures,
  rooms,
  roomFeatureAssignments,
  roomCapacityHistory,
  ageBands,
  taxCodes,
  taxCodeRates,
  services,
};
