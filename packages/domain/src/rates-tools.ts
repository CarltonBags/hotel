/**
 * Tools of the Rates grid (ticket 19, decided in "Rates grid screen
 * prototype"): paste from a spreadsheet, copy a period by weekday, fill
 * prices to the horizon. Like the bulk planner they run in the browser for
 * the preview and on the server for Apply.
 */
import { roundMoney } from "./money";
import { OPEN_RESTRICTION, RESTRICTION_FIELDS, type Restriction } from "./rates";
import { addDays, weekdayIndex, type GridRow, type GridState } from "./rates-grid";

export interface ToolPlan {
  prices: { ratePlanId: string; roomTypeId: string; date: string; price: number }[];
  restrictions: { ratePlanId: string; roomTypeId: string; date: string; patch: Partial<Restriction> }[];
  preview: { cells: number; rows: number; belowFloor: number };
}

const MAX_PASTE_CELLS = 5000;

/** A number as typed in a spreadsheet: "1.234,50", "1,234.50", "99,9" or "120". */
function amount(text: string): number | null {
  const t = text.replace(/[\s€$£]|CHF/g, "");
  if (!t) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  const decimal = lastComma > lastDot ? "," : ".";
  const normal = decimal === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return NaN;
  return Number(normal);
}

/** Rows of cells copied from a spreadsheet (tab separated, or semicolons); empty cells are null. */
export function parsePaste(text: string): (number | null)[][] {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ";";
  const out = lines.map((line, i) =>
    line.split(sep).map((cell, j) => {
      const n = amount(cell);
      if (n !== null && (Number.isNaN(n) || n < 0)) throw new Error(`Not a price at row ${i + 1}, column ${j + 1}: "${cell.trim()}"`);
      return n === null ? null : roundMoney(n);
    }),
  );
  if (out.reduce((s, r) => s + r.length, 0) > MAX_PASTE_CELLS) throw new Error(`Paste at most ${MAX_PASTE_CELLS} cells at once`);
  return out;
}

function summarise(prices: ToolPlan["prices"], restrictions: ToolPlan["restrictions"], floors: Map<string, number | null>): ToolPlan["preview"] {
  const cells = new Set([...prices, ...restrictions].map((c) => `${c.ratePlanId}|${c.roomTypeId}|${c.date}`));
  const rows = new Set([...prices, ...restrictions].map((c) => `${c.ratePlanId}|${c.roomTypeId}`));
  const belowFloor = prices.filter((p) => {
    const f = floors.get(`${p.ratePlanId}|${p.roomTypeId}`);
    return f !== null && f !== undefined && p.price < f;
  }).length;
  return { cells: cells.size, rows: rows.size, belowFloor };
}

const floorsOf = (rows: GridRow[]) => new Map(rows.map((r) => [`${r.ratePlanId}|${r.roomTypeId}`, r.priceFloor]));

/**
 * A pasted block placed from the focused cell: block row i on grid row
 * anchor + i, column j on anchorDate + j. Derived rows follow their base,
 * so their pasted values are skipped (and counted); so are cells below the
 * last row.
 */
export function planPaste(block: (number | null)[][], rows: GridRow[], anchor: number, anchorDate: string, state: GridState): ToolPlan & { preview: { skippedDerived: number; outside: number } } {
  const prices: ToolPlan["prices"] = [];
  let skippedDerived = 0;
  let outside = 0;
  block.forEach((values, i) => {
    const r = rows[anchor + i];
    const given = values.filter((v) => v !== null).length;
    if (!r) return void (outside += given);
    if (r.basePlanId) return void (skippedDerived += given);
    values.forEach((v, j) => {
      if (v === null) return;
      const date = addDays(anchorDate, j);
      if (state.price(r.ratePlanId, r.roomTypeId, date) === v) return;
      prices.push({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId, date, price: v });
    });
  });
  return { prices, restrictions: [], preview: { ...summarise(prices, [], floorsOf(rows)), skippedDerived, outside } };
}

/**
 * The source date a target date copies from: the same weekday in the
 * matching week of the source range. Null when the source range has no such
 * weekday (shorter than a week).
 */
export function copySourceDate(source: { from: string; to: string }, targetFrom: string, target: string): string | null {
  const offset = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${targetFrom}T00:00:00Z`)) / 86_400_000);
  let s = addDays(source.from, offset);
  const shift = ((weekdayIndex(target) - weekdayIndex(s) + 10) % 7) - 3;
  s = addDays(s, shift);
  if (s < source.from) s = addDays(s, 7);
  if (s > source.to) s = addDays(s, -7);
  return s >= source.from && s <= source.to ? s : null;
}

/** Prices (base rows) and the restrictions stored on each row, from one range to another of the same length, by weekday. */
export function planCopyPeriod(input: { rows: GridRow[]; source: { from: string; to: string }; targetFrom: string }, state: GridState): ToolPlan {
  const { source, targetFrom } = input;
  if (source.to < source.from) throw new Error("The source range ends before it starts");
  const days = Math.round((Date.parse(`${source.to}T00:00:00Z`) - Date.parse(`${source.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 400) throw new Error("Copy at most 400 days at once");
  const prices: ToolPlan["prices"] = [];
  const restrictions: ToolPlan["restrictions"] = [];
  for (let k = 0; k < days; k++) {
    const t = addDays(targetFrom, k);
    const s = copySourceDate(source, targetFrom, t);
    if (!s || (t >= source.from && t <= source.to)) continue;
    for (const r of input.rows) {
      if (!r.basePlanId) {
        const p = state.price(r.ratePlanId, r.roomTypeId, s);
        if (p !== null && p !== state.price(r.ratePlanId, r.roomTypeId, t)) prices.push({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId, date: t, price: p });
      }
      const from = state.restriction(r.ratePlanId, r.roomTypeId, s);
      const to = state.restriction(r.ratePlanId, r.roomTypeId, t);
      if (RESTRICTION_FIELDS.some((f) => from[f] !== to[f])) restrictions.push({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId, date: t, patch: { ...OPEN_RESTRICTION, ...from } });
    }
  }
  return { prices, restrictions, preview: summarise(prices, restrictions, floorsOf(input.rows)) };
}

export type FillMode = { kind: "repeat_week" } | { kind: "base"; price: number; weekendFactor: number };

/** Friday and Saturday nights. */
const WEEKEND = new Set([4, 5]);

/**
 * Prices from the day after a row's last price (or the Business Date) up to
 * the horizon: repeating its last full week by weekday, or a base price with
 * Friday and Saturday raised by the weekend factor. A row without a full
 * last week cannot repeat it and is listed as skipped.
 */
export function planFill(input: { rows: { ratePlanId: string; roomTypeId: string; lastDate: string | null; priceFloor?: number | null }[]; from: string; horizon: string; mode: FillMode }, state: GridState): ToolPlan & { skipped: { ratePlanId: string; roomTypeId: string }[] } {
  const { mode } = input;
  if (mode.kind === "base" && (!(mode.price >= 0) || !(mode.weekendFactor > 0))) throw new Error("Give a base price and a weekend factor");
  const prices: ToolPlan["prices"] = [];
  const skipped: { ratePlanId: string; roomTypeId: string }[] = [];
  for (const r of input.rows) {
    const start = r.lastDate && r.lastDate >= input.from ? addDays(r.lastDate, 1) : input.from;
    if (start > input.horizon) continue;
    let week: number[] | null = null;
    if (mode.kind === "repeat_week") {
      const last = r.lastDate;
      // the seven days ending on the last price, by weekday
      const days = last ? Array.from({ length: 7 }, (_, i) => addDays(last, i - 6)) : [];
      const values = days.map((d) => state.price(r.ratePlanId, r.roomTypeId, d));
      if (!last || values.some((v) => v === null)) {
        skipped.push({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId });
        continue;
      }
      week = Array(7) as number[];
      days.forEach((d, i) => (week![weekdayIndex(d)] = values[i]!));
    }
    for (let d = start; d <= input.horizon; d = addDays(d, 1)) {
      const price = week ? week[weekdayIndex(d)]! : roundMoney(mode.kind === "base" ? (WEEKEND.has(weekdayIndex(d)) ? mode.price * mode.weekendFactor : mode.price) : 0);
      prices.push({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId, date: d, price });
    }
  }
  const floors = new Map(input.rows.map((r) => [`${r.ratePlanId}|${r.roomTypeId}`, r.priceFloor ?? null]));
  return { prices, restrictions: [], preview: summarise(prices, [], floors), skipped };
}
