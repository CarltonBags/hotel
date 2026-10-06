import { addDays } from "./rates-grid";

/**
 * Guest Inbox and Conversations (ticket 42): one Conversation per
 * Reservation (per Booking for the Booker). Waiting time counts only while
 * the desk is staffed (Desk Hours); outside them the guest gets one automatic
 * reply per night and the escalation timer pauses.
 */
export const CONVERSATION_FILE_BYTES = 10 * 1024 * 1024;
export const CONVERSATION_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;

/** Desk Hours in the property's time, "HH:MM"; closing before opening runs past midnight; the same time both means around the clock. */
export interface DeskHours {
  opens: string;
  closes: string;
}

const clocks = new Map<string, Intl.DateTimeFormat>();
function localClock(at: Date, timeZone: string): { date: string; minute: number } {
  let f = clocks.get(timeZone);
  if (!f) clocks.set(timeZone, (f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })));
  const parts = f.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

const minuteOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function staffedAt(minute: number, hours: DeskHours): boolean {
  const o = minuteOf(hours.opens);
  const c = minuteOf(hours.closes);
  if (o === c) return true;
  return o < c ? minute >= o && minute < c : minute >= o || minute < c;
}

export function inDeskHours(at: Date, hours: DeskHours, timeZone: string): boolean {
  return staffedAt(localClock(at, timeZone).minute, hours);
}

/** Whole minutes of Desk Hours between two moments: how long a guest has waited for the desk. Counting stops at `cap`. */
export function deskMinutesBetween(since: Date, now: Date, hours: DeskHours, timeZone: string, cap = 24 * 60): number {
  let n = 0;
  // minute by minute in the property's clock, so daylight-saving changes count right
  for (let t = since.getTime(); t + 60_000 <= now.getTime() && n < cap; t += 60_000) {
    if (inDeskHours(new Date(t), hours, timeZone)) n++;
  }
  return n;
}

/** The night a message came in outside Desk Hours, named by the date the desk opens next; null while staffed. One automatic reply per night. */
export function deskNight(at: Date, hours: DeskHours, timeZone: string): string | null {
  const { date, minute } = localClock(at, timeZone);
  if (staffedAt(minute, hours)) return null;
  return minute < minuteOf(hours.opens) ? date : addDays(date, 1);
}

/** The placeholders a Quick Reply may use. */
export const QUICK_REPLY_PLACEHOLDERS = ["firstName", "lastName", "room", "arrival", "departure", "checkInTime", "checkOutTime", "property"] as const;
export type QuickReplyValues = Partial<Record<(typeof QUICK_REPLY_PLACEHOLDERS)[number], string>>;

/** A Quick Reply with what is known filled in; anything else stays as typed, for staff to complete. */
export function fillQuickReply(text: string, values: QuickReplyValues): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => values[k as keyof QuickReplyValues] ?? all);
}

/** Images and PDFs up to 10 MB, both ways. */
export function isConversationFile(contentType: string, bytes: number): boolean {
  return (CONVERSATION_FILE_TYPES as readonly string[]).includes(contentType) && bytes <= CONVERSATION_FILE_BYTES;
}
