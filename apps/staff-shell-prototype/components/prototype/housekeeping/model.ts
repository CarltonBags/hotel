"use client";
// PROTOTYPE model, state and texts for the housekeeping phone view. In memory only.
import { useState } from "react";

export type TaskType = "departure" | "stayover" | "arrival" | "linen";
export type TaskState = "open" | "doing" | "done" | "skipped";
export type Task = {
  id: string; room: string; section: string; type: TaskType; minutes: number; state: TaskState; assignee: string | null;
  guest?: string; until?: string; pax?: number; note?: string; flag?: "waiting" | "vip"; clean: "dirty" | "clean" | "inspected";
  skipReason?: "declined" | "dnd"; pending?: boolean; changed?: boolean; minibar: Record<string, number>;
};
export type Issue = { id: string; place: string; text: string; urgency: "now" | "today" | "later"; state: "open" | "doing" | "done"; by: string; block?: "Out of Order" | "Out of Service"; pending?: boolean };

export const STAFF = ["Ana", "Marek", "Ioana", "Selin"];
export const ME = "Ana";
export const SHIFT = 420;

const mk = (room: string, section: string, type: TaskType, minutes: number, assignee: string | null, x: Partial<Task> = {}): Task => ({ id: `t${room}${type}`, room, section, type, minutes, state: "open", assignee, clean: "dirty", minibar: {}, ...x });

export const TASKS: Task[] = [
  mk("201", "Floor 2 East", "departure", 35, "Ana", { flag: "waiting", note: "Guest waiting for this room" }),
  mk("202", "Floor 2 East", "stayover", 20, "Ana", { guest: "Tanaka", until: "3 Oct", pax: 3, note: "Allergy: feathers" }),
  mk("203", "Floor 2 East", "stayover", 20, "Ana", { guest: "Lefèvre", until: "30 Sep", pax: 2 }),
  mk("204", "Floor 2 East", "departure", 35, "Ana"),
  mk("205", "Floor 2 East", "linen", 10, "Ana", { guest: "Huber", until: "2 Oct", pax: 1 }),
  mk("206", "Floor 2 East", "arrival", 10, "Ana", { flag: "vip", note: "Welcome fruit plate" }),
  mk("214", "Floor 2 West", "stayover", 20, "Ana", { guest: "Kowalska", until: "1 Oct", pax: 2 }),
  mk("215", "Floor 2 West", "departure", 35, "Ana"),
  mk("216", "Floor 2 West", "stayover", 20, "Ana", { guest: "Almeida", until: "2 Oct", pax: 2 }),
  mk("217", "Floor 2 West", "departure", 45, "Ana", { note: "Junior Suite" }),
  mk("301", "Floor 3 East", "departure", 35, "Marek"), mk("302", "Floor 3 East", "stayover", 20, "Marek", { guest: "Larsen" }),
  mk("303", "Floor 3 East", "departure", 35, "Marek"), mk("304", "Floor 3 East", "stayover", 20, "Marek", { guest: "Rossi" }),
  mk("305", "Floor 3 East", "departure", 35, "Marek"), mk("306", "Floor 3 East", "linen", 10, "Marek", { guest: "Novak" }),
  mk("311", "Floor 3 West", "departure", 35, "Ioana"), mk("312", "Floor 3 West", "stayover", 20, "Ioana", { guest: "Schmid" }),
  mk("313", "Floor 3 West", "departure", 45, "Ioana"), mk("314", "Floor 3 West", "stayover", 20, "Ioana", { guest: "Dubois" }),
  mk("401", "Floor 4", "departure", 35, "Selin"), mk("402", "Floor 4", "departure", 35, "Selin"),
  mk("403", "Floor 4", "stayover", 20, "Selin", { guest: "Jansen" }), mk("404", "Floor 4", "arrival", 10, "Selin"),
  mk("405", "Floor 4", "departure", 35, null), mk("406", "Floor 4", "stayover", 20, null, { guest: "Horvat" }),
];

export const ISSUES: Issue[] = [
  { id: "i1", place: "Room 214", text: "Shower drain blocked", urgency: "now", state: "open", by: "Ana", block: "Out of Service" },
  { id: "i2", place: "Room 305", text: "Bedside lamp dead", urgency: "today", state: "open", by: "Marek" },
  { id: "i3", place: "Lift lobby 3", text: "Carpet edge loose", urgency: "later", state: "doing", by: "Front Desk" },
  { id: "i4", place: "Room 402", text: "Window does not close", urgency: "now", state: "open", by: "Selin", block: "Out of Order" },
];

export const MINIBAR = ["Water", "Beer", "Wine", "Snack"];
export const QUICK_ISSUES = ["Light", "TV", "Shower", "Toilet", "Heating", "Other"];

export type Lang = "en" | "de" | "pl";
export const TEXT: Record<Lang, Record<string, string>> = {
  en: { mine: "My rooms", start: "Start", done: "Done", declined: "Guest declined", dnd: "Do not disturb", minibar: "Minibar", lost: "Lost and found", issue: "Report problem", departure: "Departure", stayover: "Stayover", arrival: "Arrival", linen: "Linen", changed: "Changed", waiting: "Guest waiting", left: "min left", offline: "No connection. Changes are saved and sent later.", sync: "waiting to send", until: "until", next: "Next", queue: "Problems", take: "I take it", fixed: "Fixed", photo: "Add photo" },
  de: { mine: "Meine Zimmer", start: "Start", done: "Fertig", declined: "Gast lehnt ab", dnd: "Bitte nicht stören", minibar: "Minibar", lost: "Fundsache", issue: "Problem melden", departure: "Abreise", stayover: "Bleibe", arrival: "Anreise", linen: "Wäsche", changed: "Geändert", waiting: "Gast wartet", left: "Min. übrig", offline: "Keine Verbindung. Änderungen werden gespeichert und später gesendet.", sync: "wartet auf Senden", until: "bis", next: "Danach", queue: "Probleme", take: "Übernehme ich", fixed: "Behoben", photo: "Foto hinzufügen" },
  pl: { mine: "Moje pokoje", start: "Start", done: "Gotowe", declined: "Gość odmówił", dnd: "Nie przeszkadzać", minibar: "Minibar", lost: "Rzecz znaleziona", issue: "Zgłoś problem", departure: "Wyjazd", stayover: "Pobyt", arrival: "Przyjazd", linen: "Pościel", changed: "Zmiana", waiting: "Gość czeka", left: "min zostało", offline: "Brak połączenia. Zmiany zostaną wysłane później.", sync: "czeka na wysłanie", until: "do", next: "Następne", queue: "Problemy", take: "Biorę to", fixed: "Naprawione", photo: "Dodaj zdjęcie" },
};

export function useHk() {
  const [tasks, setTasks] = useState<Task[]>(TASKS);
  const [issues, setIssues] = useState<Issue[]>(ISSUES);
  const [online, setOnline] = useState(true);
  const [lang, setLang] = useState<Lang>("en");
  const [role, setRole] = useState<"housekeeper" | "maintenance">("housekeeper");
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 8));
  const patch = (id: string, p: Partial<Task>, what: string) => { setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p, changed: false, pending: !online || (t.pending && !online) } : t))); note(`${what}${online ? "" : " (offline, queued)"}`); };

  return {
    tasks, issues, online, lang, role, open, log, t: TEXT[lang],
    mine: tasks.filter((x) => x.assignee === ME),
    setLang, setRole, setOpen,
    setOnline: (v: boolean) => { setOnline(v); if (v) { setTasks((ts) => ts.map((x) => ({ ...x, pending: false }))); setIssues((is) => is.map((x) => ({ ...x, pending: false }))); note("Back online: queued changes sent"); } else note("Connection lost"); },
    start: (id: string) => patch(id, { state: "doing" }, `Started ${id}`),
    finish: (id: string) => patch(id, { state: "done", clean: "clean" }, `Done ${id}: room set to Clean`),
    skip: (id: string, r: "declined" | "dnd") => patch(id, { state: "skipped", skipReason: r }, `Skipped ${id}: ${r}`),
    reopen: (id: string) => patch(id, { state: "open", skipReason: undefined }, `Reopened ${id}`),
    minibar: (id: string, item: string, d: number) => setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, pending: !online, minibar: { ...x.minibar, [item]: Math.max(0, (x.minibar[item] ?? 0) + d) } } : x))),
    report: (place: string, text: string) => { setIssues((is) => [{ id: `i${is.length + 1}`, place, text, urgency: "today", state: "open", by: ME, pending: !online }, ...is]); note(`Problem reported: ${place}, ${text}`); },
    issueState: (id: string, state: Issue["state"]) => { setIssues((is) => is.map((x) => (x.id === id ? { ...x, state, pending: !online } : x))); note(`Issue ${id}: ${state}`); },
    assign: (id: string, who: string | null) => { setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, assignee: who, changed: true } : x))); note(`Supervisor moved ${id} to ${who ?? "unassigned"}`); },
    inspect: (id: string) => { setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, clean: "inspected" } : x))); note(`Inspected ${id}`); },
    earlyDeparture: () => { setTasks((ts) => ts.map((x) => (x.room === "214" ? { ...x, type: "departure", minutes: 35, guest: undefined, until: undefined, changed: true, state: x.state === "done" ? "open" : x.state, flag: "waiting", note: "Early departure, next guest arrives 14:00" } : x))); note("Front desk: early departure in 214, task changed"); },
  };
}
export type Hk = ReturnType<typeof useHk>;
export const pendingCount = (hk: Hk) => hk.tasks.filter((x) => x.pending).length + hk.issues.filter((x) => x.pending).length;
