import { roundMoney } from "./money";
import { addDays } from "./rates-grid";

/**
 * Budget and Forecast (ticket 83, "Reporting scope"): monthly figures per
 * property and year, spread over the days by last year's weekday pattern so
 * any report period can be compared with them.
 */
export const BUDGET_VERSIONS = ["budget", "forecast"] as const;
export type BudgetVersion = (typeof BUDGET_VERSIONS)[number];

export interface BudgetMonth {
  /** 1–12. */
  month: number;
  /** Percent. */
  occupancy: number;
  adr: number;
  netRoomRevenue: number;
  totalRevenue: number;
}

/** A budget day: the month's figures spread by weight. */
export interface BudgetDay {
  date: string;
  occupiedRooms: number;
  netRoomRevenue: number;
  totalRevenue: number;
}

export function daysOfMonth(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => addDays(first, i));
}

/** Monday 0 … Sunday 6. */
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * Last year's weekday pattern: the average of a figure per weekday, as
 * weights (1 = the average day). Without history every day weighs the same.
 */
export function weekdayWeights(lastYear: { date: string; value: number }[]): number[] {
  const sums = Array(7).fill(0) as number[];
  const counts = Array(7).fill(0) as number[];
  for (const d of lastYear) {
    const w = weekday(d.date);
    sums[w] = sums[w]! + d.value;
    counts[w] = counts[w]! + 1;
  }
  const avg = sums.map((s, i) => (counts[i] ? s / counts[i]! : 0));
  const mean = avg.reduce((a, b) => a + b, 0) / 7;
  if (!(mean > 0) || avg.some((a, i) => counts[i] === 0)) return Array(7).fill(1) as number[];
  return avg.map((a) => a / mean);
}

/** Split an amount over days by weight; cent rounding left on the last day so the days add up to the amount exactly. */
function split(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => roundMoney((amount * w) / total));
  const diff = roundMoney(amount - parts.reduce((a, b) => a + b, 0));
  parts[parts.length - 1] = roundMoney(parts[parts.length - 1]! + diff);
  return parts;
}

/**
 * The month's budget over its days. Room nights planned are occupancy ×
 * Available Rooms of the month; they and both revenues follow the weekday
 * weights and add up to the month.
 */
export function spreadMonth(year: number, m: BudgetMonth, availableByDate: Record<string, number>, weights: number[]): BudgetDay[] {
  const days = daysOfMonth(year, m.month);
  const w = days.map((d) => weights[weekday(d)] ?? 1);
  const available = days.reduce((s, d) => s + (availableByDate[d] ?? 0), 0);
  const roomNights = Math.round((m.occupancy / 100) * available);
  // whole room nights: largest remainders take the rest
  const exact = w.map((x) => (roomNights * x) / w.reduce((a, b) => a + b, 0));
  const floors = exact.map(Math.floor);
  let rest = roomNights - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (rest-- > 0) floors[i]! += 1;
  const nrr = split(m.netRoomRevenue, w);
  const total = split(m.totalRevenue, w);
  return days.map((date, i) => ({ date, occupiedRooms: floors[i]!, netRoomRevenue: nrr[i]!, totalRevenue: total[i]! }));
}

export interface BudgetImport {
  months: BudgetMonth[];
  errors: string[];
}

/**
 * A budget from a spreadsheet file: one line per month of the year, with
 * month (YYYY-MM), occupancy %, Average Daily Rate, Net Room Revenue and
 * total revenue; semicolon or comma separated, a header line allowed,
 * decimals with point or comma. Every problem is named by its line.
 */
export function parseBudgetCsv(text: string, year: number): BudgetImport {
  const errors: string[] = [];
  const months = new Map<number, BudgetMonth>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = lines.some((l) => l.includes(";")) ? ";" : ",";
  const num = (s: string | undefined) => {
    const t = (s ?? "").trim().replace(/\s/g, "");
    if (!t) return NaN;
    // with ";" as separator a comma is the decimal mark
    return Number(sep === ";" ? t.replace(/\./g, (_m, off, str) => (str.includes(",") ? "" : ".")).replace(",", ".") : t);
  };
  lines.forEach((line, i) => {
    const cells = line.split(sep);
    if (i === 0 && !/^\d{4}-\d{2}$/.test(cells[0]!.trim())) return; // header
    const at = `line ${i + 1}`;
    const m = /^(\d{4})-(\d{2})$/.exec(cells[0]!.trim());
    if (!m) return void errors.push(`${at}: month as YYYY-MM`);
    if (Number(m[1]) !== year) return void errors.push(`${at}: ${cells[0]} is not in ${year}`);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return void errors.push(`${at}: no month ${m[2]}`);
    if (months.has(month)) return void errors.push(`${at}: ${cells[0]} twice`);
    const [occupancy, adr, nrr, total] = [num(cells[1]), num(cells[2]), num(cells[3]), num(cells[4])];
    if (!(occupancy >= 0 && occupancy <= 100)) return void errors.push(`${at}: occupancy between 0 and 100`);
    if (!(adr >= 0) || !(nrr >= 0) || !(total >= 0)) return void errors.push(`${at}: figures as numbers, not negative`);
    if (total < nrr) return void errors.push(`${at}: total revenue below Net Room Revenue`);
    months.set(month, { month, occupancy, adr, netRoomRevenue: nrr, totalRevenue: total });
  });
  if (!errors.length && months.size === 0) errors.push("no months found");
  return { months: [...months.values()].sort((a, b) => a.month - b.month), errors };
}
