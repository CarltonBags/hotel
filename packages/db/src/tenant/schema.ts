import { sql } from "drizzle-orm";
import { bigserial, boolean, char, check, date, foreignKey, index, pgSequence, integer, jsonb, numeric, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

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
    priceFloor: numeric("price_floor", { precision: 12, scale: 2 }),
  },
  (t) => [
    unique("room_types_property_id_code_key").on(t.propertyId, t.code),
    check("room_types_max_occupancy_check", sql`${t.maxOccupancy} >= 1`),
    check("room_types_max_adults_check", sql`${t.maxAdults} >= 1`),
    check("room_types_bed_places_check", sql`${t.bedPlaces} >= 0`),
    check("room_types_extra_beds_check", sql`${t.extraBeds} >= 0`),
    check("room_types_price_floor_check", sql`${t.priceFloor} is null or ${t.priceFloor} >= 0`),
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

export const paymentPolicies = pgTable(
  "payment_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    depositPercent: numeric("deposit_percent", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payment_policies_property_id_name_key").on(t.propertyId, t.name),
    check("payment_policies_kind_check", sql`${t.kind} in ('full', 'deposit_percent', 'deposit_first_night', 'card_guarantee', 'none')`),
    check("payment_policies_deposit_percent_check", sql`${t.depositPercent} is null or (${t.depositPercent} > 0 and ${t.depositPercent} <= 100)`),
    check("payment_policies_deposit_kind_check", sql`(${t.kind} = 'deposit_percent') = (${t.depositPercent} is not null)`),
  ],
);

export const cancellationPolicies = pgTable(
  "cancellation_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    freeUntilDays: integer("free_until_days"),
    freeUntilTime: time("free_until_time").notNull().default("18:00"),
    feeKind: text("fee_kind").notNull(),
    feePercent: numeric("fee_percent", { precision: 5, scale: 2 }),
    noShowFeeKind: text("no_show_fee_kind").notNull(),
    noShowFeePercent: numeric("no_show_fee_percent", { precision: 5, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("cancellation_policies_property_id_name_key").on(t.propertyId, t.name),
    check("cancellation_policies_free_until_days_check", sql`${t.freeUntilDays} is null or ${t.freeUntilDays} >= 0`),
    check("cancellation_policies_fee_kind_check", sql`${t.feeKind} in ('none', 'first_night', 'percent', 'full_stay')`),
    check("cancellation_policies_fee_percent_check", sql`${t.feePercent} is null or (${t.feePercent} > 0 and ${t.feePercent} <= 100)`),
    check("cancellation_policies_no_show_fee_kind_check", sql`${t.noShowFeeKind} in ('none', 'first_night', 'percent', 'full_stay')`),
    check("cancellation_policies_no_show_fee_percent_check", sql`${t.noShowFeePercent} is null or (${t.noShowFeePercent} > 0 and ${t.noShowFeePercent} <= 100)`),
    check("cancellation_policies_fee_pair_check", sql`(${t.feeKind} = 'percent') = (${t.feePercent} is not null)`),
    check("cancellation_policies_no_show_fee_pair_check", sql`(${t.noShowFeeKind} = 'percent') = (${t.noShowFeePercent} is not null)`),
  ],
);

export const ratePlans = pgTable(
  "rate_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    names: jsonb("names").$type<Record<string, string>>().notNull().default({}),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull().default({}),
    policyTexts: jsonb("policy_texts").$type<Record<string, string>>().notNull().default({}),
    kind: text("kind").notNull(),
    basePlanId: uuid("base_plan_id").references((): AnyPgColumn => ratePlans.id),
    derivationKind: text("derivation_kind"),
    derivationValue: numeric("derivation_value", { precision: 12, scale: 2 }),
    inherits: jsonb("inherits").$type<Record<string, boolean>>().notNull().default({}),
    baseOccupancy: integer("base_occupancy").notNull().default(2),
    mealPlan: text("meal_plan").notNull().default("none"),
    paymentPolicyId: uuid("payment_policy_id").notNull().references(() => paymentPolicies.id),
    cancellationPolicyId: uuid("cancellation_policy_id").notNull().references(() => cancellationPolicies.id),
    dateChangeAllowed: boolean("date_change_allowed").notNull().default(true),
    earlyDepartureFeeKind: text("early_departure_fee_kind").notNull().default("none"),
    earlyDepartureFeePercent: numeric("early_departure_fee_percent", { precision: 5, scale: 2 }),
    public: boolean("public").notNull().default(true),
    rateCode: text("rate_code"),
    soldOnChannels: boolean("sold_on_channels").notNull().default(true),
    companyId: uuid("company_id").references((): AnyPgColumn => companies.id),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("rate_plans_property_id_code_key").on(t.propertyId, t.code),
    index("rate_plans_property_idx").on(t.propertyId, t.sortOrder),
    index("rate_plans_base_idx").on(t.basePlanId).where(sql`${t.basePlanId} is not null`),
    check("rate_plans_kind_check", sql`${t.kind} in ('base', 'derived')`),
    check("rate_plans_derivation_kind_check", sql`${t.derivationKind} in ('amount', 'percent')`),
    check("rate_plans_derived_check", sql`(${t.kind} = 'derived') = (${t.basePlanId} is not null and ${t.derivationKind} is not null and ${t.derivationValue} is not null)`),
    check("rate_plans_base_occupancy_check", sql`${t.baseOccupancy} >= 1`),
    check("rate_plans_meal_plan_check", sql`${t.mealPlan} in ('none', 'breakfast', 'half_board', 'full_board')`),
    check("rate_plans_early_departure_fee_kind_check", sql`${t.earlyDepartureFeeKind} in ('none', 'first_night', 'percent', 'full_stay')`),
    check("rate_plans_early_departure_fee_percent_check", sql`${t.earlyDepartureFeePercent} is null or (${t.earlyDepartureFeePercent} > 0 and ${t.earlyDepartureFeePercent} <= 100)`),
    check("rate_plans_early_departure_fee_pair_check", sql`(${t.earlyDepartureFeeKind} = 'percent') = (${t.earlyDepartureFeePercent} is not null)`),
    check("rate_plans_rate_code_check", sql`${t.public} or ${t.rateCode} is not null`),
  ],
);

export const ratePlanRoomTypes = pgTable(
  "rate_plan_room_types",
  {
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
  },
  (t) => [primaryKey({ columns: [t.ratePlanId, t.roomTypeId] })],
);

export const ratePlanSupplements = pgTable(
  "rate_plan_supplements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ageBandId: uuid("age_band_id").references(() => ageBands.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    uniqueIndex("rate_plan_supplements_key").on(t.ratePlanId, t.kind, sql`coalesce(${t.ageBandId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    check("rate_plan_supplements_kind_check", sql`${t.kind} in ('single', 'extra_adult', 'child')`),
    check("rate_plan_supplements_age_band_check", sql`(${t.kind} = 'child') = (${t.ageBandId} is not null)`),
  ],
);

export const ratePlanServices = pgTable(
  "rate_plan_services",
  {
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    componentPrice: numeric("component_price", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ratePlanId, t.serviceId] }), check("rate_plan_services_component_price_check", sql`${t.componentPrice} >= 0`)],
);

export const rates = pgTable(
  "rates",
  {
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    date: date("date").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ratePlanId, t.roomTypeId, t.date] }), check("rates_price_check", sql`${t.price} >= 0`)],
);

export const restrictions = pgTable(
  "restrictions",
  {
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    date: date("date").notNull(),
    stopSell: boolean("stop_sell").notNull().default(false),
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
    minStayArrival: integer("min_stay_arrival"),
    minStayThrough: integer("min_stay_through"),
    maxStay: integer("max_stay"),
  },
  (t) => [
    primaryKey({ columns: [t.ratePlanId, t.roomTypeId, t.date] }),
    check("restrictions_min_stay_arrival_check", sql`${t.minStayArrival} is null or ${t.minStayArrival} >= 1`),
    check("restrictions_min_stay_through_check", sql`${t.minStayThrough} is null or ${t.minStayThrough} >= 1`),
    check("restrictions_max_stay_check", sql`${t.maxStay} is null or ${t.maxStay} >= 1`),
  ],
);

export const rateChanges = pgTable(
  "rate_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changeId: uuid("change_id").notNull(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    date: date("date").notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason").notNull().default("edit"),
    undoneBy: uuid("undone_by"),
  },
  (t) => [index("rate_changes_change_idx").on(t.changeId), index("rate_changes_property_idx").on(t.propertyId, t.at.desc())],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    vatId: text("vat_id"),
    addressLine1: text("address_line1").notNull().default(""),
    addressLine2: text("address_line2").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    city: text("city").notNull().default(""),
    country: char("country", { length: 2 }),
    billingEmail: text("billing_email"),
    phone: text("phone"),
    contactPerson: text("contact_person").notNull().default(""),
    paymentTermsDays: integer("payment_terms_days").notNull().default(14),
    onAccount: boolean("on_account").notNull().default(false),
    routing: text("routing").array().notNull().default(sql`'{}'`),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("companies_name_idx").on(sql`lower(${t.name})`),
    check("companies_payment_terms_check", sql`${t.paymentTermsDays} between 0 and 365`),
    check("companies_routing_check", sql`${t.routing} <@ array['accommodation', 'package', 'extras', 'city_tax']::text[]`),
  ],
);

export const companyChanges = pgTable(
  "company_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
  },
  (t) => [index("company_changes_company_idx").on(t.companyId, t.at.desc())],
);

export const guests = pgTable(
  "guests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    nationality: char("nationality", { length: 2 }),
    countryOfResidence: char("country_of_residence", { length: 2 }),
    postalCode: text("postal_code"),
    addressLine1: text("address_line1").notNull().default(""),
    city: text("city").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    emailNormalised: text("email_normalised"),
    phoneNormalised: text("phone_normalised"),
    language: text("language"),
    preferences: text("preferences").notNull().default(""),
    vip: boolean("vip").notNull().default(false),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    marketingConsentAt: timestamp("marketing_consent_at", { withTimezone: true }),
    marketingConsentSource: text("marketing_consent_source"),
    documentType: text("document_type"),
    documentNumber: text("document_number"),
    documentCountry: char("document_country", { length: 2 }),
    documentExpiry: date("document_expiry"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    createdPropertyId: uuid("created_property_id").references(() => properties.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("guests_email_idx").on(t.emailNormalised).where(sql`${t.emailNormalised} is not null`),
    index("guests_phone_idx").on(t.phoneNormalised).where(sql`${t.phoneNormalised} is not null`),
    index("guests_name_idx").on(sql`lower(${t.lastName})`, sql`lower(${t.firstName})`),
    check("guests_consent_proof_check", sql`not ${t.marketingConsent} or (${t.marketingConsentAt} is not null and ${t.marketingConsentSource} is not null)`),
    check("guests_document_type_check", sql`${t.documentType} in ('passport', 'id_card', 'driving_licence', 'other')`),
  ],
);

export const guestChanges = pgTable(
  "guest_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
  },
  (t) => [index("guest_changes_guest_idx").on(t.guestId, t.at.desc())],
);

export const guestMerges = pgTable(
  "guest_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keptId: uuid("kept_id").notNull(),
    mergedId: uuid("merged_id").notNull(),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    filledFields: text("filled_fields").array().notNull().default(sql`'{}'`),
    movedRecords: integer("moved_records").notNull().default(0),
  },
  (t) => [index("guest_merges_kept_idx").on(t.keptId)],
);

export const bookingNumberSeq = pgSequence("booking_number_seq", { startWith: 100001 });

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    confirmationNumber: text("confirmation_number").notNull().default(sql`nextval('booking_number_seq')::text`),
    bookerGuestId: uuid("booker_guest_id").references(() => guests.id),
    bookerCompanyId: uuid("booker_company_id").references(() => companies.id),
    source: text("source").notNull().default("direct"),
    channelName: text("channel_name"),
    walkIn: boolean("walk_in").notNull().default(false),
    rateCode: text("rate_code"),
    rateCodeCompanyId: uuid("rate_code_company_id").references(() => companies.id),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    unique("bookings_confirmation_number_key").on(t.confirmationNumber),
    index("bookings_property_idx").on(t.propertyId, t.createdAt.desc()),
    check("bookings_booker_check", sql`(${t.bookerGuestId} is null) <> (${t.bookerCompanyId} is null)`),
    check("bookings_source_check", sql`${t.source} in ('direct', 'channel')`),
    check("bookings_walk_in_check", sql`not ${t.walkIn} or ${t.source} = 'direct'`),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    ratePlanId: uuid("rate_plan_id").notNull().references(() => ratePlans.id),
    arrival: date("arrival").notNull(),
    departure: date("departure").notNull(),
    adults: integer("adults").notNull(),
    childAges: integer("child_ages").array().notNull().default(sql`'{}'`),
    status: text("status").notNull().default("confirmed"),
    primaryGuestId: uuid("primary_guest_id").notNull().references(() => guests.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("reservations_booking_idx").on(t.bookingId),
    index("reservations_availability_idx").on(t.propertyId, t.roomTypeId, t.arrival, t.departure).where(sql`${t.status} in ('confirmed', 'checked_in')`),
    index("reservations_guest_idx").on(t.primaryGuestId),
    check("reservations_dates_check", sql`${t.departure} > ${t.arrival}`),
    check("reservations_adults_check", sql`${t.adults} >= 1`),
    check("reservations_status_check", sql`${t.status} in ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')`),
  ],
);

export const reservationNights = pgTable(
  "reservation_nights",
  {
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.reservationId, t.date] }), check("reservation_nights_total_check", sql`${t.total} >= 0`)],
);

export const reservationNightComponents = pgTable(
  "reservation_night_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull(),
    date: date("date").notNull(),
    kind: text("kind").notNull(),
    serviceId: uuid("service_id").references(() => services.id),
    persons: integer("persons"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    foreignKey({ name: "reservation_night_components_reservation_id_date_fkey", columns: [t.reservationId, t.date], foreignColumns: [reservationNights.reservationId, reservationNights.date] }).onDelete("cascade"),
    index("reservation_night_components_night_idx").on(t.reservationId, t.date),
    check("reservation_night_components_kind_check", sql`${t.kind} in ('room', 'service')`),
    check("reservation_night_components_service_check", sql`(${t.kind} = 'service') = (${t.serviceId} is not null)`),
    check("reservation_night_components_amount_check", sql`${t.amount} >= 0`),
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
  paymentPolicies,
  cancellationPolicies,
  ratePlans,
  ratePlanRoomTypes,
  ratePlanSupplements,
  ratePlanServices,
  rates,
  restrictions,
  rateChanges,
  companies,
  companyChanges,
  guests,
  guestChanges,
  guestMerges,
  bookings,
  reservations,
  reservationNights,
  reservationNightComponents,
};
