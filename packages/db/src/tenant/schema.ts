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
    downtimeOptions: jsonb("downtime_options").notNull().default(sql`'{}'`),
    portalInfo: jsonb("portal_info").notNull().default(sql`'{}'`),
    portalDocumentImages: boolean("portal_document_images").notNull().default(false),
    expressCheckoutAuto: boolean("express_checkout_auto").notNull().default(false),
    portalPhotoFileId: uuid("portal_photo_file_id").references((): AnyPgColumn => storedFiles.id, { onDelete: "set null" }),
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
    businessDate: date("business_date").notNull(),
    nightAuditFrom: time("night_audit_from").notNull().default("22:00"),
    nightAuditDeadline: time("night_audit_deadline").notNull().default("06:00"),
    nightAuditAlertedFor: date("night_audit_alerted_for"),
    inspectionRequired: boolean("inspection_required").notNull().default(true),
    hkStayoverRhythm: text("hk_stayover_rhythm").notNull().default("daily"),
    hkLinenEvery: integer("hk_linen_every").default(3),
    hkShiftMinutes: integer("hk_shift_minutes").notNull().default(480),
    deviceIdleMinutes: integer("device_idle_minutes").notNull().default(2),
    cashDesk: boolean("cash_desk").notNull().default(false),
    cashTolerance: numeric("cash_tolerance", { precision: 12, scale: 2 }).notNull().default("5.00"),
    paidOutLimit: numeric("paid_out_limit", { precision: 12, scale: 2 }).notNull().default("100.00"),
    cashDifferenceAccount: text("cash_difference_account").notNull().default(""),
    statsIdentity: text("stats_identity").notNull().default(""),
    statsDeadlineDay: integer("stats_deadline_day").notNull().default(5),
  },
  (t) => [
    index("properties_legal_entity_idx").on(t.legalEntityId),
    check("properties_refund_limit_check", sql`${t.refundLimit} >= 0`),
    check("properties_city_tax_pass_on_check", sql`${t.cityTaxPassOn} in ('on_top', 'absorbed')`),
    check("properties_hk_stayover_rhythm_check", sql`${t.hkStayoverRhythm} in ('daily', 'every_2', 'every_3', 'on_request')`),
    check("properties_hk_linen_every_check", sql`${t.hkLinenEvery} > 0`),
    check("properties_hk_shift_minutes_check", sql`${t.hkShiftMinutes} > 0`),
    check("properties_cash_tolerance_check", sql`${t.cashTolerance} >= 0`),
    check("properties_paid_out_limit_check", sql`${t.paidOutLimit} >= 0`),
    check("properties_stats_deadline_day_check", sql`${t.statsDeadlineDay} between 1 and 28`),
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
    hkStayoverRhythm: text("hk_stayover_rhythm"),
    hkLinenEvery: integer("hk_linen_every"),
  },
  (t) => [
    check("room_types_hk_stayover_rhythm_check", sql`${t.hkStayoverRhythm} in ('daily', 'every_2', 'every_3', 'on_request')`),
    check("room_types_hk_linen_every_check", sql`${t.hkLinenEvery} >= 0`),
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
    cleanliness: text("cleanliness").notNull().default("inspected"),
    cleanlinessAt: timestamp("cleanliness_at", { withTimezone: true }),
    cleanlinessBy: text("cleanliness_by"),
  },
  (t) => [
    check("rooms_cleanliness_check", sql`${t.cleanliness} in ('dirty', 'clean', 'inspected')`),
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
    minibar: boolean("minibar").notNull().default(false),
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
    test: boolean("test").notNull().default(sql`in_test_mode()`),
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
    test: boolean("test").notNull().default(sql`in_test_mode()`),
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
    emailBounced: text("email_bounced"),
    emailComplained: text("email_complained"),
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
    test: boolean("test").notNull().default(sql`in_test_mode()`),
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
    channelCollect: text("channel_collect"),
    virtualCardFrom: date("virtual_card_from"),
    virtualCardUntil: date("virtual_card_until"),
    virtualCardAmount: numeric("virtual_card_amount", { precision: 12, scale: 2 }),
    channelCardToken: text("channel_card_token"),
    channelCardBrand: text("channel_card_brand"),
    channelCardLast4: char("channel_card_last4", { length: 4 }),
    channelNotes: text("channel_notes").notNull().default(""),
    portalKey: text("portal_key").notNull().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
  },
  (t) => [
    check("bookings_channel_collect_check", sql`${t.channelCollect} in ('property', 'channel')`),
    uniqueIndex("bookings_portal_key").on(t.portalKey),
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
    test: boolean("test").notNull().default(sql`in_test_mode()`),
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
    lateArrival: boolean("late_arrival").notNull().default(false),
    waitingForRoomSince: timestamp("waiting_for_room_since", { withTimezone: true }),
    statsExcludedReason: text("stats_excluded_reason"),
    statsExcludedBy: text("stats_excluded_by"),
    statsExcludedAt: timestamp("stats_excluded_at", { withTimezone: true }),
    channelRoomKey: text("channel_room_key"),
    portalKey: text("portal_key").notNull().default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    arrivalTime: text("arrival_time"),
    precheckinAt: timestamp("precheckin_at", { withTimezone: true }),
    expressCheckoutAt: timestamp("express_checkout_at", { withTimezone: true }),
  },
  (t) => [
    index("reservations_booking_idx").on(t.bookingId),
    index("reservations_availability_idx").on(t.propertyId, t.roomTypeId, t.arrival, t.departure).where(sql`${t.status} in ('confirmed', 'checked_in')`),
    index("reservations_guest_idx").on(t.primaryGuestId),
    check("reservations_dates_check", sql`${t.departure} > ${t.arrival}`),
    check("reservations_adults_check", sql`${t.adults} >= 1`),
    check("reservations_status_check", sql`${t.status} in ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')`),
    check("reservations_stats_excluded_reason_check", sql`${t.statsExcludedReason} is null or length(trim(${t.statsExcludedReason})) > 0`),
    check("reservations_fee_status_check", sql`${t.cancellationFeeStatus} in ('open', 'confirmed', 'waived')`),
    check("reservations_fee_pair_check", sql`(${t.cancellationFee} is null) = (${t.cancellationFeeStatus} is null)`),
    check("reservations_city_tax_pass_on_check", sql`${t.cityTaxPassOn} in ('on_top', 'absorbed')`),
    uniqueIndex("reservations_portal_key").on(t.portalKey),
    check("reservations_arrival_time_check", sql`${t.arrivalTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
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
    realAt: timestamp("real_at", { withTimezone: true }),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    action: text("action").notNull(),
    before: jsonb("before").notNull().default({}),
    after: jsonb("after").notNull().default({}),
    approvedBy: text("approved_by"),
    businessDate: date("business_date").notNull(),
  },
  (t) => [
    index("reservation_changes_reservation_idx").on(t.reservationId, t.at.desc()),
    check(
      "reservation_changes_action_check",
      sql`${t.action} in ('edit', 'cancel', 'assign_room', 'move_room', 'unassign_room', 'fee_confirmed', 'fee_waived', 'check_in', 'cancel_check_in', 'check_out', 'price_override', 'no_show', 'late_arrival')`,
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
    businessDate: date("business_date").notNull(),
    corrects: uuid("corrects").references((): AnyPgColumn => charges.id),
  },
  (t) => [
    index("charges_folio_idx").on(t.folioId),
    uniqueIndex("charges_corrects_key").on(t.corrects).where(sql`${t.corrects} is not null`),
    check("charges_corrects_check", sql`(${t.origin} = 'correction') = (${t.corrects} is not null)`),
    index("charges_reservation_idx").on(t.reservationId, t.serviceDate),
    index("charges_property_date_idx").on(t.propertyId, t.serviceDate).where(sql`${t.voidedAt} is null`),
    index("charges_uninvoiced_idx").on(t.folioId).where(sql`${t.invoiceId} is null and ${t.voidedAt} is null`),
    check("charges_category_check", sql`${t.category} in ('accommodation', 'package', 'extras', 'city_tax')`),
    check("charges_origin_check", sql`${t.origin} in ('stay', 'catalogue', 'free_text', 'fee', 'correction')`),
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
    businessDate: date("business_date").notNull(),
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
    realAt: timestamp("real_at", { withTimezone: true }),
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
    businessDate: date("business_date").notNull(),
    saveCard: boolean("save_card").notNull().default(false),
    declineNoticedAt: timestamp("decline_noticed_at", { withTimezone: true }),
  },
  (t) => [
    index("payments_folio_idx").on(t.folioId),
    index("payments_reservation_idx").on(t.reservationId),
    index("payments_intent_idx").on(t.providerIntentId).where(sql`${t.providerIntentId} is not null`),
    check("payments_tender_check", sql`${t.tender} in ('card_terminal', 'card_online', 'bank_transfer', 'on_account', 'ota_virtual_card', 'ota_collect', 'cash', 'website_tool')`),
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
    test: boolean("test").notNull().default(sql`in_test_mode()`),
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
    businessDate: date("business_date").notNull(),
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
    businessDate: date("business_date").notNull(),
  },
  (t) => [
    index("approvals_property_idx").on(t.propertyId, t.requestedAt.desc()),
    index("approvals_match_idx").on(t.kind, t.subjectKey, t.requestedBy).where(sql`${t.status} = 'approved'`),
    check("approvals_kind_check", sql`${t.kind} in ('refund_over_limit', 'price_below_floor', 'complimentary', 'paid_out_over_limit')`),
    check("approvals_status_check", sql`${t.status} in ('pending', 'approved', 'rejected', 'used')`),
    check("approvals_decided_check", sql`(${t.status} = 'pending') = (${t.decidedBy} is null)`),
    check("approvals_used_check", sql`(${t.status} = 'used') = (${t.usedAt} is not null)`),
  ],
);

export const nightAudits = pgTable(
  "night_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    businessDate: date("business_date").notNull(),
    status: text("status").notNull().default("draft"),
    decisions: jsonb("decisions").notNull().default({}),
    report: jsonb("report"),
    reportPdf: bytea("report_pdf"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    startedBy: text("started_by").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
  },
  (t) => [
    unique("night_audits_key").on(t.propertyId, t.businessDate),
    check("night_audits_status_check", sql`${t.status} in ('draft', 'closed')`),
    check("night_audits_closed_check", sql`(${t.status} = 'closed') = (${t.closedAt} is not null and ${t.closedBy} is not null and ${t.report} is not null)`),
  ],
);

export const roomCleanlinessChanges = pgTable(
  "room_cleanliness_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    before: text("before").notNull(),
    after: text("after").notNull(),
    source: text("source").notNull(),
    userId: text("user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    businessDate: date("business_date").notNull(),
    reason: text("reason").notNull().default(""),
  },
  (t) => [
    index("room_cleanliness_changes_room_idx").on(t.roomId, t.at.desc()),
    check("room_cleanliness_changes_source_check", sql`${t.source} in ('manual', 'check_out', 'room_move', 'block_end', 'night_audit', 'inspection')`),
  ],
);

export const roomBlocks = pgTable(
  "room_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    kind: text("kind").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by"),
  },
  (t) => [
    index("room_blocks_room_idx").on(t.roomId, t.fromDate),
    index("room_blocks_property_idx").on(t.propertyId, t.kind, t.fromDate, t.toDate),
    check("room_blocks_kind_check", sql`${t.kind} in ('out_of_order', 'out_of_service')`),
    check("room_blocks_dates_check", sql`${t.toDate} >= ${t.fromDate}`),
    check("room_blocks_reason_check", sql`length(trim(${t.reason})) > 0`),
  ],
);

export const housekeepingTasks = pgTable(
  "housekeeping_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    businessDate: date("business_date").notNull(),
    kind: text("kind").notNull().default("clean"),
    assigneeId: text("assignee_id"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
    minutes: integer("minutes").notNull().default(20),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    changed: boolean("changed").notNull().default(false),
    note: text("note").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: text("done_by"),
    priority: boolean("priority").notNull().default(false),
    version: integer("version").notNull().default(0),
    skipReason: text("skip_reason"),
  },
  (t) => [
    index("housekeeping_tasks_reservation_idx").on(t.reservationId),
    unique("housekeeping_tasks_key").on(t.roomId, t.businessDate, t.kind),
    check("housekeeping_tasks_kind_check", sql`${t.kind} in ('departure', 'stayover', 'arrival', 'linen', 'clean')`),
    index("housekeeping_tasks_assignee_idx").on(t.propertyId, t.businessDate, t.assigneeId),
    check("housekeeping_tasks_status_check", sql`${t.status} in ('open', 'in_progress', 'done', 'skipped')`),
    check("housekeeping_tasks_skip_reason_check", sql`${t.skipReason} in ('declined', 'dnd')`),
  ],
);

export const housekeepingMinutes = pgTable(
  "housekeeping_minutes",
  {
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    minutes: integer("minutes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roomTypeId, t.kind] }),
    check("housekeeping_minutes_kind_check", sql`${t.kind} in ('departure', 'stayover', 'arrival', 'linen', 'clean')`),
    check("housekeeping_minutes_minutes_check", sql`${t.minutes} > 0 and ${t.minutes} <= 600`),
  ],
);

export const housekeepingPlans = pgTable(
  "housekeeping_plans",
  {
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    businessDate: date("business_date").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.businessDate] })],
);

export const housekeepingNotes = pgTable(
  "housekeeping_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    code: text("code"),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("housekeeping_notes_reservation_idx").on(t.reservationId),
    check("housekeeping_notes_code_check", sql`${t.code} in ('feather_allergy', 'baby_cot', 'extra_bed', 'welcome_gift', 'late_checkout', 'pet', 'accessibility')`),
    check("housekeeping_notes_one_check", sql`(${t.code} is null) <> (${t.text} is null)`),
  ],
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    key: text("key").notNull().unique(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    propertyId: uuid("property_id").references(() => properties.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    deleteAfter: date("delete_after"),
  },
  (t) => [
    check("stored_files_kind_check", sql`${t.kind} in ('issue_photo', 'fix_photo', 'id_document', 'portal_photo')`),
    check("stored_files_size_check", sql`${t.size} > 0`),
    index("stored_files_retention_idx").on(t.deleteAfter).where(sql`${t.deleteAfter} is not null`),
  ],
);

export const maintenanceIssues = pgTable(
  "maintenance_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomId: uuid("room_id").references(() => rooms.id),
    place: text("place").notNull().default(""),
    pick: text("pick").notNull(),
    urgency: text("urgency").notNull(),
    note: text("note").notNull().default(""),
    photo: bytea("photo"),
    photoType: text("photo_type"),
    status: text("status").notNull().default("open"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    reportedBy: text("reported_by").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    takenBy: text("taken_by"),
    fixedAt: timestamp("fixed_at", { withTimezone: true }),
    fixedBy: text("fixed_by"),
    fixNote: text("fix_note").notNull().default(""),
    photoFileId: uuid("photo_file_id").references(() => storedFiles.id, { onDelete: "set null" }),
    fixPhotoFileId: uuid("fix_photo_file_id").references(() => storedFiles.id, { onDelete: "set null" }),
    blockId: uuid("block_id").references(() => roomBlocks.id),
    blockDecision: text("block_decision"),
  },
  (t) => [
    check("maintenance_issues_block_decision_check", sql`${t.blockDecision} in ('ended', 'kept')`),
    index("maintenance_issues_open_idx").on(t.propertyId).where(sql`${t.status} <> 'done'`),
    check("maintenance_issues_place_check", sql`${t.roomId} is not null or length(trim(${t.place})) > 0`),
    check("maintenance_issues_pick_check", sql`${t.pick} in ('plumbing', 'electrical', 'heating', 'furniture', 'door', 'other')`),
    check("maintenance_issues_urgency_check", sql`${t.urgency} in ('now', 'today', 'later')`),
    check("maintenance_issues_status_check", sql`${t.status} in ('open', 'in_progress', 'done')`),
  ],
);

export const lostItems = pgTable(
  "lost_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomId: uuid("room_id").notNull().references(() => rooms.id),
    pick: text("pick").notNull(),
    note: text("note").notNull().default(""),
    photo: bytea("photo"),
    photoType: text("photo_type"),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
    foundBy: text("found_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    status: text("status").notNull().default("kept"),
  },
  (t) => [
    index("lost_items_property_idx").on(t.propertyId, t.foundAt.desc()),
    check("lost_items_pick_check", sql`${t.pick} in ('clothing', 'electronics', 'documents', 'valuables', 'other')`),
    check("lost_items_status_check", sql`${t.status} in ('kept', 'returned', 'disposed')`),
  ],
);

export const phoneChanges = pgTable(
  "phone_changes",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    outcome: text("outcome").notNull(),
    message: text("message").notNull().default(""),
  },
  (t) => [check("phone_changes_outcome_check", sql`${t.outcome} in ('applied', 'conflict', 'refused')`)],
);

export const eventMarkers = pgTable(
  "event_markers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    index("event_markers_property_idx").on(t.propertyId, t.fromDate),
    check("event_markers_name_check", sql`length(trim(${t.name})) between 1 and 60`),
    check("event_markers_dates_check", sql`${t.toDate} >= ${t.fromDate} and ${t.toDate} - ${t.fromDate} < 366`),
  ],
);

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [unique("cash_registers_property_id_name_key").on(t.propertyId, t.name), check("cash_registers_name_check", sql`length(trim(${t.name})) between 1 and 60`)],
);

export const cashShifts = pgTable(
  "cash_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registerId: uuid("register_id").notNull().references(() => cashRegisters.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    userId: text("user_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    openingCount: jsonb("opening_count").notNull(),
    openingFloat: numeric("opening_float", { precision: 12, scale: 2 }).notNull(),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    closeCount: jsonb("close_count"),
    counted: numeric("counted", { precision: 12, scale: 2 }),
    expected: numeric("expected", { precision: 12, scale: 2 }),
    difference: numeric("difference", { precision: 12, scale: 2 }),
    reason: text("reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("cash_shifts_open_register_idx").on(t.registerId).where(sql`${t.closedAt} is null`),
    uniqueIndex("cash_shifts_open_user_idx").on(t.propertyId, t.userId).where(sql`${t.closedAt} is null`),
    check("cash_shifts_count_check", sql`(${t.countedAt} is null) = (${t.counted} is null) and (${t.counted} is null) = (${t.expected} is null)`),
    check("cash_shifts_closed_check", sql`${t.closedAt} is null or ${t.countedAt} is not null`),
  ],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registerId: uuid("register_id").notNull().references(() => cashRegisters.id),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    shiftId: uuid("shift_id").references(() => cashShifts.id),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    counterpartRegisterId: uuid("counterpart_register_id").references(() => cashRegisters.id),
    reason: text("reason").notNull().default(""),
    account: text("account").notNull().default(""),
    receiptPhoto: bytea("receipt_photo"),
    receiptPhotoType: text("receipt_photo_type"),
    approvedBy: text("approved_by"),
    at: timestamp("at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    byUser: text("by_user").notNull(),
    businessDate: date("business_date").notNull(),
  },
  (t) => [
    index("cash_movements_register_idx").on(t.registerId, t.at),
    index("cash_movements_shift_idx").on(t.shiftId),
    check("cash_movements_kind_check", sql`${t.kind} in ('float', 'payment', 'refund', 'paid_out', 'deposit', 'change_in', 'transfer_out', 'transfer_in', 'tip_out', 'difference')`),
  ],
);

export const receiptNumbers = pgTable("receipt_numbers", {
  propertyId: uuid("property_id").primaryKey().references(() => properties.id),
  last: integer("last").notNull().default(0),
});

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    number: integer("number").notNull(),
    paymentId: uuid("payment_id").notNull().unique().references(() => payments.id),
    registerId: uuid("register_id").references(() => cashRegisters.id),
    token: text("token").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    issuedBy: text("issued_by").notNull(),
    emailedTo: text("emailed_to"),
  },
  (t) => [unique("receipts_property_id_number_key").on(t.propertyId, t.number)],
);

export const closedPeriods = pgTable(
  "closed_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("closed_periods_property_idx").on(t.propertyId, t.fromDate), check("closed_periods_dates_check", sql`${t.toDate} >= ${t.fromDate}`)],
);

export const tourismReports = pgTable(
  "tourism_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    month: char("month", { length: 7 }).notNull(),
    version: integer("version").notNull(),
    data: jsonb("data").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    submittedBy: text("submitted_by").notNull(),
  },
  (t) => [
    unique("tourism_reports_property_id_month_version_key").on(t.propertyId, t.month, t.version),
    check("tourism_reports_month_check", sql`${t.month} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check("tourism_reports_version_check", sql`${t.version} >= 1`),
  ],
);


export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    propertyIds: uuid("property_ids").array().notNull(),
    frequency: text("frequency").notNull(),
    options: jsonb("options").notNull().default(sql`'{}'`),
    language: text("language").notNull().default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSentOn: date("last_sent_on"),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    stoppedReason: text("stopped_reason"),
  },
  (t) => [
    check("report_schedules_kind_check", sql`${t.kind} in ('occupancy', 'pickup', 'source_mix', 'cancellations', 'revenue_by_code', 'housekeeping', 'receivables', 'cash')`),
    check("report_schedules_properties_check", sql`cardinality(${t.propertyIds}) > 0`),
    check("report_schedules_frequency_check", sql`${t.frequency} in ('daily', 'weekly', 'monthly')`),
    check("report_schedules_language_check", sql`${t.language} in ('en', 'de')`),
    index("report_schedules_user_idx").on(t.userId),
  ],
);

export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    propertyIds: uuid("property_ids").array().notNull(),
    format: text("format").notNull(),
    rowCount: integer("row_count").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("report_exports_format_check", sql`${t.format} in ('csv', 'pdf', 'mail')`), index("report_exports_at_idx").on(t.at)],
);

export const mailOutbox = pgTable(
  "mail_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toUserId: text("to_user_id").notNull(),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attachmentName: text("attachment_name"),
    attachmentType: text("attachment_type"),
    attachment: bytea("attachment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    html: text("html"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    propertyId: uuid("property_id").references(() => properties.id),
  },
  (t) => [check("mail_outbox_attachment_check", sql`(${t.attachment} is null) = (${t.attachmentName} is null)`), index("mail_outbox_unsent_idx").on(t.createdAt).where(sql`${t.sentAt} is null`)],
);

export const propertyOutages = pgTable(
  "property_outages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    cause: text("cause").notNull().default("unknown"),
    note: text("note").notNull().default(""),
    loggedBy: text("logged_by").notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("property_outages_order_check", sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`),
    check("property_outages_cause_check", sql`${t.cause} in ('hotel', 'ours', 'unknown')`),
    index("property_outages_property_idx").on(t.propertyId, t.startedAt),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().unique().references(() => reservations.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    country: text("country").notNull(),
    deviceId: uuid("device_id"),
    queue: uuid("queue").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [check("registrations_country_check", sql`${t.country} in ('DE', 'AT')`), uniqueIndex("registrations_device_key").on(t.deviceId).where(sql`${t.deviceId} is not null`)],
);

export const registrationPersons = pgTable(
  "registration_persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registrationId: uuid("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "set null" }),
    role: text("role").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    dateOfBirth: date("date_of_birth"),
    nationality: text("nationality").notNull().default(""),
    addressLine1: text("address_line1").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    city: text("city").notNull().default(""),
    country: text("country").notNull().default(""),
    documentNumber: text("document_number").notNull().default(""),
    gender: text("gender").notNull().default(""),
    language: text("language").notNull().default("de"),
    step: text("step").notNull().default("waiting"),
    guestDoneAt: timestamp("guest_done_at", { withTimezone: true }),
    confirmation: text("confirmation"),
    signature: bytea("signature"),
    paperSignedBy: text("paper_signed_by"),
    paperSignedAt: timestamp("paper_signed_at", { withTimezone: true }),
    idCheckedBy: text("id_checked_by"),
    idCheckedAt: timestamp("id_checked_at", { withTimezone: true }),
    idCheckNote: text("id_check_note").notNull().default(""),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    pdf: bytea("pdf"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("registration_persons_gender_check", sql`${t.gender} in ('', 'f', 'm', 'x')`),
    check("registration_persons_role_check", sql`${t.role} in ('primary', 'spouse', 'partner', 'child', 'other')`),
    check("registration_persons_step_check", sql`${t.step} in ('waiting', 'welcome', 'details', 'companions', 'review', 'done')`),
    check("registration_persons_confirmation_check", sql`${t.confirmation} in ('tablet_signature', 'paper')`),
    check("registration_persons_signature_check", sql`(${t.confirmation} = 'tablet_signature') = (${t.signature} is not null)`),
    check("registration_persons_paper_check", sql`(${t.confirmation} = 'paper') = (${t.paperSignedAt} is not null and ${t.paperSignedBy} is not null)`),
    index("registration_persons_registration_idx").on(t.registrationId),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    year: integer("year").notNull(),
    version: text("version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    check("budgets_year_check", sql`${t.year} between 2000 and 2100`),
    check("budgets_version_check", sql`${t.version} in ('budget', 'forecast')`),
    unique("budgets_key").on(t.propertyId, t.year, t.version),
  ],
);

export const budgetMonths = pgTable(
  "budget_months",
  {
    budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
    month: integer("month").notNull(),
    occupancy: numeric("occupancy", { precision: 5, scale: 2 }).notNull(),
    adr: numeric("adr", { precision: 12, scale: 2 }).notNull(),
    netRoomRevenue: numeric("net_room_revenue", { precision: 14, scale: 2 }).notNull(),
    totalRevenue: numeric("total_revenue", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.month] }),
    check("budget_months_month_check", sql`${t.month} between 1 and 12`),
    check("budget_months_occupancy_check", sql`${t.occupancy} between 0 and 100`),
    check("budget_months_adr_check", sql`${t.adr} >= 0`),
    check("budget_months_nrr_check", sql`${t.netRoomRevenue} >= 0`),
    check("budget_months_total_check", sql`${t.totalRevenue} >= ${t.netRoomRevenue}`),
  ],
);

export const savedReports = pgTable(
  "saved_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("saved_reports_name_check", sql`length(trim(${t.name})) between 1 and 120`), index("saved_reports_owner_idx").on(t.ownerId), index("saved_reports_shared_idx").on(t.propertyId).where(sql`${t.shared}`)],
);

export const propertyModules = pgTable(
  "property_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    module: text("module").notNull(),
    onSince: date("on_since").notNull(),
    offAt: date("off_at"),
    switchedOnBy: text("switched_on_by").notNull(),
    switchedOffBy: text("switched_off_by"),
    checklist: jsonb("checklist").notNull().default(sql`'{}'`),
  },
  (t) => [
    check("property_modules_module_check", sql`${t.module} in ('channel', 'guest_portal', 'point_of_sale', 'groups', 'whatsapp')`),
    check("property_modules_order_check", sql`${t.offAt} is null or ${t.offAt} >= ${t.onSince}`),
    uniqueIndex("property_modules_running_key").on(t.propertyId, t.module).where(sql`${t.offAt} is null`),
  ],
);

export const propertyMessaging = pgTable(
  "property_messaging",
  {
    propertyId: uuid("property_id").primaryKey().references(() => properties.id),
    sendingFrom: time("sending_from").notNull().default("08:00"),
    sendingTo: time("sending_to").notNull().default("20:00"),
    fallbackLanguage: text("fallback_language").notNull().default("de"),
    useGuestLanguage: boolean("use_guest_language").notNull().default(true),
    switched: jsonb("switched").notNull().default(sql`'{}'`),
    senderDomain: text("sender_domain"),
    senderLocal: text("sender_local").notNull().default("reservations"),
    senderVerified: boolean("sender_verified").notNull().default(false),
    replyTo: text("reply_to"),
    preArrivalDays: integer("pre_arrival_days").notNull().default(3),
    checkoutTime: time("checkout_time").notNull().default("11:00"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    check("property_messaging_hours_check", sql`${t.sendingFrom} < ${t.sendingTo}`),
    check("property_messaging_language_check", sql`${t.fallbackLanguage} in ('de', 'en')`),
    check("property_messaging_local_check", sql`${t.senderLocal} ~ '^[a-z0-9._-]{1,40}$'`),
    check("property_messaging_pre_arrival_check", sql`${t.preArrivalDays} between 1 and 30`),
  ],
);

export const messageTemplates = pgTable(
  "message_templates",
  {
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    type: text("type").notNull(),
    language: text("language").notNull(),
    subject: text("subject").notNull(),
    blocks: jsonb("blocks").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.type, t.language] }), check("message_templates_subject_check", sql`length(trim(${t.subject})) > 0`)],
);

export const guestMessages = pgTable(
  "guest_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id),
    type: text("type").notNull(),
    triggerKey: text("trigger_key").notNull().default(""),
    language: text("language").notNull(),
    toEmail: text("to_email"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    bodyText: text("body_text").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    status: text("status").notNull().default("queued"),
    reason: text("reason"),
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    createdBy: text("created_by"),
    secretCode: text("secret_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (t) => [
    check("guest_messages_status_check", sql`${t.status} in ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed')`),
    uniqueIndex("guest_messages_once_key").on(t.reservationId, t.type, t.triggerKey),
    index("guest_messages_due_idx").on(t.sendAfter).where(sql`${t.status} = 'queued'`),
    index("guest_messages_provider_idx").on(t.providerId).where(sql`${t.providerId} is not null`),
  ],
);

export const messageEvents = pgTable("message_events", {
  id: text("id").primaryKey(),
  messageId: uuid("message_id").references(() => guestMessages.id),
  kind: text("kind").notNull(),
  detail: text("detail").notNull().default(""),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const smsOutbox = pgTable(
  "sms_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toUserId: text("to_user_id").notNull(),
    toPhone: text("to_phone").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    error: text("error"),
    providerId: text("provider_id"),
  },
  (t) => [index("sms_outbox_unsent_idx").on(t.createdAt).where(sql`${t.sentAt} is null`)],
);

export const channelConnections = pgTable("channel_connections", {
  propertyId: uuid("property_id").primaryKey().references(() => properties.id),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  connectedBy: text("connected_by").notNull(),
  fullPushAt: timestamp("full_push_at", { withTimezone: true }),
  failingSince: timestamp("failing_since", { withTimezone: true }),
  lastError: text("last_error"),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  busyUntil: timestamp("busy_until", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  google: boolean("google").notNull().default(false),
  webhookAt: timestamp("webhook_at", { withTimezone: true }),
});

export const channelSettings = pgTable(
  "channel_settings",
  {
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    channel: text("channel").notNull(),
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(true),
    pricesIncludeCityTax: boolean("prices_include_city_tax").notNull().default(false),
    sendConfirmation: boolean("send_confirmation").notNull().default(true),
    paidViaTool: boolean("paid_via_tool").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.channel] })],
);

export const channelBookings = pgTable(
  "channel_bookings",
  {
    externalId: text("external_id").primaryKey(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id),
    channel: text("channel").notNull(),
    channelCode: text("channel_code").notNull(),
    lastRevisionId: text("last_revision_id").notNull(),
    lastRevisionAt: timestamp("last_revision_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
  },
  (t) => [check("channel_bookings_status_check", sql`${t.status} in ('new', 'modified', 'cancelled')`), index("channel_bookings_booking_idx").on(t.bookingId)],
);

export const channelBookingRevisions = pgTable(
  "channel_booking_revisions",
  {
    id: text("id").primaryKey(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    externalBookingId: text("external_booking_id").notNull(),
    status: text("status").notNull(),
    channel: text("channel").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").notNull(),
    message: text("message").notNull().default(""),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    check("channel_booking_revisions_outcome_check", sql`${t.outcome} in ('applied', 'stale', 'refused', 'conflict')`),
    index("channel_booking_revisions_open_idx").on(t.propertyId, t.appliedAt.desc()).where(sql`${t.outcome} in ('refused', 'conflict') and ${t.resolvedAt} is null`),
  ],
);

export const channelMappings = pgTable(
  "channel_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    ratePlanId: uuid("rate_plan_id").references(() => ratePlans.id),
    externalId: text("external_id").notNull(),
    rooms: integer("rooms"),
    maxAdults: integer("max_adults"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channel_mappings_key").on(t.roomTypeId, sql`coalesce(${t.ratePlanId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);

export const ariOutbox = pgTable(
  "ari_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    propertyId: uuid("property_id").notNull().references(() => properties.id),
    kind: text("kind").notNull(),
    roomTypeId: uuid("room_type_id").notNull().references(() => roomTypes.id),
    ratePlanId: uuid("rate_plan_id").references(() => ratePlans.id, { onDelete: "cascade" }),
    dateFrom: date("date_from").notNull(),
    dateTo: date("date_to").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    refusedAt: timestamp("refused_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    check("ari_outbox_kind_check", sql`${t.kind} in ('availability', 'restrictions')`),
    check("ari_outbox_dates_check", sql`${t.dateTo} >= ${t.dateFrom}`),
    index("ari_outbox_unsent_idx").on(t.propertyId, t.id).where(sql`${t.sentAt} is null and ${t.refusedAt} is null`),
  ],
);

export const reservationCompanions = pgTable(
  "reservation_companions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    nationality: char("nationality", { length: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [check("reservation_companions_name_check", sql`length(trim(${t.lastName})) > 0`), index("reservation_companions_reservation_idx").on(t.reservationId)],
);

export const portalCodes = pgTable(
  "portal_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
    forBooking: boolean("for_booking").notNull().default(false),
  },
  (t) => [index("portal_codes_reservation_idx").on(t.reservationId, t.createdAt.desc())],
);

export const messagingConsents = pgTable(
  "messaging_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestId: uuid("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    transport: text("transport").notNull(),
    granted: boolean("granted").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    wording: text("wording").notNull(),
  },
  (t) => [check("messaging_consents_transport_check", sql`${t.transport} in ('email', 'whatsapp')`), index("messaging_consents_guest_idx").on(t.guestId, t.transport, t.at.desc())],
);

export const reservationDocuments = pgTable(
  "reservation_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id),
    fileId: uuid("file_id").notNull().references(() => storedFiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservation_documents_reservation_idx").on(t.reservationId)],
);

export const cardGuarantees = pgTable(
  "card_guarantees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    customerId: text("customer_id").notNull(),
    paymentMethodId: text("payment_method_id").notNull(),
    brand: text("brand"),
    last4: char("last4", { length: 4 }),
    status: text("status").notNull().default("secured"),
    securedAt: timestamp("secured_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    check("card_guarantees_status_check", sql`${t.status} in ('secured', 'removed')`),
    uniqueIndex("card_guarantees_secured_key").on(t.reservationId).where(sql`${t.status} = 'secured'`),
  ],
);

export const cardSetups = pgTable(
  "card_setups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id").notNull().references(() => reservations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSetupId: text("provider_setup_id").unique(),
    customerId: text("customer_id"),
    status: text("status").notNull().default("waiting"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("card_setups_status_check", sql`${t.status} in ('waiting', 'succeeded', 'failed')`)],
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
  nightAudits,
  roomCleanlinessChanges,
  roomBlocks,
  housekeepingTasks,
  housekeepingMinutes,
  housekeepingPlans,
  housekeepingNotes,
  maintenanceIssues,
  lostItems,
  phoneChanges,
  eventMarkers,
  cashRegisters,
  cashShifts,
  cashMovements,
  receiptNumbers,
  receipts,
  closedPeriods,
  tourismReports,
  reportSchedules,
  reportExports,
  mailOutbox,
  propertyOutages,
  registrations,
  registrationPersons,
  budgets,
  budgetMonths,
  savedReports,
  propertyModules,
  storedFiles,
  propertyMessaging,
  messageTemplates,
  guestMessages,
  messageEvents,
  smsOutbox,
  channelConnections,
  channelMappings,
  ariOutbox,
  channelSettings,
  channelBookings,
  channelBookingRevisions,
  reservationCompanions,
  portalCodes,
  messagingConsents,
  reservationDocuments,
  cardGuarantees,
  cardSetups,
};
