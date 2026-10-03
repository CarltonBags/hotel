import { sql } from "drizzle-orm";
import { bigserial, customType, boolean, char, check, date, foreignKey, index, pgSequence, integer, jsonb, numeric, pgTable, primaryKey, text, time, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Tenant tables are declared UNQUALIFIED (pgTable, no schema): the same
 * definition serves every tenant through the transaction's search path.
 * Never use pgSchema(...) here. Mirrors migrations/tenant/*.sql.
 */
/** Binary columns (issued invoice files). */
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

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
  taxNumber: text("tax_number").notNull().default(""),
  invoiceEmail: text("invoice_email").notNull().default(""),
  invoicePhone: text("invoice_phone").notNull().default(""),
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
    terminalLocationId: text("terminal_location_id"),
    refundLimit: numeric("refund_limit", { precision: 12, scale: 2 }).notNull().default("200"),
    cityTaxPassOn: text("city_tax_pass_on").notNull().default("on_top"),
  },
  (t) => [
    index("properties_legal_entity_idx").on(t.legalEntityId),
    check("properties_refund_limit_check", sql`${t.refundLimit} >= 0`),
    check("properties_city_tax_pass_on_check", sql`${t.cityTaxPassOn} in ('on_top', 'absorbed')`),
  ],
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
    accommodationServiceId: uuid("accommodation_service_id").references(() => services.id),
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
    salutation: text("salutation"),
    placeOfBirth: text("place_of_birth"),
    addressLine2: text("address_line2").notNull().default(""),
    region: text("region").notNull().default(""),
  },
  (t) => [
    index("guests_email_idx").on(t.emailNormalised).where(sql`${t.emailNormalised} is not null`),
    index("guests_phone_idx").on(t.phoneNormalised).where(sql`${t.phoneNormalised} is not null`),
    index("guests_name_idx").on(sql`lower(${t.lastName})`, sql`lower(${t.firstName})`),
    check("guests_consent_proof_check", sql`not ${t.marketingConsent} or (${t.marketingConsentAt} is not null and ${t.marketingConsentSource} is not null)`),
    check("guests_document_type_check", sql`${t.documentType} in ('passport', 'id_card', 'driving_licence', 'other')`),
    check("guests_salutation_check", sql`${t.salutation} in ('mr', 'ms', 'mx')`),
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
    overbooked: boolean("overbooked").notNull().default(false),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    cancellationFee: numeric("cancellation_fee", { precision: 12, scale: 2 }),
    cancellationFeeStatus: text("cancellation_fee_status"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInBy: text("checked_in_by"),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkedOutBy: text("checked_out_by"),
    cityTaxPassOn: text("city_tax_pass_on"),
  },
  (t) => [
    index("reservations_booking_idx").on(t.bookingId),
    index("reservations_availability_idx").on(t.propertyId, t.roomTypeId, t.arrival, t.departure).where(sql`${t.status} in ('confirmed', 'checked_in')`),
    index("reservations_guest_idx").on(t.primaryGuestId),
    check("reservations_dates_check", sql`${t.departure} > ${t.arrival}`),
    check("reservations_adults_check", sql`${t.adults} >= 1`),
    check("reservations_status_check", sql`${t.status} in ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')`),
    check("reservations_fee_status_check", sql`${t.cancellationFeeStatus} in ('open', 'confirmed', 'waived')`),
    check("reservations_fee_pair_check", sql`(${t.cancellationFee} is null) = (${t.cancellationFeeStatus} is null)`),
    check("reservations_city_tax_pass_on_check", sql`${t.cityTaxPassOn} in ('on_top', 'absorbed')`),
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

export const reservationChanges = pgTable(
  "reservation_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    action: text("action").notNull(),
    before: jsonb("before").notNull().default({}),
    after: jsonb("after").notNull().default({}),
    approvedBy: text("approved_by"),
  },
  (t) => [
    index("reservation_changes_reservation_idx").on(t.reservationId, t.at.desc()),
    check(
      "reservation_changes_action_check",
      sql`${t.action} in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in', 'check_out', 'price_override')`,
    ),
  ],
);

export const roomAssignments = pgTable(
  "room_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
  },
  (t) => [
    index("room_assignments_reservation_idx").on(t.reservationId, t.fromDate),
    index("room_assignments_room_idx").on(t.roomId, t.fromDate, t.toDate),
    check("room_assignments_dates_check", sql`${t.toDate} > ${t.fromDate}`),
  ],
);

export const folios = pgTable(
  "folios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    number: integer("number").notNull(),
    billToGuestId: uuid("bill_to_guest_id").references(() => guests.id),
    billToCompanyId: uuid("bill_to_company_id").references(() => companies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    unique("folios_reservation_id_number_key").on(t.reservationId, t.number),
    check("folios_bill_to_check", sql`(${t.billToGuestId} is null) <> (${t.billToCompanyId} is null)`),
  ],
);

export const reservationRouting = pgTable(
  "reservation_routing",
  {
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    folioId: uuid("folio_id").notNull().references(() => folios.id),
  },
  (t) => [primaryKey({ columns: [t.reservationId, t.category] }), check("reservation_routing_category_check", sql`${t.category} in ('accommodation', 'package', 'extras', 'city_tax')`)],
);

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folioId: uuid("folio_id").notNull().references(() => folios.id),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    serviceId: uuid("service_id").references(() => services.id),
    description: text("description").notNull(),
    serviceDate: date("service_date").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    taxCodeId: uuid("tax_code_id").notNull().references(() => taxCodes.id),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
    revenueAccount: text("revenue_account").notNull().default(""),
    category: text("category").notNull(),
    origin: text("origin").notNull(),
    component: text("component"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    postedBy: text("posted_by").notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
    autoVoid: text("auto_void"),
    invoiceId: uuid("invoice_id").references((): AnyPgColumn => invoices.id),
  },
  (t) => [
    index("charges_folio_idx").on(t.folioId),
    index("charges_reservation_idx").on(t.reservationId, t.serviceDate),
    index("charges_property_date_idx").on(t.propertyId, t.serviceDate).where(sql`${t.voidedAt} is null`),
    index("charges_uninvoiced_idx").on(t.folioId).where(sql`${t.invoiceId} is null and ${t.voidedAt} is null`),
    check("charges_category_check", sql`${t.category} in ('accommodation', 'package', 'extras', 'city_tax')`),
    check("charges_origin_check", sql`${t.origin} in ('stay', 'catalogue', 'free_text', 'fee')`),
    check("charges_component_check", sql`(${t.origin} = 'stay') = (${t.component} is not null)`),
    check("charges_auto_void_check", sql`${t.autoVoid} in ('early_departure', 'stay_changed', 'check_in_cancelled')`),
    check("charges_void_check", sql`(${t.voidedAt} is null) = (${t.voidReason} is null) and (${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.autoVoid} is null or ${t.voidedAt} is not null)`),
  ],
);

export const chargeEvents = pgTable(
  "charge_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargeId: uuid("charge_id").notNull().references(() => charges.id),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    action: text("action").notNull(),
    detail: jsonb("detail").notNull().default({}),
  },
  (t) => [index("charge_events_charge_idx").on(t.chargeId, t.at), check("charge_events_action_check", sql`${t.action} in ('post', 'void', 'move')`)],
);

export const fixedCharges = pgTable(
  "fixed_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("fixed_charges_reservation_idx").on(t.reservationId),
    check("fixed_charges_dates_check", sql`${t.toDate} > ${t.fromDate}`),
    check("fixed_charges_quantity_check", sql`${t.quantity} > 0`),
    check("fixed_charges_price_check", sql`${t.unitPrice} >= 0`),
  ],
);

export const paymentAccounts = pgTable("payment_accounts", {
  legalEntityId: uuid("legal_entity_id").primaryKey().references(() => legalEntities.id),
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull().unique(),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const terminalReaders = pgTable(
  "terminal_readers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    provider: text("provider").notNull(),
    readerId: text("reader_id").notNull().unique(),
    label: text("label").notNull(),
    deviceType: text("device_type").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("terminal_readers_property_idx").on(t.propertyId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folioId: uuid("folio_id").notNull().references(() => folios.id),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    tender: text("tender").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    status: text("status").notNull(),
    refundOf: uuid("refund_of").references((): AnyPgColumn => payments.id),
    provider: text("provider"),
    providerIntentId: text("provider_intent_id"),
    providerRefundId: text("provider_refund_id"),
    readerId: text("reader_id"),
    cardBrand: text("card_brand"),
    cardLast4: char("card_last4", { length: 4 }),
    reference: text("reference").notNull().default(""),
    error: text("error"),
    providerAttempts: integer("provider_attempts").notNull().default(0),
    invoiceId: uuid("invoice_id").references((): AnyPgColumn => invoices.id),
    approvedBy: text("approved_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    postedBy: text("posted_by").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("payments_folio_idx").on(t.folioId),
    index("payments_reservation_idx").on(t.reservationId),
    index("payments_intent_idx").on(t.providerIntentId).where(sql`${t.providerIntentId} is not null`),
    check("payments_tender_check", sql`${t.tender} in ('card_terminal', 'card_online', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect')`),
    check("payments_amount_check", sql`${t.amount} <> 0`),
    check("payments_status_check", sql`${t.status} in ('pending', 'succeeded', 'failed', 'refund_pending_balance')`),
    check("payments_refund_check", sql`(${t.refundOf} is null) = (${t.amount} > 0)`),
  ],
);

export const cardHolds = pgTable(
  "card_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    provider: text("provider").notNull(),
    providerIntentId: text("provider_intent_id").notNull().unique(),
    readerId: text("reader_id"),
    channel: text("channel").notNull(),
    providerCustomerId: text("provider_customer_id"),
    paymentMethodId: text("payment_method_id"),
    cardBrand: text("card_brand"),
    cardLast4: char("card_last4", { length: 4 }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    increments: integer("increments").notNull().default(0),
    extended: boolean("extended").notNull().default(false),
    status: text("status").notNull(),
    authorisedAt: timestamp("authorised_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    warnedAt: timestamp("warned_at", { withTimezone: true }),
    renewedFrom: uuid("renewed_from").references((): AnyPgColumn => cardHolds.id),
    capturedAmount: numeric("captured_amount", { precision: 12, scale: 2 }),
    capturePaymentId: uuid("capture_payment_id").references(() => payments.id),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("card_holds_reservation_idx").on(t.reservationId),
    index("card_holds_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'active'`),
    check("card_holds_channel_check", sql`${t.channel} in ('terminal', 'online', 'moto')`),
    check("card_holds_amount_check", sql`${t.amount} > 0`),
    check("card_holds_status_check", sql`${t.status} in ('pending', 'active', 'captured', 'released', 'expired', 'failed')`),
  ],
);

export const invoiceNumberRanges = pgTable(
  "invoice_number_ranges",
  {
    legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    nextValue: integer("next_value").notNull().default(1),
    counterYear: integer("counter_year"),
  },
  (t) => [
    primaryKey({ columns: [t.legalEntityId, t.kind] }),
    check("invoice_number_ranges_kind_check", sql`${t.kind} in ('final', 'deposit', 'cancellation')`),
    check("invoice_number_ranges_next_check", sql`${t.nextValue} >= 1`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    folioId: uuid("folio_id").notNull().references(() => folios.id),
    kind: text("kind").notNull(),
    number: text("number").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    currency: char("currency", { length: 3 }).notNull(),
    gross: numeric("gross", { precision: 12, scale: 2 }).notNull(),
    due: numeric("due", { precision: 12, scale: 2 }).notNull(),
    receivable: boolean("receivable").notNull().default(false),
    document: jsonb("document").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    nettedBy: uuid("netted_by").references((): AnyPgColumn => invoices.id),
    cancels: uuid("cancels").references((): AnyPgColumn => invoices.id),
    cancelledBy: uuid("cancelled_by").references((): AnyPgColumn => invoices.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    issuedBy: text("issued_by").notNull(),
    pdf: bytea("pdf"),
    xml: text("xml"),
  },
  (t) => [
    unique("invoices_number_key").on(t.legalEntityId, t.number),
    index("invoices_reservation_idx").on(t.reservationId),
    index("invoices_folio_idx").on(t.folioId),
    unique("invoices_cancels_key").on(t.cancels),
    check("invoices_kind_check", sql`${t.kind} in ('final', 'deposit', 'cancellation')`),
    check("invoices_cancels_check", sql`(${t.kind} = 'cancellation') = (${t.cancels} is not null)`),
  ],
);

export const receivableMatches = pgTable(
  "receivable_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    receivedOn: date("received_on").notNull(),
    reference: text("reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("receivable_matches_invoice_idx").on(t.invoiceId), check("receivable_matches_amount_check", sql`${t.amount} > 0`)],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    level: integer("level").notNull(),
    document: jsonb("document").notNull(),
    pdf: bytea("pdf"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    issuedBy: text("issued_by").notNull(),
  },
  (t) => [unique("reminders_invoice_level_key").on(t.invoiceId, t.level), check("reminders_level_check", sql`${t.level} between 1 and 3`)],
);

export const cityTaxRules = pgTable(
  "city_tax_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    preset: text("preset"),
    taxCodeId: uuid("tax_code_id").notNull().references(() => taxCodes.id),
    revenueAccount: text("revenue_account").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [unique("city_tax_rules_property_key").on(t.propertyId), check("city_tax_rules_preset_check", sql`${t.preset} in ('berlin', 'hamburg', 'wien')`)],
);

export const cityTaxRuleVersions = pgTable(
  "city_tax_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").notNull().references(() => cityTaxRules.id),
    validFrom: date("valid_from").notNull(),
    bookedFrom: date("booked_from"),
    kind: text("kind").notNull(),
    percent: numeric("percent", { precision: 6, scale: 3 }),
    nightCap: integer("night_cap"),
    stepBasis: text("step_basis").notNull().default("per_person"),
    steps: jsonb("steps").notNull().default([]),
    beyondEvery: numeric("beyond_every", { precision: 12, scale: 2 }),
    beyondAmount: numeric("beyond_amount", { precision: 12, scale: 2 }),
    flat: jsonb("flat").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    unique("city_tax_rule_versions_key").on(t.ruleId, t.validFrom, t.bookedFrom).nullsNotDistinct(),
    check("city_tax_rule_versions_kind_check", sql`${t.kind} in ('percentage', 'step_table', 'flat')`),
    check("city_tax_rule_versions_percent_check", sql`${t.percent} >= 0 and ${t.percent} <= 100`),
    check("city_tax_rule_versions_night_cap_check", sql`${t.nightCap} > 0`),
    check("city_tax_rule_versions_step_basis_check", sql`${t.stepBasis} in ('per_person', 'per_room')`),
    check("city_tax_rule_versions_beyond_check", sql`${t.beyondEvery} > 0`),
    check("city_tax_rule_versions_percent_needed", sql`${t.kind} <> 'percentage' or ${t.percent} is not null`),
  ],
);

export const cityTaxBaseServices = pgTable(
  "city_tax_base_services",
  {
    ruleId: uuid("rule_id").notNull().references(() => cityTaxRules.id),
    serviceId: uuid("service_id").notNull().references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.serviceId] })],
);

export const cityTaxExemptionReasons = pgTable(
  "city_tax_exemption_reasons",
  {
    ruleId: uuid("rule_id").notNull().references(() => cityTaxRules.id),
    reason: text("reason").notNull(),
    evidence: text("evidence").notNull().default("none"),
    param: integer("param"),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.reason] }),
    check("city_tax_exemption_reasons_reason_check", sql`${t.reason} in ('age', 'business_travel', 'resident', 'disability', 'long_stay', 'student', 'other')`),
    check("city_tax_exemption_reasons_evidence_check", sql`${t.evidence} in ('none', 'note', 'document')`),
    check("city_tax_exemption_reasons_param_check", sql`${t.param} > 0`),
  ],
);

export const reservationCityTaxExemptions = pgTable(
  "reservation_city_tax_exemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    person: integer("person").notNull(),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    document: bytea("document"),
    documentName: text("document_name"),
    documentType: text("document_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    unique("reservation_city_tax_exemptions_key").on(t.reservationId, t.person),
    check("reservation_city_tax_exemptions_person_check", sql`${t.person} >= 0`),
    check("reservation_city_tax_exemptions_reason_check", sql`${t.reason} in ('business_travel', 'resident', 'disability', 'student', 'other')`),
  ],
);

export const cityTaxNights = pgTable(
  "city_tax_nights",
  {
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    date: date("date").notNull(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    ruleId: uuid("rule_id").notNull().references(() => cityTaxRules.id),
    versionId: uuid("version_id").references(() => cityTaxRuleVersions.id),
    persons: integer("persons").notNull(),
    taxable: integer("taxable").notNull(),
    base: numeric("base", { precision: 12, scale: 2 }).notNull(),
    tax: numeric("tax", { precision: 12, scale: 2 }).notNull(),
    exempt: jsonb("exempt").notNull().default({}),
    absorbed: boolean("absorbed").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [primaryKey({ columns: [t.reservationId, t.date] }), index("city_tax_nights_property_date_idx").on(t.propertyId, t.date)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    kind: text("kind").notNull(),
    subjectKey: text("subject_key").notNull(),
    summary: text("summary").notNull(),
    recordId: uuid("record_id"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    inPlace: boolean("in_place").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    index("approvals_property_idx").on(t.propertyId, t.requestedAt.desc()),
    index("approvals_match_idx").on(t.kind, t.subjectKey, t.requestedBy).where(sql`${t.status} = 'approved'`),
    check("approvals_kind_check", sql`${t.kind} in ('refund_over_limit', 'price_below_floor', 'complimentary')`),
    check("approvals_status_check", sql`${t.status} in ('pending', 'approved', 'rejected', 'used')`),
    check("approvals_decided_check", sql`(${t.status} = 'pending') = (${t.decidedBy} is null)`),
    check("approvals_used_check", sql`(${t.status} = 'used') = (${t.usedAt} is not null)`),
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
  reservationChanges,
  roomAssignments,
  folios,
  reservationRouting,
  charges,
  chargeEvents,
  fixedCharges,
  paymentAccounts,
  terminalReaders,
  payments,
  cardHolds,
  invoiceNumberRanges,
  invoices,
  receivableMatches,
  reminders,
  cityTaxRules,
  cityTaxRuleVersions,
  cityTaxBaseServices,
  cityTaxExemptionReasons,
  reservationCityTaxExemptions,
  cityTaxNights,
  approvals,
};
