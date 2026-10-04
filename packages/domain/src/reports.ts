import { roundMoney } from "./money";
import { addDays, daysBetween } from "./rates-grid";
import type { PropertyAction } from "./permissions";

/**
 * Fixed reports (ticket 82, "Reporting scope"): the figures, their periods and
 * comparisons, and one table shape that the screen, the spreadsheet file and
 * the PDF all render.
 */
export const REPORT_KINDS = ["occupancy", "pickup", "source_mix", "cancellations", "revenue_by_code", "housekeeping", "receivables", "cash"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Who sees which report ("Who sees what"): revenue and occupancy also for Revenue; money for Accounting; housekeeping for its Supervisor. */
export const REPORT_ACCESS: Record<ReportKind, PropertyAction> = {
  occupancy: "view_revenue_reports",
  pickup: "view_revenue_reports",
  source_mix: "view_revenue_reports",
  cancellations: "view_revenue_reports",
  revenue_by_code: "view_financial_reports",
  receivables: "view_financial_reports",
  cash: "view_financial_reports",
  housekeeping: "view_housekeeping_reports",
};

export function isReportKind(s: string): s is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(s);
}

export const GRAINS = ["day", "week", "month"] as const;
export type Grain = (typeof GRAINS)[number];

export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

/** The period a date falls in: the day, the week (from its Monday) or the month. */
export function periodOf(date: string, grain: Grain): string {
  if (grain === "day") return date;
  if (grain === "month") return date.slice(0, 7);
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** Same period last year, weekdays aligned: 52 weeks back. */
export const LAST_YEAR_SHIFT = 364;

/** The period of the same length just before. */
export function previousPeriod(range: { from: string; to: string }): { from: string; to: string; shift: number } {
  const n = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -n), to: addDays(range.to, -n), shift: n };
}

export function lastYearPeriod(range: { from: string; to: string }): { from: string; to: string; shift: number } {
  return { from: addDays(range.from, -LAST_YEAR_SHIFT), to: addDays(range.to, -LAST_YEAR_SHIFT), shift: LAST_YEAR_SHIFT };
}

/** Every date from..to, both included. */
export function datesIn(range: { from: string; to: string }): string[] {
  const n = daysBetween(range.from, range.to) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(range.from, i));
}

// ── Occupancy and revenue ──

/** One night of a property (and room type): what the definitions are computed from. Amounts in the property's currency, net of VAT. */
export interface NightFigures {
  date: string;
  /** Rooms minus those Out of Order that night (Out of Service stays in). */
  available: number;
  /** Rooms sold that night, complimentary and house use included, charged no-shows not. */
  occupied: number;
  netRoomRevenue: number;
  /** No-show and late cancellation fees: their own line, outside Net Room Revenue. */
  fees: number;
  /** All revenue (room, breakfast, extras, fees), City Tax excluded. */
  totalRevenue: number;
}

export interface Kpis {
  available: number;
  occupied: number;
  /** Percent, one decimal; null without Available Rooms. */
  occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  netRoomRevenue: number;
  fees: number;
  totalRevenue: number;
}

export function kpis(nights: NightFigures[]): Kpis {
  const sum = (k: keyof Omit<NightFigures, "date">) => nights.reduce((s, n) => s + n[k], 0);
  const available = sum("available");
  const occupied = sum("occupied");
  const netRoomRevenue = roundMoney(sum("netRoomRevenue"));
  return {
    available,
    occupied,
    occupancy: available ? Math.round((occupied / available) * 1000) / 10 : null,
    adr: occupied ? roundMoney(netRoomRevenue / occupied) : null,
    revpar: available ? roundMoney(netRoomRevenue / available) : null,
    netRoomRevenue,
    fees: roundMoney(sum("fees")),
    totalRevenue: roundMoney(sum("totalRevenue")),
  };
}

export interface OccupancyRow extends Kpis {
  period: string;
  previous?: Kpis;
  lastYear?: Kpis;
}

/**
 * Figures per period; a comparison's nights are moved forward by its shift
 * (period length, or 364 days for last year) so each lands in the period it
 * is compared with.
 */
export function occupancyRows(nights: NightFigures[], grain: Grain, compare: { previous?: { nights: NightFigures[]; shift: number }; lastYear?: { nights: NightFigures[]; shift: number } } = {}): OccupancyRow[] {
  const group = (ns: NightFigures[], shift = 0) => {
    const m = new Map<string, NightFigures[]>();
    for (const n of ns) {
      const p = periodOf(addDays(n.date, shift), grain);
      m.set(p, [...(m.get(p) ?? []), n]);
    }
    return m;
  };
  const own = group(nights);
  const prev = compare.previous ? group(compare.previous.nights, compare.previous.shift) : null;
  const ly = compare.lastYear ? group(compare.lastYear.nights, compare.lastYear.shift) : null;
  return [...own.keys()].sort().map((period) => ({
    period,
    ...kpis(own.get(period)!),
    ...(prev ? { previous: kpis(prev.get(period) ?? []) } : {}),
    ...(ly ? { lastYear: kpis(ly.get(period) ?? []) } : {}),
  }));
}

// ── several properties ──

/** Amounts in another currency are converted at the rate stated on the report: rates[CUR] = units of the report currency per 1 CUR. */
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const r = rates[from];
  if (!r || !(r > 0)) throw new Error(`State the rate for ${from} → ${to}`);
  return roundMoney(amount * r);
}

/** Convert a night's amounts into the report currency. */
export function convertNight(n: NightFigures, from: string, to: string, rates: Record<string, number>): NightFigures {
  return { ...n, netRoomRevenue: convertAmount(n.netRoomRevenue, from, to, rates), fees: convertAmount(n.fees, from, to, rates), totalRevenue: convertAmount(n.totalRevenue, from, to, rates) };
}

// ── scheduling ──

/** Whether a schedule is due at this local date and hour: daily at 06:00, weekly on Monday, monthly on the 1st; never twice on a day. */
export function scheduleDue(frequency: ScheduleFrequency, local: { date: string; hour: number }, lastSentOn: string | null): boolean {
  if (local.hour < 6 || lastSentOn === local.date) return false;
  if (frequency === "daily") return true;
  if (frequency === "weekly") return new Date(`${local.date}T12:00:00Z`).getUTCDay() === 1;
  return local.date.endsWith("-01");
}

/** The period a scheduled report covers: the day, week or month that just ended. */
export function scheduledRange(frequency: ScheduleFrequency, today: string): { from: string; to: string } {
  const yesterday = addDays(today, -1);
  if (frequency === "daily") return { from: yesterday, to: yesterday };
  if (frequency === "weekly") return { from: addDays(today, -7), to: yesterday };
  return { from: `${yesterday.slice(0, 7)}-01`, to: yesterday };
}

// ── the table every report renders as ──

export type CellKind = "text" | "int" | "money" | "percent" | "days";
export interface ReportColumn {
  key: string;
  label: string;
  kind: CellKind;
}
export interface ReportRow {
  cells: Record<string, string | number | null>;
  /** A total or a property's subtotal. */
  emphasis?: boolean;
}
export interface ReportTable {
  title: string;
  /** Period, properties, filters, the base used and any conversion rate: every report states its base. */
  notes: string[];
  columns: ReportColumn[];
  rows: ReportRow[];
}

export function formatCell(v: string | number | null, kind: CellKind, locale: string): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  if (kind === "money") return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "percent") return `${v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  if (kind === "days") return v.toLocaleString(locale, { maximumFractionDigits: 1 });
  return v.toLocaleString(locale);
}
