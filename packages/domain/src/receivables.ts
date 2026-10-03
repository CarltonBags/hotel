/**
 * Receivables (ticket 29): invoices issued unpaid to an on-account Bill-to,
 * their ageing, and reminder letters at levels 1 to 3.
 */
import { roundMoney } from "./money";

export const AGEING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Whole days past the due date; 0 until the day after it. */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000));
}

export function bucketOf(days: number): AgeingBucket {
  return days <= 0 ? "current" : days <= 30 ? "1_30" : days <= 60 ? "31_60" : days <= 90 ? "61_90" : "over_90";
}

/** Open amounts by how long they are overdue; the buckets add up to the total. */
export function ageing(rows: { open: number; dueDate: string }[], today: string): Record<AgeingBucket, number> & { total: number } {
  const out = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0, total: 0 };
  for (const r of rows) {
    const b = bucketOf(daysOverdue(r.dueDate, today));
    out[b] = roundMoney(out[b] + r.open);
    out.total = roundMoney(out.total + r.open);
  }
  return out;
}

export const REMINDER_LEVELS = [1, 2, 3] as const;
export type ReminderLevel = (typeof REMINDER_LEVELS)[number];

/** The next reminder for an invoice: one level above the last sent, none after level 3. */
export function nextReminderLevel(sent: number[]): ReminderLevel | null {
  const last = Math.max(0, ...sent);
  return last >= 3 ? null : ((last + 1) as ReminderLevel);
}
