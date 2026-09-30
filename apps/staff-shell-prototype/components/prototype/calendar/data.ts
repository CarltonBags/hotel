// PROTOTYPE mock data for the Calendar. Deterministic, in memory only.
export type Status = "confirmed" | "in" | "out" | "late";
export type Res = { id: string; guest: string; typeId: string; room: string | null; start: number; nights: number; status: Status; pax: number; balance: number; source: string };
export type Block = { room: string; start: number; nights: number; kind: "ooo" | "oos"; reason: string };
export type RoomType = { id: string; name: string; rooms: string[]; base: number };

export const DAYS = 45;
export const TODAY = 3; // day index of the open Business Date, 28 Sep 2026
const START = new Date(2026, 8, 25);

export function dayInfo(i: number) {
  const d = new Date(START); d.setDate(d.getDate() + i);
  const wd = d.getDay();
  return { date: d.getDate(), month: d.toLocaleString("en-GB", { month: "short" }), wd: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][wd], weekend: wd === 5 || wd === 6, event: i >= 12 && i <= 15 };
}

function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const NAMES = ["Tanaka", "Kowalska", "Weidmann", "Lefèvre", "Almeida", "Larsen", "Haddad", "Ortega", "Novak", "Rossi", "Schmid", "Dubois", "Jansen", "Horvat", "Moreau", "Keller", "Bianchi", "Nilsson", "Petrov", "García", "Huber", "Wagner", "Costa", "Meyer", "Lindqvist", "O'Brien", "Yilmaz", "Fischer"];
const SOURCES = ["Booking.com", "Direct", "Booking Engine", "Expedia", "HRS"];
const DEF: [string, string, number, number][] = [["SGL", "Single", 8, 119], ["DBL", "Double", 14, 159], ["DBS", "Double Superior", 12, 189], ["TWN", "Twin", 10, 159], ["JRS", "Junior Suite", 6, 249], ["STE", "Suite", 4, 349]];

export function build(scale: number) {
  const r = rng(42);
  let floor = 1, n = 1;
  const types: RoomType[] = DEF.map(([id, name, count, base]) => {
    const rooms: string[] = [];
    for (let k = 0; k < count * scale; k++) { rooms.push(`${floor}${String(n).padStart(2, "0")}`); n++; if (n > 24) { n = 1; floor++; } }
    return { id, name, rooms, base };
  });
  const res: Res[] = [];
  let id = 48000;
  for (const t of types) for (const room of t.rooms) {
    let d = -Math.floor(r() * 4);
    while (d < DAYS) {
      d += r() < 0.55 ? 0 : 1 + Math.floor(r() * 3);
      const nights = 1 + Math.floor(r() * 5);
      if (d >= DAYS) break;
      const end = d + nights;
      let status: Status = end <= TODAY ? "out" : d < TODAY ? "in" : d === TODAY ? (r() < 0.5 ? "in" : "confirmed") : "confirmed";
      if (d === TODAY - 1 && status === "in" && r() < 0.12) status = "late";
      res.push({ id: `R-${id++}`, guest: NAMES[Math.floor(r() * NAMES.length)], typeId: t.id, room, start: d, nights, status, pax: 1 + Math.floor(r() * 3), balance: r() < 0.35 ? Math.round(r() * 900) : 0, source: SOURCES[Math.floor(r() * SOURCES.length)] });
      d = end;
    }
  }
  // turn some future reservations into unassigned ones
  for (const x of res) if (x.start > TODAY && r() < 0.12) x.room = null;
  const blocks: Block[] = [
    { room: types[1].rooms[2], start: 5, nights: 4, kind: "ooo", reason: "Bathroom renovation" },
    { room: types[2].rooms[1], start: 2, nights: 3, kind: "oos", reason: "TV defect" },
    { room: types[4].rooms[0], start: 20, nights: 6, kind: "ooo", reason: "Carpet replacement" },
  ];
  // blocks win over mock reservations in the same room
  const kept = res.filter((x) => !blocks.some((b) => b.kind === "ooo" && b.room === x.room && x.start < b.start + b.nights && b.start < x.start + x.nights));
  return { types, res: kept, blocks };
}

export function stats(types: RoomType[], res: Res[], blocks: Block[]) {
  const out: Record<string, { avail: number[]; price: number[]; minStay: number[]; stop: boolean[] }> = {};
  for (const t of types) {
    const avail = Array.from({ length: DAYS }, () => t.rooms.length);
    for (const x of res) if (x.typeId === t.id) for (let d = Math.max(0, x.start); d < Math.min(DAYS, x.start + x.nights); d++) avail[d]--;
    for (const b of blocks) if (b.kind === "ooo" && t.rooms.includes(b.room)) for (let d = Math.max(0, b.start); d < Math.min(DAYS, b.start + b.nights); d++) avail[d]--;
    const price = avail.map((_, d) => { const i = dayInfo(d); return Math.round(t.base * (i.event ? 1.6 : i.weekend ? 1.15 : 1)); });
    const minStay = avail.map((_, d) => (dayInfo(d).event ? 2 : 1));
    const stop = avail.map((_, d) => t.id === "STE" && d === 13);
    out[t.id] = { avail, price, minStay, stop };
  }
  return out;
}

export const STATUS_STYLE: Record<Status, { bar: string; label: string }> = {
  confirmed: { bar: "bg-accent text-white", label: "Confirmed" },
  in: { bar: "bg-success text-white", label: "Checked-in" },
  out: { bar: "bg-ink-20 text-ink-80", label: "Checked-out" },
  late: { bar: "bg-warning text-white", label: "Late Arrival" },
};
