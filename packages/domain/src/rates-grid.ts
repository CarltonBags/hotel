/**
 * The Rates grid's bulk edit planner ("Rates grid screen prototype").
 * The same function runs in the browser for the preview and on the server
 * for Apply, so the preview's counts are the cells Apply changes.
 */
import { roundMoney } from "./money";
import { derivedPrice, type Derivation, type Restriction, type RestrictionField, type RestrictionInheritance } from "./rates";

export interface GridRow {
  ratePlanId: string;
  roomTypeId: string;
  /** Set for a row of a derived plan. */
  basePlanId: string | null;
  derivation: Derivation | null;
  inherits: RestrictionInheritance | null;
  priceFloor: number | null;
}

export interface GridState {
  /** Stored price of a base cell, or null. */
  price(ratePlanId: string, roomTypeId: string, date: string): number | null;
  /** Restriction stored on this plan's cell (not the effective one). */
  restriction(ratePlanId: string, roomTypeId: string, date: string): Restriction;
}

export const PRICE_ACTIONS = ["keep", "set", "amount", "percent"] as const;
export type PriceAction = (typeof PRICE_ACTIONS)[number];

export interface BulkEdit {
  rows: { ratePlanId: string; roomTypeId: string }[];
  from: string;
  to: string;
  /** Monday first. */
  weekdays: boolean[];
  price: { action: PriceAction; value: number };
  /** Booleans switch on or off; stays take a number of nights, null removes. */
  restriction: { field: RestrictionField; value: boolean | number | null } | null;
}

export interface BulkPreview {
  /** Distinct cells whose price or restriction changes. */
  cells: number;
  /** Rows (plan by room type) with at least one changed cell. */
  rows: number;
  min: number | null;
  max: number | null;
  /** Derived rows that follow a changed base row. */
  derivedFollowing: number;
  /** Selected derived rows whose prices change through their base. */
  derivedSelected: number;
  /** Changed or following prices below the room type's Price Floor. */
  belowFloor: number;
  minAboveMax: number;
  /** Prices that would fall below zero; Apply is refused while any exist. */
  negative: number;
}

export interface BulkPlan {
  prices: { ratePlanId: string; roomTypeId: string; date: string; price: number }[];
  restrictions: { ratePlanId: string; roomTypeId: string; date: string; patch: Partial<Restriction> }[];
  preview: BulkPreview;
}

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesFrom(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/** Key of a grid row (plan by room type) or, with a date, of one cell. */
export function cellKey(ratePlanId: string, roomTypeId: string, date?: string): string {
  return date === undefined ? `${ratePlanId}|${roomTypeId}` : `${ratePlanId}|${roomTypeId}|${date}`;
}
const key = cellKey;

function nextPrice(old: number | null, action: PriceAction, value: number): number | null {
  if (action === "set") return roundMoney(value);
  if (old === null || action === "keep") return old;
  return roundMoney(action === "amount" ? old + value : old * (1 + value / 100));
}

export function planBulkEdit(edit: BulkEdit, rows: GridRow[], state: GridState): BulkPlan {
  const byKey = new Map(rows.map((r) => [key(r.ratePlanId, r.roomTypeId), r]));
  const from = edit.from <= edit.to ? edit.from : edit.to;
  const to = edit.from <= edit.to ? edit.to : edit.from;
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (edit.weekdays[weekdayIndex(d)]) dates.push(d);

  const selected = edit.rows.map((r) => byKey.get(key(r.ratePlanId, r.roomTypeId))).filter((r): r is GridRow => Boolean(r));
  const baseOf = (r: GridRow) => (r.basePlanId ? byKey.get(key(r.basePlanId, r.roomTypeId)) : r);

  const prices: BulkPlan["prices"] = [];
  const changedCells = new Set<string>();
  const changedBaseRows = new Set<string>();
  const changedRows = new Set<string>();
  let negative = 0;
  let belowFloor = 0;
  const newPrices: number[] = [];

  if (edit.price.action !== "keep") {
    const baseRows = new Map<string, GridRow>();
    for (const r of selected) {
      const b = baseOf(r);
      if (b) baseRows.set(key(b.ratePlanId, b.roomTypeId), b);
    }
    for (const b of baseRows.values()) {
      for (const d of dates) {
        const old = state.price(b.ratePlanId, b.roomTypeId, d);
        const next = nextPrice(old, edit.price.action, edit.price.value);
        if (next === null || next === old) continue;
        if (next < 0) {
          negative++;
          continue;
        }
        prices.push({ ratePlanId: b.ratePlanId, roomTypeId: b.roomTypeId, date: d, price: next });
        changedCells.add(key(b.ratePlanId, b.roomTypeId, d));
        changedBaseRows.add(key(b.ratePlanId, b.roomTypeId));
        newPrices.push(next);
        if (b.priceFloor !== null && next < b.priceFloor) belowFloor++;
      }
    }
  }

  // derived rows follow changed base rows
  let derivedFollowing = 0;
  for (const r of rows) {
    if (!r.basePlanId || !r.derivation || !changedBaseRows.has(key(r.basePlanId, r.roomTypeId))) continue;
    derivedFollowing++;
    for (const c of prices) {
      if (c.ratePlanId !== r.basePlanId || c.roomTypeId !== r.roomTypeId) continue;
      if (r.priceFloor !== null && derivedPrice(c.price, r.derivation) < r.priceFloor) belowFloor++;
    }
  }

  const restrictions: BulkPlan["restrictions"] = [];
  let minAboveMax = 0;
  if (edit.restriction) {
    const { field, value } = edit.restriction;
    // write where the field lives: the base when a derived row inherits it, else the row itself
    const targets = new Map<string, GridRow>();
    for (const r of selected) {
      const t = r.basePlanId && r.inherits?.[field] ? baseOf(r) : r;
      if (t) targets.set(key(t.ratePlanId, t.roomTypeId), t);
    }
    for (const t of targets.values()) {
      for (const d of dates) {
        const cur = state.restriction(t.ratePlanId, t.roomTypeId, d);
        if (cur[field] === value) continue;
        const next = { ...cur, [field]: value } as Restriction;
        restrictions.push({ ratePlanId: t.ratePlanId, roomTypeId: t.roomTypeId, date: d, patch: { [field]: value } });
        changedCells.add(key(t.ratePlanId, t.roomTypeId, d));
        changedRows.add(key(t.ratePlanId, t.roomTypeId));
        const longestMin = Math.max(next.minStayArrival ?? 0, next.minStayThrough ?? 0);
        if (next.maxStay !== null && longestMin > next.maxStay) minAboveMax++;
      }
    }
  }

  return {
    prices,
    restrictions,
    preview: {
      cells: changedCells.size,
      rows: new Set([...changedRows, ...changedBaseRows]).size,
      min: newPrices.length ? Math.min(...newPrices) : null,
      max: newPrices.length ? Math.max(...newPrices) : null,
      derivedFollowing,
      derivedSelected: selected.filter((r) => r.basePlanId && changedBaseRows.has(key(r.basePlanId, r.roomTypeId))).length,
      belowFloor,
      minAboveMax,
      negative,
    },
  };
}
