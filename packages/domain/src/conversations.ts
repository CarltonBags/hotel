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

/**
 * Replies by email (ticket 43): guest messages carry a reply address of
 * their Conversation, `<tenant slug>.<token>@<inbound domain>`; the token is
 * random per Conversation, so the address cannot be guessed from another.
 */
export function replyAddress(slug: string, token: string, domain: string): string {
  return `${slug}.${token}@${domain}`;
}

/** The tenant, token and domain of a reply address (also inside "Name <address>"); null for any other address. */
export function parseReplyAddress(address: string): { slug: string; token: string; domain: string } | null {
  const m = /(?:^|[<\s"])([a-z0-9-]+)\.([0-9a-f]{20,64})@([a-z0-9.-]+)(?:$|[>\s"])/i.exec(address.trim());
  return m ? { slug: m[1]!.toLowerCase(), token: m[2]!.toLowerCase(), domain: m[3]!.toLowerCase() } : null;
}

const AUTO_SUBJECT = /^\s*(out of (the )?office|automatic reply|auto(matische)?[ -]?(reply|antwort)|autoreply|abwesenheit(snotiz)?|absence|vacation|urlaub|r[ée]ponse automatique|absent)\b/i;

/** An automatic answer (out of office and the like): kept, never counted as a guest message. Headers by lower-case name. */
export function isAutoReply(headers: Record<string, string>, subject: string): boolean {
  const submitted = headers["auto-submitted"]?.trim().toLowerCase();
  if (submitted && submitted !== "no") return true;
  if (headers["x-autoreply"] || headers["x-autorespond"]) return true;
  if (["bulk", "auto_reply", "junk", "list"].includes(headers["precedence"]?.trim().toLowerCase() ?? "")) return true;
  return AUTO_SUBJECT.test(subject);
}

/** Conversations and their files go a number of months after the stay ended (12, a property may shorten it); one kept for a dispute stays. */
export function conversationExpired(stayEnd: string, months: number, today: string, disputed: boolean): boolean {
  if (disputed) return false;
  const d = new Date(`${stayEnd}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return today > d.toISOString().slice(0, 10);
}
