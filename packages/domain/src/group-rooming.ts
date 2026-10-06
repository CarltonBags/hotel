import { roundMoney } from "./money";

/**
 * Rooming lists, keeping a group together and its deposit schedule
 * (ticket 59, "Groups and allotments").
 */

export interface RoomingRow {
  /** The line in the file (1 is the header), for the preview. */
  line: number;
  roomType: string;
  firstName: string;
  lastName: string;
  adults: number;
  email: string;
}

/** The template's columns, as headers in German or English (Excel saves either). */
const COLUMNS = {
  roomType: ["zimmerkategorie", "room type", "roomtype", "kategorie"],
  firstName: ["vorname", "first name", "firstname"],
  lastName: ["nachname", "last name", "lastname", "name"],
  adults: ["erwachsene", "adults", "personen"],
  email: ["e-mail", "email", "mail"],
} as const;

/** One CSV line split by the separator, quotes honoured ("" is a quote). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** The organiser's rooming list from our spreadsheet template saved as CSV (semicolon, comma or tab separated). */
export function parseRoomingList(text: string): RoomingRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, header.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const names = splitLine(header, sep).map((h) => h.toLowerCase());
  const at = (k: keyof typeof COLUMNS) => names.findIndex((n) => (COLUMNS[k] as readonly string[]).includes(n));
  const idx = { roomType: at("roomType"), firstName: at("firstName"), lastName: at("lastName"), adults: at("adults"), email: at("email") };
  if (idx.roomType < 0 || idx.lastName < 0) throw new Error("The file does not have the template's columns (Room type, First name, Last name)");
  const rows: RoomingRow[] = [];
  lines.slice(1).forEach((l, i) => {
    if (!l.trim()) return;
    const c = splitLine(l, sep);
    const get = (n: number) => (n >= 0 ? (c[n] ?? "") : "");
    const adults = Number.parseInt(get(idx.adults), 10);
    rows.push({ line: i + 2, roomType: get(idx.roomType).toUpperCase(), firstName: get(idx.firstName), lastName: get(idx.lastName), adults: Number.isFinite(adults) && adults > 0 ? Math.min(adults, 9) : 1, email: get(idx.email) });
  });
  if (rows.length > 999) throw new Error("A rooming list has at most 999 rows");
  return rows;
}

export type RoomingProblem = "type_not_held" | "over_held" | "name_missing";

/** The mismatch preview: a row whose room type the group does not hold, or one beyond the held count of its type, or without a name. */
export function checkRoomingList(rows: RoomingRow[], held: Record<string, number>): (RoomingRow & { problem: RoomingProblem | null })[] {
  const used = new Map<string, number>();
  return rows.map((r) => {
    if (!r.lastName) return { ...r, problem: "name_missing" };
    if (!(r.roomType in held) || held[r.roomType]! <= 0) return { ...r, problem: "type_not_held" };
    const n = (used.get(r.roomType) ?? 0) + 1;
    used.set(r.roomType, n);
    return { ...r, problem: n > held[r.roomType]! ? "over_held" : null };
  });
}

export interface FreeRoom {
  id: string;
  floor: string;
  sectionId: string | null;
  roomTypeId: string;
}

/**
 * Rooms for a group's reservations (their room types, in order), kept
 * together: the floor (or Section) that takes the most of the group is
 * filled first, then the next. A reservation with no free room of its type
 * gets null.
 */
export function roomsTogether(free: FreeRoom[], wanted: string[], by: "floor" | "section"): (string | null)[] {
  const key = (r: FreeRoom) => (by === "floor" ? `f:${r.floor}` : `s:${r.sectionId ?? ""}`);
  const clusters = new Map<string, FreeRoom[]>();
  for (const r of free) clusters.set(key(r), [...(clusters.get(key(r)) ?? []), r]);
  const result: (string | null)[] = wanted.map(() => null);
  const taken = new Set<string>();
  for (;;) {
    const open = wanted.map((t, i) => ({ t, i })).filter((w) => result[w.i] === null);
    if (!open.length) break;
    // how many of the still open reservations each cluster takes
    let best: { rooms: FreeRoom[]; fits: number } | null = null;
    for (const rooms of clusters.values()) {
      const left = rooms.filter((r) => !taken.has(r.id));
      const need = new Map<string, number>();
      for (const w of open) need.set(w.t, (need.get(w.t) ?? 0) + 1);
      let fits = 0;
      for (const [t, n] of need) fits += Math.min(n, left.filter((r) => r.roomTypeId === t).length);
      if (fits > (best?.fits ?? 0)) best = { rooms: left, fits };
    }
    if (!best) break;
    for (const w of open) {
      const r = best.rooms.find((x) => x.roomTypeId === w.t && !taken.has(x.id));
      if (r) (result[w.i] = r.id), taken.add(r.id);
    }
  }
  return result;
}

export interface DepositInstallment {
  id: string;
  dueDate: string;
  amount: number;
  paid: number;
  open: number;
  overdue: boolean;
}

/** The deposit schedule against what the organiser paid: money covers the installments in date order; one still open after its date is overdue. */
export function depositStatus(schedule: { id: string; dueDate: string; amount: number }[], paid: number, today: string): DepositInstallment[] {
  let left = Math.max(0, paid);
  return [...schedule]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((d) => {
      const covered = roundMoney(Math.min(left, d.amount));
      left = roundMoney(left - covered);
      const open = roundMoney(d.amount - covered);
      return { id: d.id, dueDate: d.dueDate, amount: d.amount, paid: covered, open, overdue: open > 0 && today > d.dueDate };
    });
}

/** Germany (BMG §30(3)): for a travel group above ten persons the tour leader registers, with the members' number and nationalities. */
export function tourLeaderRegisters(country: string, persons: number): boolean {
  return country === "DE" && persons > 10;
}
