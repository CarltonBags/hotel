import { roundMoney } from "./money";
import { addDays } from "./rates-grid";
import { dayOfWeek } from "./reports";

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
  /** The month's Average Daily Rate as entered. */
  adr: number;
  netRoomRevenue: number;
  totalRevenue: number;
}

export function daysOfMonth(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => addDays(first, i));
}


/**
 * Last year's weekday pattern: the average of a figure per weekday, as
 * weights (1 = the average day). Without history every day weighs the same.
 */
export function weekdayWeights(lastYear: { date: string; value: number }[]): number[] {
  const sums = Array(7).fill(0) as number[];
  const counts = Array(7).fill(0) as number[];
  for (const d of lastYear) {
    const w = dayOfWeek(d.date);
    sums[w] = sums[w]! + d.value;
    counts[w] = counts[w]! + 1;
  }
  const avg = sums.map((s, i) => (counts[i] ? s / counts[i]! : 0));
  const mean = avg.reduce((a, b) => a + b, 0) / 7;
  if (!(mean > 0) || avg.some((a, i) => counts[i] === 0)) return Array(7).fill(1) as number[];
  return avg.map((a) => a / mean);
}

/** Split an amount over days by weight; the cent rounding goes to the heaviest day, so the days add up to the amount exactly and none goes below zero. */
function split(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => roundMoney((amount * w) / total));
  const diff = roundMoney(amount - parts.reduce((a, b) => a + b, 0));
  const heaviest = weights.indexOf(Math.max(...weights));
  parts[heaviest] = roundMoney(parts[heaviest]! + diff);
  return parts;
}

/**
 * The month's budget over its days. Room nights planned are occupancy ×
 * Available Rooms of the month; they and both revenues follow the weekday
 * weights times the day's Available Rooms (a closed or Out of Order day gets
 * none), and add up to the month.
 */
export function spreadMonth(year: number, m: BudgetMonth, availableByDate: Record<string, number>, weights: number[]): BudgetDay[] {
  const days = daysOfMonth(year, m.month);
  const byAvailability = days.map((d) => (weights[dayOfWeek(d)] ?? 1) * (availableByDate[d] ?? 0));
  // with no rooms at all the month's revenue still spreads evenly, so the days add up to it
  const w = byAvailability.some((x) => x > 0) ? byAvailability : days.map(() => 1);
  const available = days.reduce((s, d) => s + (availableByDate[d] ?? 0), 0);
  const roomNights = Math.round((m.occupancy / 100) * available);
  // whole room nights: largest remainders take the rest
  const exact = w.map((x) => (roomNights * x) / w.reduce((a, b) => a + b, 0));
  const floors = exact.map(Math.floor);
  let rest = roomNights - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (rest-- > 0) floors[i] = floors[i]! + 1;
  const nrr = split(m.netRoomRevenue, w);
  const total = split(m.totalRevenue, w);
  return days.map((date, i) => ({ date, occupiedRooms: floors[i]!, adr: m.adr, netRoomRevenue: nrr[i]!, totalRevenue: total[i]! }));
}

export interface BudgetImport {
  months: BudgetMonth[];
  errors: string[];
}

/**
 * A budget from a spreadsheet file (CSV): one line per month of the year,
 * with month (YYYY-MM), occupancy %, Average Daily Rate, Net Room Revenue
 * and total revenue; a header line allowed. Semicolon separated (as German
 * spreadsheets save): decimal comma, thousands with a point. Comma
 * separated: decimal point, no thousands marks. Every problem is named by
 * its line, the first ten shown.
 */
export function parseBudgetCsv(text: string, year: number): BudgetImport {
  const errors: string[] = [];
  const months = new Map<number, BudgetMonth>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // the separator of the first line decides, a stray one elsewhere does not
  const sep = (lines[0] ?? "").includes(";") ? ";" : ",";
  const num = (s: string | undefined) => {
    const t = (s ?? "").trim().replace(/\s/g, "");
    if (!t) return NaN;
    // ";" files: "12.000" and "1.234,56" are twelve thousand and 1234.56
    return Number(sep === ";" ? t.replace(/\.(?=\d{3}(?:,|$))/g, "").replace(",", ".") : t);
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
  return { months: [...months.values()].sort((a, b) => a.month - b.month), errors: errors.length > 10 ? [...errors.slice(0, 10), `… ${errors.length - 10} more`] : errors };
}
