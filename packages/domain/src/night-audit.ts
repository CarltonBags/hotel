/**
 * Night Audit and Business Date (ticket 32, decided in "Night audit and
 * business date"): each property is on its own Business Date, advanced only
 * by its Night Audit. Staff start the audit inside the property's window
 * (default from 22:00 on the Business Date); after the deadline on the next
 * morning (default 06:00) it is overdue.
 */
import { addDays } from "./rates-grid";
import { zonedInstant } from "./reservation-edit";

export interface AuditClock {
  businessDate: string;
  timeZone: string;
  /** Local time the audit may start on the Business Date, "HH:MM". */
  windowFrom: string;
  /** Local time on the next day after which the audit is overdue, "HH:MM". */
  deadline: string;
}

/** The audit of the Business Date may start: its window has opened (a day behind always may). */
export function auditOpen(c: AuditClock, now: Date): boolean {
  return now.getTime() >= zonedInstant(c.businessDate, c.windowFrom, c.timeZone).getTime();
}

/** The audit of the Business Date is past its deadline. */
export function auditOverdue(c: AuditClock, now: Date): boolean {
  return now.getTime() >= zonedInstant(addDays(c.businessDate, 1), c.deadline, c.timeZone).getTime();
}

/** Whole days the Business Date lags the calendar date (0 on the evening of the day itself). */
export function daysBehind(businessDate: string, calendarDate: string): number {
  return Math.max(0, Math.round((Date.parse(`${calendarDate}T00:00:00Z`) - Date.parse(`${businessDate}T00:00:00Z`)) / 86_400_000));
}

/** A missing arrival's decision at the audit. */
export type ArrivalDecision = { kind: "no_show"; fee: "confirm" | "waive"; waiveReason?: string } | { kind: "late_arrival" };

/** Which missing arrivals still lack a decision (a waived fee needs its reason). */
export function undecidedArrivals(missing: string[], decisions: Record<string, ArrivalDecision | undefined>): string[] {
  return missing.filter((id) => {
    const d = decisions[id];
    if (!d) return true;
    return d.kind === "no_show" && d.fee === "waive" && !d.waiveReason?.trim();
  });
}
