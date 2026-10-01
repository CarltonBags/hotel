import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  OPEN_RESTRICTION,
  RESTRICTION_FIELDS,
  derivedPrice,
  effectiveRestriction,
  planBulkEdit,
  roundMoney,
  type BulkEdit,
  type BulkPreview,
  type GridRow,
  type Derivation,
  type Restriction,
  type RestrictionInheritance,
} from "@hoteloftware/domain";
import { checkDate } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

/**
 * Rates and Restrictions per Rate Plan, room type and date (ADR 0012).
 * Base plans take prices; derived plans' stored values are rewritten from
 * their base here. Every cell change is logged in rate_changes under one
 * change id so ticket 18 can undo a whole edit.
 */

export interface RateCell {
  ratePlanId: string;
  roomTypeId: string;
  date: string;
  price: number;
}

export interface RateWriteResult {
  changeId: string;
  /** Cells written into base plans. */
  written: number;
  /** Cells rewritten in derived plans. */
  derived: number;
}

export interface RestrictionCellPatch {
  ratePlanId: string;
  roomTypeId: string;
  date: string;
  patch: Partial<Restriction>;
}

export interface RestrictionCell {
  ratePlanId: string;
  roomTypeId: string;
  date: string;
  /** What is stored on this plan. */
  own: Restriction;
  /** What applies: own, or the base plan's for inherited fields of a derived plan. */
  restriction: Restriction;
}

export interface RateChange {
  id: string;
  changeId: string;
  userId: string;
  at: Date;
  ratePlanId: string;
  roomTypeId: string;
  date: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
}

export interface DateRange {
  from: string;
  to: string;
}

/** Enough of every plan at a property to validate and derive writes. */
export interface PlanIndexEntry {
  id: string;
  code: string;
  kind: "base" | "derived";
  basePlanId: string | null;
  derivation: Derivation | null;
  inherits: RestrictionInheritance;
  roomTypeIds: Set<string>;
}

/** Prices are kept at least 500 days ahead (issue 15); two such horizons bound one write. */
const MAX_RANGE_DAYS = 1100;

export function datesBetween(range: DateRange): string[] {
  const from = checkDate(range.from);
  const to = checkDate(range.to);
  if (to < from) throw new Error("The end date is before the start date");
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (out.length > MAX_RANGE_DAYS) throw new Error(`At most ${MAX_RANGE_DAYS} days at once`);
  }
  return out;
}

export async function loadPlanIndex(tx: PoolClient, propertyId: string): Promise<Map<string, PlanIndexEntry>> {
  const { rows } = await tx.query<{
    id: string;
    code: string;
    kind: "base" | "derived";
    base_plan_id: string | null;
    derivation_kind: "amount" | "percent" | null;
    derivation_value: string | null;
    inherits: Partial<RestrictionInheritance>;
    room_type_ids: string[];
  }>(
    `select p.id, p.code, p.kind, p.base_plan_id, p.derivation_kind, p.derivation_value, p.inherits,
       coalesce((select array_agg(rt.room_type_id) from rate_plan_room_types rt where rt.rate_plan_id = p.id), '{}') as room_type_ids
     from rate_plans p where p.property_id = $1`,
    [propertyId],
  );
  const index = new Map<string, PlanIndexEntry>();
  for (const r of rows) {
    const inherits = Object.fromEntries(RESTRICTION_FIELDS.map((f) => [f, r.inherits?.[f] ?? false])) as RestrictionInheritance;
    index.set(r.id, {
      id: r.id,
      code: r.code,
      kind: r.kind,
      basePlanId: r.base_plan_id,
      derivation: r.derivation_kind && r.derivation_value !== null ? { kind: r.derivation_kind, value: Number(r.derivation_value) } : null,
      inherits,
      roomTypeIds: new Set(r.room_type_ids),
    });
  }
  return index;
}

function checkPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw new Error("Price must be zero or more");
  return roundMoney(price);
}

/** Last write wins for a cell named twice; Postgres refuses to touch a row twice in one upsert. */
function dedupe<T extends { ratePlanId: string; roomTypeId: string; date: string }>(cells: T[]): T[] {
  const map = new Map<string, T>();
  for (const c of cells) map.set(`${c.ratePlanId}|${c.roomTypeId}|${c.date}`, c);
  return [...map.values()];
}

/** Upsert cells and log every changed value under the change id. Returns the stored prices. */
async function upsertRates(tx: PoolClient, propertyId: string, userId: string, changeId: string, reason: "edit" | "derived", cells: RateCell[]): Promise<RateCell[]> {
  if (cells.length === 0) return [];
  const { rows } = await tx.query<{ rate_plan_id: string; room_type_id: string; date: string; price: string }>(
    `with input as (
       select * from unnest($1::uuid[], $2::uuid[], $3::date[], $4::numeric[]) as t(rate_plan_id, room_type_id, date, price)
     ),
     old as (
       select i.rate_plan_id, i.room_type_id, i.date, r.price as old_price
       from input i left join rates r on r.rate_plan_id = i.rate_plan_id and r.room_type_id = i.room_type_id and r.date = i.date
     ),
     up as (
       insert into rates (rate_plan_id, room_type_id, date, price)
       select rate_plan_id, room_type_id, date, price from input
       on conflict (rate_plan_id, room_type_id, date) do update set price = excluded.price
       returning rate_plan_id, room_type_id, date, price
     ),
     logged as (
       insert into rate_changes (change_id, property_id, user_id, rate_plan_id, room_type_id, date, field, old_value, new_value, reason)
       select $5, $6, $7, u.rate_plan_id, u.room_type_id, u.date, 'price', o.old_price::text, u.price::text, $8
       from up u join old o on o.rate_plan_id = u.rate_plan_id and o.room_type_id = u.room_type_id and o.date = u.date
       where o.old_price is distinct from u.price
     )
     select rate_plan_id, room_type_id, to_char(date, 'YYYY-MM-DD') as date, price from up`,
    [cells.map((c) => c.ratePlanId), cells.map((c) => c.roomTypeId), cells.map((c) => c.date), cells.map((c) => c.price), changeId, propertyId, userId, reason],
  );
  return rows.map((r) => ({ ratePlanId: r.rate_plan_id, roomTypeId: r.room_type_id, date: r.date, price: Number(r.price) }));
}

/** The derived cells that follow a set of base cells. */
function deriveCells(index: Map<string, PlanIndexEntry>, baseCells: RateCell[]): RateCell[] {
  const out: RateCell[] = [];
  for (const plan of index.values()) {
    if (plan.kind !== "derived" || !plan.basePlanId || !plan.derivation) continue;
    for (const c of baseCells) {
      if (c.ratePlanId !== plan.basePlanId || !plan.roomTypeIds.has(c.roomTypeId)) continue;
      out.push({ ratePlanId: plan.id, roomTypeId: c.roomTypeId, date: c.date, price: derivedPrice(c.price, plan.derivation) });
    }
  }
  return out;
}


/**
 * Write prices into base plans; derived plans spanning the same room types
 * follow. Queueing for the channel manager (ADR 0012) belongs to the channel
 * sync ticket's outbox; until then the change log is the source for it.
 */
export async function setRates(pool: Pool, schema: string, propertyId: string, userId: string, cells: RateCell[]): Promise<RateWriteResult> {
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    return setRatesIn(tx, propertyId, userId, randomUUID(), cells);
  });
}

async function setRatesIn(tx: PoolClient, propertyId: string, userId: string, changeId: string, cells: RateCell[]): Promise<RateWriteResult> {
  const clean = dedupe(cells.map((c) => ({ ...c, date: checkDate(c.date), price: checkPrice(c.price) })));
  const index = await loadPlanIndex(tx, propertyId);
  for (const c of clean) {
    const plan = index.get(c.ratePlanId);
    if (!plan) throw new Error("Rate Plan not found at this property");
    if (plan.kind === "derived") throw new Error(`${plan.code} is a derived plan; its prices follow its base`);
    if (!plan.roomTypeIds.has(c.roomTypeId)) throw new Error(`${plan.code} does not span this room type`);
  }
  const written = await upsertRates(tx, propertyId, userId, changeId, "edit", clean);
  const derived = await upsertRates(tx, propertyId, userId, changeId, "derived", deriveCells(index, written));
  return { changeId, written: written.length, derived: derived.length };
}

/** A grid edit (typed price or bulk Apply): prices, their followers and restrictions as one change, so Undo reverts it whole. */
export async function applyGridEdit(
  pool: Pool,
  schema: string,
  propertyId: string,
  userId: string,
  edit: { prices: RateCell[]; restrictions: RestrictionCellPatch[] },
): Promise<RateWriteResult & { restrictions: number }> {
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const changeId = randomUUID();
    const rates = await setRatesIn(tx, propertyId, userId, changeId, edit.prices);
    const restr = await setRestrictionsIn(tx, propertyId, userId, edit.restrictions, changeId);
    return { ...rates, restrictions: restr.written };
  });
}

/**
 * Bulk Apply from the Rates grid. The plan is computed inside the locked
 * transaction from the stored state with the same planner the browser's
 * preview used, so no edit can land between planning and writing. Refused
 * when the change no longer matches what the user previewed.
 */
export async function applyBulkEdit(
  pool: Pool,
  schema: string,
  propertyId: string,
  userId: string,
  edit: BulkEdit,
  expectedCells: number,
): Promise<{ changeId: string | null; preview: BulkPreview; stale: boolean }> {
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const from = checkDate(edit.from <= edit.to ? edit.from : edit.to);
    const to = checkDate(edit.from <= edit.to ? edit.to : edit.from);
    const index = await loadPlanIndex(tx, propertyId);
    const floors = await tx.query<{ id: string; price_floor: string | null }>("select id, price_floor from room_types where property_id = $1", [propertyId]);
    const floor = new Map(floors.rows.map((r) => [r.id, r.price_floor === null ? null : Number(r.price_floor)]));
    const rows: GridRow[] = [...index.values()].flatMap((p) =>
      [...p.roomTypeIds].map((rt) => ({ ratePlanId: p.id, roomTypeId: rt, basePlanId: p.basePlanId, derivation: p.derivation, inherits: p.kind === "derived" ? p.inherits : null, priceFloor: floor.get(rt) ?? null })),
    );
    const prices = await tx.query<{ rate_plan_id: string; room_type_id: string; date: string; price: string }>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.price from rates r join rate_plans p on p.id = r.rate_plan_id
       where p.property_id = $1 and r.date between $2 and $3`,
      [propertyId, from, to],
    );
    const stored = await tx.query<RestrictionRow>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.stop_sell, r.closed_to_arrival, r.closed_to_departure, r.min_stay_arrival, r.min_stay_through, r.max_stay
       from restrictions r join rate_plans p on p.id = r.rate_plan_id where p.property_id = $1 and r.date between $2 and $3`,
      [propertyId, from, to],
    );
    const priceMap = new Map(prices.rows.map((r) => [`${r.rate_plan_id}|${r.room_type_id}|${r.date}`, Number(r.price)]));
    const restrMap = new Map(stored.rows.map((r) => [`${r.rate_plan_id}|${r.room_type_id}|${r.date}`, toRestriction(r)]));
    const plan = planBulkEdit(edit, rows, {
      price: (p, r, d) => priceMap.get(`${p}|${r}|${d}`) ?? null,
      restriction: (p, r, d) => restrMap.get(`${p}|${r}|${d}`) ?? OPEN_RESTRICTION,
    });
    if (plan.preview.negative > 0) throw new Error(`${plan.preview.negative} prices would fall below zero`);
    if (plan.preview.cells === 0) throw new Error("Nothing would change");
    if (plan.preview.cells !== expectedCells) return { changeId: null, preview: plan.preview, stale: true };
    const changeId = randomUUID();
    await setRatesIn(tx, propertyId, userId, changeId, plan.prices);
    await setRestrictionsIn(tx, propertyId, userId, plan.restrictions, changeId);
    return { changeId, preview: plan.preview, stale: false };
  });
}

/**
 * Recompute every stored price of a derived plan from its base (after the plan
 * was created, its derivation changed or room types were added).
 */
export async function rewriteDerivedPlan(tx: PoolClient, propertyId: string, userId: string, derivedPlanId: string): Promise<number> {
  const index = await loadPlanIndex(tx, propertyId);
  const plan = index.get(derivedPlanId);
  if (!plan || plan.kind !== "derived" || !plan.basePlanId || !plan.derivation) return 0;
  const { rows } = await tx.query<{ room_type_id: string; date: string; price: string }>(
    "select room_type_id, to_char(date, 'YYYY-MM-DD') as date, price from rates where rate_plan_id = $1 and room_type_id = any($2::uuid[])",
    [plan.basePlanId, [...plan.roomTypeIds]],
  );
  const cells = rows.map((r) => ({ ratePlanId: plan.id, roomTypeId: r.room_type_id, date: r.date, price: derivedPrice(Number(r.price), plan.derivation!) }));
  const written = await upsertRates(tx, propertyId, userId, randomUUID(), "derived", cells);
  return written.length;
}

export interface RateQuery extends DateRange {
  ratePlanId?: string | undefined;
  roomTypeId?: string | undefined;
}

export async function listRates(pool: Pool, schema: string, propertyId: string, q: RateQuery): Promise<RateCell[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ rate_plan_id: string; room_type_id: string; date: string; price: string }>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.price
       from rates r join rate_plans p on p.id = r.rate_plan_id
       where p.property_id = $1 and r.date between $2 and $3 and ($4::uuid is null or r.rate_plan_id = $4) and ($5::uuid is null or r.room_type_id = $5)
       order by p.sort_order, p.code, r.room_type_id, r.date`,
      [propertyId, checkDate(q.from), checkDate(q.to), q.ratePlanId ?? null, q.roomTypeId ?? null],
    );
    return rows.map((r) => ({ ratePlanId: r.rate_plan_id, roomTypeId: r.room_type_id, date: r.date, price: Number(r.price) }));
  });
}

function checkStay(value: number | null | undefined, what: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${what} must be a whole number of nights, at least 1`);
  return value;
}

/** Merge a patch into each cell's stored restriction; unmentioned fields keep their value. */
export async function setRestrictions(pool: Pool, schema: string, propertyId: string, userId: string, cells: RestrictionCellPatch[]): Promise<{ changeId: string; written: number }> {
  return withTenant(pool, schema, (tx) => setRestrictionsIn(tx, propertyId, userId, cells));
}

async function setRestrictionsIn(tx: PoolClient, propertyId: string, userId: string, cells: RestrictionCellPatch[], changeId: string = randomUUID()): Promise<{ changeId: string; written: number }> {
  const clean = dedupe(
    cells.map((c) => {
      const patch: Record<string, boolean | number | null> = {};
      if (c.patch.stopSell !== undefined) patch.stopSell = c.patch.stopSell;
      if (c.patch.closedToArrival !== undefined) patch.closedToArrival = c.patch.closedToArrival;
      if (c.patch.closedToDeparture !== undefined) patch.closedToDeparture = c.patch.closedToDeparture;
      if (c.patch.minStayArrival !== undefined) patch.minStayArrival = checkStay(c.patch.minStayArrival, "Minimum stay on arrival");
      if (c.patch.minStayThrough !== undefined) patch.minStayThrough = checkStay(c.patch.minStayThrough, "Minimum stay through");
      if (c.patch.maxStay !== undefined) patch.maxStay = checkStay(c.patch.maxStay, "Maximum stay");
      return { ratePlanId: c.ratePlanId, roomTypeId: c.roomTypeId, date: checkDate(c.date), patch };
    }),
  );
  if (clean.length === 0) return { changeId, written: 0 };
  await lockProperty(tx, propertyId);
  const index = await loadPlanIndex(tx, propertyId);
  for (const c of clean) {
    const plan = index.get(c.ratePlanId);
    if (!plan) throw new Error("Rate Plan not found at this property");
    if (!plan.roomTypeIds.has(c.roomTypeId)) throw new Error(`${plan.code} does not span this room type`);
  }
  await tx.query(
      `with input as (
         select * from unnest($1::uuid[], $2::uuid[], $3::date[], $4::jsonb[]) as t(rate_plan_id, room_type_id, date, patch)
       ),
       old as (
         select i.rate_plan_id, i.room_type_id, i.date, i.patch,
           coalesce(r.stop_sell, false) as stop_sell, coalesce(r.closed_to_arrival, false) as closed_to_arrival, coalesce(r.closed_to_departure, false) as closed_to_departure,
           r.min_stay_arrival, r.min_stay_through, r.max_stay
         from input i left join restrictions r on r.rate_plan_id = i.rate_plan_id and r.room_type_id = i.room_type_id and r.date = i.date
       ),
       up as (
         insert into restrictions (rate_plan_id, room_type_id, date, stop_sell, closed_to_arrival, closed_to_departure, min_stay_arrival, min_stay_through, max_stay)
         select o.rate_plan_id, o.room_type_id, o.date,
           case when o.patch ? 'stopSell' then (o.patch->>'stopSell')::boolean else o.stop_sell end,
           case when o.patch ? 'closedToArrival' then (o.patch->>'closedToArrival')::boolean else o.closed_to_arrival end,
           case when o.patch ? 'closedToDeparture' then (o.patch->>'closedToDeparture')::boolean else o.closed_to_departure end,
           case when o.patch ? 'minStayArrival' then (o.patch->>'minStayArrival')::int else o.min_stay_arrival end,
           case when o.patch ? 'minStayThrough' then (o.patch->>'minStayThrough')::int else o.min_stay_through end,
           case when o.patch ? 'maxStay' then (o.patch->>'maxStay')::int else o.max_stay end
         from old o
         on conflict (rate_plan_id, room_type_id, date) do update set
           stop_sell = excluded.stop_sell, closed_to_arrival = excluded.closed_to_arrival, closed_to_departure = excluded.closed_to_departure,
           min_stay_arrival = excluded.min_stay_arrival, min_stay_through = excluded.min_stay_through, max_stay = excluded.max_stay
         returning *
       )
       insert into rate_changes (change_id, property_id, user_id, rate_plan_id, room_type_id, date, field, old_value, new_value, reason)
       select $5, $6, $7, u.rate_plan_id, u.room_type_id, u.date, f.field, f.old_value, f.new_value, 'edit'
       from up u
       join old o on o.rate_plan_id = u.rate_plan_id and o.room_type_id = u.room_type_id and o.date = u.date
       cross join lateral (values
         ('stopSell', o.stop_sell::text, u.stop_sell::text),
         ('closedToArrival', o.closed_to_arrival::text, u.closed_to_arrival::text),
         ('closedToDeparture', o.closed_to_departure::text, u.closed_to_departure::text),
         ('minStayArrival', o.min_stay_arrival::text, u.min_stay_arrival::text),
         ('minStayThrough', o.min_stay_through::text, u.min_stay_through::text),
         ('maxStay', o.max_stay::text, u.max_stay::text)
       ) as f(field, old_value, new_value)
       where f.old_value is distinct from f.new_value`,
      [clean.map((c) => c.ratePlanId), clean.map((c) => c.roomTypeId), clean.map((c) => c.date), clean.map((c) => JSON.stringify(c.patch)), changeId, propertyId, userId],
  );
  return { changeId, written: clean.length };
}

export interface RestrictionRow {
  rate_plan_id: string;
  room_type_id: string;
  date: string;
  stop_sell: boolean;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  min_stay_arrival: number | null;
  min_stay_through: number | null;
  max_stay: number | null;
}
export const toRestriction = (r: RestrictionRow): Restriction => ({
  stopSell: r.stop_sell,
  closedToArrival: r.closed_to_arrival,
  closedToDeparture: r.closed_to_departure,
  minStayArrival: r.min_stay_arrival,
  minStayThrough: r.min_stay_through,
  maxStay: r.max_stay,
});

/**
 * Stored and effective restrictions in a range. A derived plan gets a cell
 * wherever it or its base has one, with inherited fields taken from the base.
 */
export async function listRestrictions(pool: Pool, schema: string, propertyId: string, q: RateQuery): Promise<RestrictionCell[]> {
  return withTenant(pool, schema, async (tx) => {
    const index = await loadPlanIndex(tx, propertyId);
    const { rows } = await tx.query<RestrictionRow>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.stop_sell, r.closed_to_arrival, r.closed_to_departure, r.min_stay_arrival, r.min_stay_through, r.max_stay
       from restrictions r join rate_plans p on p.id = r.rate_plan_id
       where p.property_id = $1 and r.date between $2 and $3 and ($4::uuid is null or r.room_type_id = $4)`,
      [propertyId, checkDate(q.from), checkDate(q.to), q.roomTypeId ?? null],
    );
    const stored = new Map<string, Restriction>();
    for (const r of rows) stored.set(`${r.rate_plan_id}|${r.room_type_id}|${r.date}`, toRestriction(r));
    const keys = new Set(stored.keys());
    for (const plan of index.values()) {
      if (plan.kind !== "derived" || !plan.basePlanId) continue;
      for (const key of [...stored.keys()]) {
        const [planId, roomTypeId, date] = key.split("|") as [string, string, string];
        if (planId === plan.basePlanId && plan.roomTypeIds.has(roomTypeId)) keys.add(`${plan.id}|${roomTypeId}|${date}`);
      }
    }
    const out: RestrictionCell[] = [];
    for (const key of keys) {
      const [ratePlanId, roomTypeId, date] = key.split("|") as [string, string, string];
      if (q.ratePlanId && ratePlanId !== q.ratePlanId) continue;
      const plan = index.get(ratePlanId);
      if (!plan) continue;
      const own = stored.get(key) ?? OPEN_RESTRICTION;
      const base = plan.kind === "derived" && plan.basePlanId ? (stored.get(`${plan.basePlanId}|${roomTypeId}|${date}`) ?? OPEN_RESTRICTION) : null;
      out.push({ ratePlanId, roomTypeId, date, own, restriction: base ? effectiveRestriction(own, base, plan.inherits) : own });
    }
    out.sort((a, b) => a.ratePlanId.localeCompare(b.ratePlanId) || a.roomTypeId.localeCompare(b.roomTypeId) || a.date.localeCompare(b.date));
    return out;
  });
}

/** One transaction: the plans read are the plans written. */
async function closeCells(pool: Pool, schema: string, propertyId: string, userId: string, range: DateRange, roomTypeId: string | null) {
  const dates = datesBetween(range);
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const index = await loadPlanIndex(tx, propertyId);
    const cells: RestrictionCellPatch[] = [];
    for (const plan of index.values()) {
      for (const rt of plan.roomTypeIds) {
        if (roomTypeId && rt !== roomTypeId) continue;
        for (const date of dates) cells.push({ ratePlanId: plan.id, roomTypeId: rt, date, patch: { stopSell: true } });
      }
    }
    return setRestrictionsIn(tx, propertyId, userId, cells);
  });
}

/** Shortcut: stop sell on every plan and room type for the dates. */
export function closeProperty(pool: Pool, schema: string, propertyId: string, userId: string, range: DateRange) {
  return closeCells(pool, schema, propertyId, userId, range, null);
}

/** Shortcut: stop sell on every plan spanning the room type for the dates. */
export function closeRoomType(pool: Pool, schema: string, propertyId: string, userId: string, roomTypeId: string, range: DateRange) {
  return closeCells(pool, schema, propertyId, userId, range, roomTypeId);
}

export async function listRateChanges(pool: Pool, schema: string, propertyId: string, q: { changeId?: string | undefined; limit?: number | undefined } = {}): Promise<RateChange[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      change_id: string;
      user_id: string;
      at: Date;
      rate_plan_id: string;
      room_type_id: string;
      date: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      reason: string;
    }>(
      `select id, change_id, user_id, at, rate_plan_id, room_type_id, to_char(date, 'YYYY-MM-DD') as date, field, old_value, new_value, reason
       from rate_changes where property_id = $1 and ($2::uuid is null or change_id = $2)
       order by max(at) over (partition by change_id) desc, change_id, reason = 'derived', field <> 'price', date, rate_plan_id, room_type_id limit $3`,
      [propertyId, q.changeId ?? null, q.limit ?? 500],
    );
    return rows.map((r) => ({
      id: r.id,
      changeId: r.change_id,
      userId: r.user_id,
      at: r.at,
      ratePlanId: r.rate_plan_id,
      roomTypeId: r.room_type_id,
      date: r.date,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      reason: r.reason,
    }));
  });
}

const UNDO_WINDOW_MS = 10 * 60_000;

const RESTRICTION_COLUMNS: Record<string, { column: string; type: "boolean" | "int" }> = {
  stopSell: { column: "stop_sell", type: "boolean" },
  closedToArrival: { column: "closed_to_arrival", type: "boolean" },
  closedToDeparture: { column: "closed_to_departure", type: "boolean" },
  minStayArrival: { column: "min_stay_arrival", type: "int" },
  minStayThrough: { column: "min_stay_through", type: "int" },
  maxStay: { column: "max_stay", type: "int" },
};

/**
 * Revert the user's last change at the property if it is at most 10 minutes
 * old and not undone yet. Every cell of it returns to its old value: typed or
 * bulk prices, the derived prices that followed, and restrictions. Refused
 * when anyone changed one of those cells since.
 */
export async function undoLastChange(pool: Pool, schema: string, propertyId: string, userId: string, options: { now?: Date } = {}): Promise<{ changeId: string; cells: number }> {
  const now = options.now ?? new Date();
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const last = await tx.query<{ change_id: string; at: Date }>(
      `select change_id, max(at) as at from rate_changes
       where property_id = $1 and user_id = $2 and reason in ('edit', 'derived')
       group by change_id order by max(at) desc limit 1`,
      [propertyId, userId],
    );
    const target = last.rows[0];
    if (!target || now.getTime() - target.at.getTime() > UNDO_WINDOW_MS) throw new Error("Nothing to undo: changes can be undone for 10 minutes");
    const done = await tx.query("select 1 from rate_changes where change_id = $1 and undone_by is not null limit 1", [target.change_id]);
    if (done.rowCount) throw new Error("Nothing to undo: your last change is already undone");
    const later = await tx.query(
      `select 1 from rate_changes c join rate_changes l
         on l.rate_plan_id = c.rate_plan_id and l.room_type_id = c.room_type_id and l.date = c.date and l.field = c.field
       where c.change_id = $1 and l.change_id <> $1 and l.at > c.at and l.undone_by is null limit 1`,
      [target.change_id],
    );
    if (later.rowCount) throw new Error("These cells were changed again since; undo is no longer possible");

    const { rows } = await tx.query<{ rate_plan_id: string; room_type_id: string; date: string; field: string; old_value: string | null; new_value: string | null }>(
      "select rate_plan_id, room_type_id, to_char(date, 'YYYY-MM-DD') as date, field, old_value, new_value from rate_changes where change_id = $1",
      [target.change_id],
    );
    const undoId = randomUUID();
    for (const r of rows) {
      if (r.field === "price") {
        if (r.old_value === null) await tx.query("delete from rates where rate_plan_id = $1 and room_type_id = $2 and date = $3", [r.rate_plan_id, r.room_type_id, r.date]);
        else
          await tx.query(
            `insert into rates (rate_plan_id, room_type_id, date, price) values ($1, $2, $3, $4)
             on conflict (rate_plan_id, room_type_id, date) do update set price = excluded.price`,
            [r.rate_plan_id, r.room_type_id, r.date, r.old_value],
          );
      } else {
        const col = RESTRICTION_COLUMNS[r.field];
        if (!col) throw new Error(`Unknown field ${r.field}`);
        const fallback = col.type === "boolean" ? "false" : null;
        // the column name comes from the fixed map above, never from input
        await tx.query(`update restrictions set ${col.column} = $4::${col.type === "boolean" ? "boolean" : "integer"} where rate_plan_id = $1 and room_type_id = $2 and date = $3`, [
          r.rate_plan_id,
          r.room_type_id,
          r.date,
          r.old_value ?? fallback,
        ]);
      }
      await tx.query(
        `insert into rate_changes (change_id, property_id, user_id, rate_plan_id, room_type_id, date, field, old_value, new_value, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'undo')`,
        [undoId, propertyId, userId, r.rate_plan_id, r.room_type_id, r.date, r.field, r.new_value, r.old_value],
      );
    }
    await tx.query("update rate_changes set undone_by = $2 where change_id = $1", [target.change_id, undoId]);
    return { changeId: undoId, cells: rows.length };
  });
}

export interface BelowFloor {
  ratePlanId: string;
  ratePlanCode: string;
  roomTypeId: string;
  roomTypeCode: string;
  date: string;
  price: number;
  priceFloor: number;
}

/** Stored prices (base and derived) below their room type's Price Floor from a date on, for the Property Manager. */
export async function listBelowFloor(pool: Pool, schema: string, propertyId: string, from: string, limit = 200): Promise<BelowFloor[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ rate_plan_id: string; plan_code: string; room_type_id: string; type_code: string; date: string; price: string; price_floor: string }>(
      `select r.rate_plan_id, p.code as plan_code, r.room_type_id, t.code as type_code, to_char(r.date, 'YYYY-MM-DD') as date, r.price, t.price_floor
       from rates r join rate_plans p on p.id = r.rate_plan_id join room_types t on t.id = r.room_type_id
       where p.property_id = $1 and t.price_floor is not null and r.price < t.price_floor and r.date >= $2
       order by r.date, p.sort_order, p.code, t.sort_order limit $3`,
      [propertyId, checkDate(from), limit],
    );
    return rows.map((r) => ({ ratePlanId: r.rate_plan_id, ratePlanCode: r.plan_code, roomTypeId: r.room_type_id, roomTypeCode: r.type_code, date: r.date, price: Number(r.price), priceFloor: Number(r.price_floor) }));
  });
}

export interface PriceEnd {
  ratePlanId: string;
  ratePlanCode: string;
  ratePlanName: string;
  roomTypeId: string;
  roomTypeCode: string;
  /** Last date with a price, or null when the row has none. */
  lastDate: string | null;
}

/** Active base rows whose prices end before the horizon date (prices are kept 500 days ahead). */
export async function listPriceEnds(pool: Pool, schema: string, propertyId: string, horizon: string): Promise<PriceEnd[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ rate_plan_id: string; code: string; name: string; room_type_id: string; type_code: string; last_date: string | null }>(
      `select p.id as rate_plan_id, p.code, p.name, rt.room_type_id, t.code as type_code,
         (select to_char(max(r.date), 'YYYY-MM-DD') from rates r where r.rate_plan_id = p.id and r.room_type_id = rt.room_type_id) as last_date
       from rate_plans p join rate_plan_room_types rt on rt.rate_plan_id = p.id join room_types t on t.id = rt.room_type_id
       where p.property_id = $1 and p.kind = 'base' and p.active
       order by p.sort_order, p.code, t.sort_order, t.code`,
      [propertyId],
    );
    const end = checkDate(horizon);
    return rows
      .filter((r) => r.last_date === null || r.last_date < end)
      .map((r) => ({ ratePlanId: r.rate_plan_id, ratePlanCode: r.code, ratePlanName: r.name, roomTypeId: r.room_type_id, roomTypeCode: r.type_code, lastDate: r.last_date }));
  });
}
