/**
 * The phone view for floor staff (ticket 35, decided in "Housekeeper and
 * maintenance phone view prototype"): the day's rooms by Section, a room
 * sheet, changes made offline and sent later, ten languages.
 */

/** Phone languages shipped at launch, a setting per user. "hr" stands for Croatian, Serbian and Bosnian (Latin). */
export const FLOOR_LANGUAGES = ["de", "en", "pl", "ro", "bg", "hr", "hu", "tr", "uk", "ar"] as const;
export type FloorLanguage = (typeof FLOOR_LANGUAGES)[number];

export function isFloorLanguage(value: string): value is FloorLanguage {
  return (FLOOR_LANGUAGES as readonly string[]).includes(value);
}

export function isRtl(language: FloorLanguage): boolean {
  return language === "ar";
}

/** The property's fixed list of Housekeeping Notes, each with an icon, shown in the phone's language. */
export const HOUSEKEEPING_NOTE_CODES = ["feather_allergy", "baby_cot", "extra_bed", "welcome_gift", "late_checkout", "pet", "accessibility"] as const;
export type HousekeepingNoteCode = (typeof HOUSEKEEPING_NOTE_CODES)[number];

/** Quick picks after the photo. */
export const PROBLEM_PICKS = ["plumbing", "electrical", "heating", "furniture", "door", "other"] as const;
export type ProblemPick = (typeof PROBLEM_PICKS)[number];
export const LOST_PICKS = ["clothing", "electronics", "documents", "valuables", "other"] as const;
export type LostPick = (typeof LOST_PICKS)[number];

/** How soon a Maintenance Issue needs fixing; the queue is sorted by it. */
export const URGENCIES = ["now", "today", "later"] as const;
export type Urgency = (typeof URGENCIES)[number];

interface Listed {
  roomNumber: string;
  section: string | null;
  priority: boolean;
  changed: boolean;
}

/** Rooms grouped by Section (rooms without one last); inside a group priority first, then changed, then by room number. */
export function floorSections<T extends Listed>(tasks: T[]): { section: string | null; tasks: T[] }[] {
  const bySection = new Map<string | null, T[]>();
  for (const t of tasks) bySection.set(t.section, [...(bySection.get(t.section) ?? []), t]);
  const rank = (t: T) => (t.priority ? 0 : t.changed ? 1 : 2);
  const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return [...bySection.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : byNumber(a, b)))
    .map(([section, list]) => ({ section, tasks: [...list].sort((a, b) => rank(a) - rank(b) || byNumber(a.roomNumber, b.roomNumber)) }));
}

/** A change made on the phone, possibly offline, sent later. `id` makes sending it twice harmless. */
export type PhoneOp = { id: string; at: string } & (
  | { kind: "task"; taskId: string; step: "start" | "done" | "undo" | "declined" | "dnd"; seen: number }
  | { kind: "minibar"; roomId: string; items: { serviceId: string; quantity: number }[] }
  | { kind: "problem"; roomId: string; pick: ProblemPick; urgency: Urgency; note: string; photo?: string | undefined; photoFileId?: string | undefined }
  | { kind: "lost"; roomId: string; pick: LostPick; note: string; photo?: string | undefined }
  | { kind: "issue"; issueId: string; step: "take" | "fixed"; note: string; endBlock?: boolean | undefined; photo?: string | undefined; photoFileId?: string | undefined }
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STEPS = ["start", "done", "undo", "declined", "dnd"] as const;
/** A photo as a data URL of a JPEG or PNG, at most about 1.5 MB (the phone shrinks it to a few hundred KB). */
const PHOTO = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw new Error(`Unknown ${what}`);
  return v as T;
}
function uuid(v: unknown, what: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`Bad ${what}`);
  return v;
}
function text(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 500) : "";
}
function photo(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > 2_000_000 || !PHOTO.test(v)) throw new Error("Bad photo");
  return v;
}

/** Check a change sent by a phone; throws on anything malformed. */
export function parsePhoneOp(raw: unknown): PhoneOp {
  if (!raw || typeof raw !== "object") throw new Error("Bad change");
  const o = raw as Record<string, unknown>;
  const id = uuid(o.id, "change id");
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) throw new Error("Bad time");
  const at = new Date(o.at).toISOString();
  switch (o.kind) {
    case "task": {
      if (!Number.isInteger(o.seen) || (o.seen as number) < 0) throw new Error("Bad version");
      return { id, at, kind: "task", taskId: uuid(o.taskId, "task"), step: oneOf(TASK_STEPS, o.step, "step"), seen: o.seen as number };
    }
    case "minibar": {
      if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > 30) throw new Error("Bad minibar items");
      const items = o.items.map((i: { serviceId?: unknown; quantity?: unknown }) => {
        if (!Number.isInteger(i?.quantity) || (i.quantity as number) < 1 || (i.quantity as number) > 50) throw new Error("Bad quantity");
        return { serviceId: uuid(i.serviceId, "item"), quantity: i.quantity as number };
      });
      return { id, at, kind: "minibar", roomId: uuid(o.roomId, "room"), items };
    }
    case "problem":
      return { id, at, kind: "problem", roomId: uuid(o.roomId, "room"), pick: oneOf(PROBLEM_PICKS, o.pick, "problem"), urgency: oneOf(URGENCIES, o.urgency, "urgency"), note: text(o.note), photo: photo(o.photo) };
    case "lost":
      return { id, at, kind: "lost", roomId: uuid(o.roomId, "room"), pick: oneOf(LOST_PICKS, o.pick, "item"), note: text(o.note), photo: photo(o.photo) };
    case "issue":
      // a stored file is attached by the server from the photo, never named by the phone
      return { id, at, kind: "issue", issueId: uuid(o.issueId, "issue"), step: oneOf(["take", "fixed"] as const, o.step, "step"), note: text(o.note), endBlock: o.endBlock === true, photo: photo(o.photo) };
    default:
      throw new Error("Unknown change");
  }
}
