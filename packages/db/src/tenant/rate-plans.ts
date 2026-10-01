import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  DERIVATION_KINDS,
  FEE_KINDS,
  INHERIT_ALL,
  MEAL_PLANS,
  RESTRICTION_FIELDS,
  SUPPLEMENT_KINDS,
  checkPlanLimits,
  isOneOf,
  mergeNames,
  roundMoney,
  type Derivation,
  type FeeKind,
  type MealPlan,
  type Names,
  type RestrictionInheritance,
  type Supplement,
} from "@hoteloftware/domain";
import { normaliseCode, uniqueViolation } from "./catalogue-common";
import { rewriteDerivedPlan } from "./rates";
import { withTenant } from "./with-tenant";

/**
 * Rate Plans (ADR 0012): one per property spanning room types, carrying
 * policies, Supplements, included Services and texts. Base plans take
 * prices; a derived plan follows exactly one base plan, one level only.
 */

export interface IncludedService {
  serviceId: string;
  /** Fixed gross component per person-night; the room receives the remainder. */
  componentPrice: number;
}

export interface RatePlanInput {
  propertyId: string;
  code: string;
  name: string;
  names?: Names | undefined;
  descriptions?: Names | undefined;
  policyTexts?: Names | undefined;
  kind: "base" | "derived";
  basePlanId?: string | null | undefined;
  derivation?: Derivation | null | undefined;
  inherits?: Partial<RestrictionInheritance> | undefined;
  roomTypeIds: string[];
  baseOccupancy?: number | undefined;
  mealPlan?: MealPlan | undefined;
  paymentPolicyId: string;
  cancellationPolicyId: string;
  dateChangeAllowed?: boolean | undefined;
  earlyDepartureFeeKind?: FeeKind | undefined;
  earlyDepartureFeePercent?: number | null | undefined;
  public?: boolean | undefined;
  rateCode?: string | null | undefined;
  soldOnChannels?: boolean | undefined;
  active?: boolean | undefined;
  sortOrder?: number | undefined;
  supplements?: Supplement[] | undefined;
  includedServices?: IncludedService[] | undefined;
}

export interface RatePlan {
  id: string;
  propertyId: string;
  code: string;
  name: string;
  names: Names;
  descriptions: Names;
  policyTexts: Names;
  kind: "base" | "derived";
  basePlanId: string | null;
  basePlanCode: string | null;
  derivation: Derivation | null;
  inherits: RestrictionInheritance;
  roomTypeIds: string[];
  baseOccupancy: number;
  mealPlan: MealPlan;
  paymentPolicyId: string;
  cancellationPolicyId: string;
  dateChangeAllowed: boolean;
  earlyDepartureFeeKind: FeeKind;
  earlyDepartureFeePercent: number | null;
  public: boolean;
  rateCode: string | null;
  soldOnChannels: boolean;
  active: boolean;
  sortOrder: number;
  supplements: (Supplement & { ageBandName?: string | undefined })[];
  includedServices: (IncludedService & { serviceCode: string })[];
}

export type RatePlanPatch = Partial<Omit<RatePlanInput, "propertyId">>;

interface Row {
  id: string;
  property_id: string;
  code: string;
  name: string;
  names: Names;
  descriptions: Names;
  policy_texts: Names;
  kind: "base" | "derived";
  base_plan_id: string | null;
  base_plan_code: string | null;
  derivation_kind: "amount" | "percent" | null;
  derivation_value: string | null;
  inherits: Partial<RestrictionInheritance>;
  room_type_ids: string[];
  base_occupancy: number;
  meal_plan: MealPlan;
  payment_policy_id: string;
  cancellation_policy_id: string;
  date_change_allowed: boolean;
  early_departure_fee_kind: FeeKind;
  early_departure_fee_percent: string | null;
  public: boolean;
  rate_code: string | null;
  sold_on_channels: boolean;
  active: boolean;
  sort_order: number;
  supplements: { kind: Supplement["kind"]; age_band_id: string | null; age_band_name: string | null; amount: string }[];
  included_services: { service_id: string; service_code: string; component_price: string }[];
}

const SELECT = `select p.id, p.property_id, p.code, p.name, p.names, p.descriptions, p.policy_texts, p.kind, p.base_plan_id, b.code as base_plan_code,
    p.derivation_kind, p.derivation_value, p.inherits, p.base_occupancy, p.meal_plan, p.payment_policy_id, p.cancellation_policy_id,
    p.date_change_allowed, p.early_departure_fee_kind, p.early_departure_fee_percent, p.public, p.rate_code, p.sold_on_channels, p.active, p.sort_order,
    coalesce((select array_agg(rt.room_type_id order by t.sort_order, t.code) from rate_plan_room_types rt join room_types t on t.id = rt.room_type_id where rt.rate_plan_id = p.id), '{}') as room_type_ids,
    coalesce((select json_agg(json_build_object('kind', s.kind, 'age_band_id', s.age_band_id, 'age_band_name', ab.name, 'amount', s.amount) order by s.kind, ab.min_age)
              from rate_plan_supplements s left join age_bands ab on ab.id = s.age_band_id where s.rate_plan_id = p.id), '[]'::json) as supplements,
    coalesce((select json_agg(json_build_object('service_id', ps.service_id, 'service_code', sv.code, 'component_price', ps.component_price) order by sv.sort_order)
              from rate_plan_services ps join services sv on sv.id = ps.service_id where ps.rate_plan_id = p.id), '[]'::json) as included_services
  from rate_plans p left join rate_plans b on b.id = p.base_plan_id`;

function toInherits(raw: Partial<RestrictionInheritance> | undefined): RestrictionInheritance {
  return Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, raw?.[f] ?? false])) as RestrictionInheritance;
}

function toRatePlan(r: Row): RatePlan {
  return {
    id: r.id,
    propertyId: r.property_id,
    code: r.code,
    name: r.name,
    names: r.names ?? {},
    descriptions: r.descriptions ?? {},
    policyTexts: r.policy_texts ?? {},
    kind: r.kind,
    basePlanId: r.base_plan_id,
    basePlanCode: r.base_plan_code,
    derivation: r.derivation_kind && r.derivation_value !== null ? { kind: r.derivation_kind, value: Number(r.derivation_value) } : null,
    inherits: toInherits(r.inherits),
    roomTypeIds: r.room_type_ids,
    baseOccupancy: r.base_occupancy,
    mealPlan: r.meal_plan,
    paymentPolicyId: r.payment_policy_id,
    cancellationPolicyId: r.cancellation_policy_id,
    dateChangeAllowed: r.date_change_allowed,
    earlyDepartureFeeKind: r.early_departure_fee_kind,
    earlyDepartureFeePercent: r.early_departure_fee_percent === null ? null : Number(r.early_departure_fee_percent),
    public: r.public,
    rateCode: r.rate_code,
    soldOnChannels: r.sold_on_channels,
    active: r.active,
    sortOrder: r.sort_order,
    supplements: r.supplements.map((s) => ({ kind: s.kind, ageBandId: s.age_band_id ?? undefined, ageBandName: s.age_band_name ?? undefined, amount: Number(s.amount) })),
    includedServices: r.included_services.map((s) => ({ serviceId: s.service_id, serviceCode: s.service_code, componentPrice: Number(s.component_price) })),
  };
}

function money(value: number, what: string, min = 0): number {
  if (!Number.isFinite(value) || value < min) throw new Error(`${what} must be ${min === 0 ? "zero or more" : `at least ${min}`}`);
  return roundMoney(value);
}

function checkDerivation(d: Derivation | null | undefined): Derivation {
  if (!d || !isOneOf(DERIVATION_KINDS, d.kind) || !Number.isFinite(d.value)) throw new Error("A derived plan needs an amount or percentage off its base");
  if (d.kind === "percent" && d.value <= -100) throw new Error("A percentage below -100 % makes no price");
  return { kind: d.kind, value: roundMoney(d.value) };
}

function checkPercent(kind: FeeKind, value: number | null | undefined): number | null {
  if (kind !== "percent") return null;
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0 || value > 100) throw new Error("A percentage fee needs a percent above 0 and at most 100");
  return roundMoney(value);
}

/** Row-level checks that need the database; run inside the plan's transaction. */
async function checkReferences(
  tx: PoolClient,
  propertyId: string,
  v: { roomTypeIds: string[]; baseOccupancy: number; basePlanId: string | null; paymentPolicyId: string; cancellationPolicyId: string; supplements: Supplement[]; includedServices: IncludedService[] },
) {
  const rts = await tx.query<{ code: string; max_adults: number }>("select code, max_adults from room_types where property_id = $1 and id = any($2::uuid[])", [propertyId, v.roomTypeIds]);
  if (rts.rows.length !== v.roomTypeIds.length) throw new Error("Every room type must belong to this property");
  // "rate plan occupancy never above room type occupancy"
  const tooSmall = rts.rows.filter((r) => r.max_adults < v.baseOccupancy).map((r) => r.code);
  if (tooSmall.length) throw new Error(`Base occupancy ${v.baseOccupancy} is above the max adults of ${tooSmall.join(", ")}`);
  if (v.basePlanId) {
    const base = await tx.query<{ room_type_id: string }>("select room_type_id from rate_plan_room_types where rate_plan_id = $1", [v.basePlanId]);
    const baseSet = new Set(base.rows.map((r) => r.room_type_id));
    if (v.roomTypeIds.some((id) => !baseSet.has(id))) throw new Error("A derived plan spans only room types of its base plan");
  }
  const pay = await tx.query("select 1 from payment_policies where id = $1 and property_id = $2", [v.paymentPolicyId, propertyId]);
  if (!pay.rowCount) throw new Error("Payment Policy not found at this property");
  const cxl = await tx.query("select 1 from cancellation_policies where id = $1 and property_id = $2", [v.cancellationPolicyId, propertyId]);
  if (!cxl.rowCount) throw new Error("Cancellation Policy not found at this property");
  const bandIds = v.supplements.filter((s) => s.kind === "child").map((s) => s.ageBandId!);
  if (bandIds.length) {
    const bands = await tx.query<{ n: number }>("select count(distinct id)::int as n from age_bands where property_id = $1 and id = any($2::uuid[])", [propertyId, bandIds]);
    if (bands.rows[0]!.n !== new Set(bandIds).size) throw new Error("Every child supplement needs an Age Band of this property");
  }
  const serviceIds = v.includedServices.map((s) => s.serviceId);
  if (serviceIds.length) {
    const svc = await tx.query<{ n: number }>("select count(distinct id)::int as n from services where property_id = $1 and id = any($2::uuid[])", [propertyId, serviceIds]);
    if (svc.rows[0]!.n !== new Set(serviceIds).size) throw new Error("Every included Service must belong to this property");
  }
}

/** A derived plan follows a base plan of the same property; a derived plan is never a parent. */
async function checkBasePlan(tx: PoolClient, propertyId: string, basePlanId: string, selfId: string | null): Promise<void> {
  if (basePlanId === selfId) throw new Error("A plan cannot derive from itself");
  const { rows } = await tx.query<{ kind: string }>("select kind from rate_plans where id = $1 and property_id = $2", [basePlanId, propertyId]);
  if (!rows[0]) throw new Error("Base Rate Plan not found at this property");
  if (rows[0].kind !== "base") throw new Error("A derived plan cannot be the parent of another derived plan");
}

async function assertProjectedLimit(tx: PoolClient, propertyId: string, excludePlanId: string | null, addedRoomTypes: number): Promise<void> {
  const { rows } = await tx.query<{ n: number }>(
    "select count(*)::int as n from rate_plan_room_types rt join rate_plans p on p.id = rt.rate_plan_id where p.property_id = $1 and ($2::uuid is null or p.id <> $2)",
    [propertyId, excludePlanId],
  );
  const problem = checkPlanLimits({ roomTypes: 0, projectedRatePlans: rows[0]!.n + addedRoomTypes });
  if (problem) throw new Error(problem);
}

function uniqueRoomTypes(ids: string[]): string[] {
  const out = [...new Set(ids)];
  if (out.length === 0) throw new Error("A Rate Plan spans at least one room type");
  return out;
}

function checkSupplements(list: Supplement[]): Supplement[] {
  const seen = new Set<string>();
  return list.map((s) => {
    if (!isOneOf(SUPPLEMENT_KINDS, s.kind)) throw new Error("Unknown supplement kind");
    if ((s.kind === "child") !== Boolean(s.ageBandId)) throw new Error("A child supplement names an Age Band; other supplements do not");
    const key = `${s.kind}|${s.ageBandId ?? ""}`;
    if (seen.has(key)) throw new Error("Each supplement may appear once");
    seen.add(key);
    if (!Number.isFinite(s.amount)) throw new Error("Supplement amount must be a number");
    return { kind: s.kind, ageBandId: s.ageBandId, amount: roundMoney(s.amount) };
  });
}

/** Delete a plan's prices and restrictions outside the kept room types, logging each old value (issue 15: every change is logged). */
async function discardCells(tx: PoolClient, propertyId: string, userId: string, planId: string, keep: string[], reason: string): Promise<void> {
  const changeId = randomUUID();
  await tx.query(
    `insert into rate_changes (change_id, property_id, user_id, rate_plan_id, room_type_id, date, field, old_value, new_value, reason)
     select $1, $2, $3, r.rate_plan_id, r.room_type_id, r.date, 'price', r.price::text, null, $6
     from rates r where r.rate_plan_id = $4 and r.room_type_id <> all($5::uuid[])`,
    [changeId, propertyId, userId, planId, keep, reason],
  );
  await tx.query(
    `insert into rate_changes (change_id, property_id, user_id, rate_plan_id, room_type_id, date, field, old_value, new_value, reason)
     select $1, $2, $3, r.rate_plan_id, r.room_type_id, r.date, f.field, f.old_value, null, $6
     from restrictions r
     cross join lateral (values
       ('stopSell', r.stop_sell::text), ('closedToArrival', r.closed_to_arrival::text), ('closedToDeparture', r.closed_to_departure::text),
       ('minStayArrival', r.min_stay_arrival::text), ('minStayThrough', r.min_stay_through::text), ('maxStay', r.max_stay::text)
     ) as f(field, old_value)
     where r.rate_plan_id = $4 and r.room_type_id <> all($5::uuid[]) and f.old_value is distinct from 'false' and f.old_value is not null`,
    [changeId, propertyId, userId, planId, keep, reason],
  );
  await tx.query("delete from rates where rate_plan_id = $1 and room_type_id <> all($2::uuid[])", [planId, keep]);
  await tx.query("delete from restrictions where rate_plan_id = $1 and room_type_id <> all($2::uuid[])", [planId, keep]);
}

async function dropRoomTypes(tx: PoolClient, propertyId: string, userId: string, planId: string, keep: string[]): Promise<void> {
  await discardCells(tx, propertyId, userId, planId, keep, "room_type_removed");
  await tx.query("delete from rate_plan_room_types where rate_plan_id = $1 and room_type_id <> all($2::uuid[])", [planId, keep]);
}

async function writeChildren(tx: PoolClient, propertyId: string, userId: string, planId: string, supplements: Supplement[], services: IncludedService[], roomTypeIds: string[]) {
  await tx.query("delete from rate_plan_supplements where rate_plan_id = $1", [planId]);
  for (const s of supplements) {
    await tx.query("insert into rate_plan_supplements (rate_plan_id, kind, age_band_id, amount) values ($1, $2, $3, $4)", [planId, s.kind, s.ageBandId ?? null, s.amount]);
  }
  await tx.query("delete from rate_plan_services where rate_plan_id = $1", [planId]);
  for (const s of services) {
    await tx.query("insert into rate_plan_services (rate_plan_id, service_id, component_price) values ($1, $2, $3)", [planId, s.serviceId, money(s.componentPrice, "Component price")]);
  }
  // room types: drop what is no longer spanned (with its prices and restrictions), add the new
  await dropRoomTypes(tx, propertyId, userId, planId, roomTypeIds);
  await tx.query("insert into rate_plan_room_types (rate_plan_id, room_type_id) select $1, unnest($2::uuid[]) on conflict do nothing", [planId, roomTypeIds]);
  // a derived plan spans only room types of its base: narrow the children too
  const children = await tx.query<{ id: string }>("select id from rate_plans where base_plan_id = $1", [planId]);
  for (const child of children.rows) {
    const spanned = await tx.query<{ room_type_id: string }>("select room_type_id from rate_plan_room_types where rate_plan_id = $1", [child.id]);
    const keep = spanned.rows.map((r) => r.room_type_id).filter((id) => roomTypeIds.includes(id));
    if (keep.length !== spanned.rows.length) await dropRoomTypes(tx, propertyId, userId, child.id, keep);
  }
}

export async function createRatePlan(pool: Pool, schema: string, input: RatePlanInput, options: { userId?: string | undefined } = {}): Promise<RatePlan> {
  const code = normaliseCode(input.code);
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  if (input.kind !== "base" && input.kind !== "derived") throw new Error("A plan is base or derived");
  const derivation = input.kind === "derived" ? checkDerivation(input.derivation) : null;
  if (input.kind === "derived" && !input.basePlanId) throw new Error("A derived plan needs a base plan");
  const mealPlan = input.mealPlan ?? "none";
  if (!isOneOf(MEAL_PLANS, mealPlan)) throw new Error("Unknown meal plan");
  const edk = input.earlyDepartureFeeKind ?? "none";
  if (!isOneOf(FEE_KINDS, edk)) throw new Error("Unknown fee kind");
  const isPublic = input.public ?? true;
  const rateCode = input.rateCode?.trim() || null;
  if (!isPublic && !rateCode) throw new Error("A hidden plan needs a Rate Code");
  const baseOccupancy = input.baseOccupancy ?? 2;
  if (!Number.isInteger(baseOccupancy) || baseOccupancy < 1) throw new Error("Base occupancy must be at least 1");
  const roomTypeIds = uniqueRoomTypes(input.roomTypeIds);
  const supplements = checkSupplements(input.supplements ?? []);
  const includedServices = input.includedServices ?? [];
  const inherits = input.kind === "derived" ? toInherits(input.inherits ?? INHERIT_ALL) : toInherits({});
  return withTenant(pool, schema, async (tx) => {
    await tx.query("select 1 from properties where id = $1 for update", [input.propertyId]);
    if (input.kind === "derived") await checkBasePlan(tx, input.propertyId, input.basePlanId!, null);
    await checkReferences(tx, input.propertyId, {
      roomTypeIds,
      baseOccupancy,
      basePlanId: input.kind === "derived" ? input.basePlanId! : null,
      paymentPolicyId: input.paymentPolicyId,
      cancellationPolicyId: input.cancellationPolicyId,
      supplements,
      includedServices,
    });
    await assertProjectedLimit(tx, input.propertyId, null, roomTypeIds.length);
    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `insert into rate_plans (property_id, code, name, names, descriptions, policy_texts, kind, base_plan_id, derivation_kind, derivation_value, inherits,
           base_occupancy, meal_plan, payment_policy_id, cancellation_policy_id, date_change_allowed, early_departure_fee_kind, early_departure_fee_percent,
           public, rate_code, sold_on_channels, active, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
           coalesce($23, (select coalesce(max(sort_order), 0) + 1 from rate_plans where property_id = $1)))
         returning id`,
        [
          input.propertyId,
          code,
          name,
          JSON.stringify(mergeNames({}, input.names ?? {})),
          JSON.stringify(mergeNames({}, input.descriptions ?? {})),
          JSON.stringify(mergeNames({}, input.policyTexts ?? {})),
          input.kind,
          input.kind === "derived" ? input.basePlanId : null,
          derivation?.kind ?? null,
          derivation?.value ?? null,
          JSON.stringify(inherits),
          baseOccupancy,
          mealPlan,
          input.paymentPolicyId,
          input.cancellationPolicyId,
          input.dateChangeAllowed ?? true,
          edk,
          checkPercent(edk, input.earlyDepartureFeePercent),
          isPublic,
          rateCode,
          input.soldOnChannels ?? true,
          input.active ?? true,
          input.sortOrder ?? null,
        ],
      );
      id = rows[0]!.id;
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Rate Plan ${code} already exists at this property`);
      throw err;
    }
    await writeChildren(tx, input.propertyId, options.userId ?? "system", id, supplements, includedServices, roomTypeIds);
    if (input.kind === "derived") await rewriteDerivedPlan(tx, input.propertyId, options.userId ?? "system", id);
    const found = await tx.query<Row>(`${SELECT} where p.id = $1`, [id]);
    return toRatePlan(found.rows[0]!);
  });
}

export async function updateRatePlan(pool: Pool, schema: string, propertyId: string, id: string, patch: RatePlanPatch, options: { userId?: string | undefined } = {}): Promise<RatePlan> {
  return withTenant(pool, schema, async (tx) => {
    await tx.query("select 1 from properties where id = $1 for update", [propertyId]);
    const current = await tx.query<Row>(`${SELECT} where p.id = $1 and p.property_id = $2`, [id, propertyId]);
    const c = current.rows[0];
    if (!c) throw new Error("Rate Plan not found");
    const cur = toRatePlan(c);
    const kind = patch.kind ?? cur.kind;
    if (kind !== "base" && kind !== "derived") throw new Error("A plan is base or derived");
    if (kind === "derived") {
      const children = await tx.query("select 1 from rate_plans where base_plan_id = $1", [id]);
      if (children.rowCount) throw new Error("Other plans derive from this one, so it must stay a base plan");
    }
    const basePlanId = kind === "derived" ? (patch.basePlanId ?? cur.basePlanId) : null;
    if (kind === "derived" && !basePlanId) throw new Error("A derived plan needs a base plan");
    if (basePlanId) await checkBasePlan(tx, propertyId, basePlanId, id);
    const derivation = kind === "derived" ? checkDerivation(patch.derivation ?? cur.derivation) : null;
    const code = patch.code !== undefined ? normaliseCode(patch.code) : cur.code;
    const name = patch.name !== undefined ? patch.name.trim() : cur.name;
    if (!name) throw new Error("Name is required");
    const mealPlan = patch.mealPlan ?? cur.mealPlan;
    if (!isOneOf(MEAL_PLANS, mealPlan)) throw new Error("Unknown meal plan");
    const edk = patch.earlyDepartureFeeKind ?? cur.earlyDepartureFeeKind;
    if (!isOneOf(FEE_KINDS, edk)) throw new Error("Unknown fee kind");
    const isPublic = patch.public ?? cur.public;
    const rateCode = patch.rateCode !== undefined ? patch.rateCode?.trim() || null : cur.rateCode;
    if (!isPublic && !rateCode) throw new Error("A hidden plan needs a Rate Code");
    const baseOccupancy = patch.baseOccupancy ?? cur.baseOccupancy;
    if (!Number.isInteger(baseOccupancy) || baseOccupancy < 1) throw new Error("Base occupancy must be at least 1");
    const roomTypeIds = patch.roomTypeIds !== undefined ? uniqueRoomTypes(patch.roomTypeIds) : cur.roomTypeIds;
    const supplements = patch.supplements !== undefined ? checkSupplements(patch.supplements) : cur.supplements.map((s) => ({ kind: s.kind, ageBandId: s.ageBandId, amount: s.amount }));
    const includedServices = patch.includedServices !== undefined ? patch.includedServices : cur.includedServices.map((s) => ({ serviceId: s.serviceId, componentPrice: s.componentPrice }));
    const inherits = kind === "derived" ? toInherits(patch.inherits ?? (cur.kind === "derived" ? cur.inherits : INHERIT_ALL)) : toInherits({});
    const paymentPolicyId = patch.paymentPolicyId ?? cur.paymentPolicyId;
    const cancellationPolicyId = patch.cancellationPolicyId ?? cur.cancellationPolicyId;
    await checkReferences(tx, propertyId, { roomTypeIds, baseOccupancy, basePlanId, paymentPolicyId, cancellationPolicyId, supplements, includedServices });
    await assertProjectedLimit(tx, propertyId, id, roomTypeIds.length);
    try {
      await tx.query(
        `update rate_plans set code = $3, name = $4, names = $5, descriptions = $6, policy_texts = $7, kind = $8, base_plan_id = $9, derivation_kind = $10, derivation_value = $11,
           inherits = $12, base_occupancy = $13, meal_plan = $14, payment_policy_id = $15, cancellation_policy_id = $16, date_change_allowed = $17,
           early_departure_fee_kind = $18, early_departure_fee_percent = $19, public = $20, rate_code = $21, sold_on_channels = $22, active = $23, sort_order = $24, updated_at = now()
         where id = $1 and property_id = $2`,
        [
          id,
          propertyId,
          code,
          name,
          JSON.stringify(patch.names ? mergeNames(cur.names, patch.names) : cur.names),
          JSON.stringify(patch.descriptions ? mergeNames(cur.descriptions, patch.descriptions) : cur.descriptions),
          JSON.stringify(patch.policyTexts ? mergeNames(cur.policyTexts, patch.policyTexts) : cur.policyTexts),
          kind,
          basePlanId,
          derivation?.kind ?? null,
          derivation?.value ?? null,
          JSON.stringify(inherits),
          baseOccupancy,
          mealPlan,
          paymentPolicyId,
          cancellationPolicyId,
          patch.dateChangeAllowed ?? cur.dateChangeAllowed,
          edk,
          checkPercent(edk, patch.earlyDepartureFeePercent !== undefined ? patch.earlyDepartureFeePercent : cur.earlyDepartureFeePercent),
          isPublic,
          rateCode,
          patch.soldOnChannels ?? cur.soldOnChannels,
          patch.active ?? cur.active,
          patch.sortOrder ?? cur.sortOrder,
        ],
      );
    } catch (err) {
      if (uniqueViolation(err)) throw new Error(`Rate Plan ${code} already exists at this property`);
      throw err;
    }
    await writeChildren(tx, propertyId, options.userId ?? "system", id, supplements, includedServices, roomTypeIds);
    if (kind === "derived") {
      // a base plan's entered prices give way to derived ones; log them before they go
      if (cur.kind === "base") await discardCells(tx, propertyId, options.userId ?? "system", id, [], "became_derived");
      await rewriteDerivedPlan(tx, propertyId, options.userId ?? "system", id);
    }
    const found = await tx.query<Row>(`${SELECT} where p.id = $1`, [id]);
    return toRatePlan(found.rows[0]!);
  });
}

export async function listRatePlans(pool: Pool, schema: string, propertyId: string, options: { includeInactive?: boolean } = {}): Promise<RatePlan[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} where p.property_id = $1 ${options.includeInactive ? "" : "and p.active"} order by p.sort_order, p.code`, [propertyId]);
    return rows.map(toRatePlan);
  });
}

export async function findRatePlan(pool: Pool, schema: string, propertyId: string, id: string): Promise<RatePlan | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} where p.id = $1 and p.property_id = $2`, [id, propertyId]);
    return rows[0] ? toRatePlan(rows[0]) : null;
  });
}
