"use client";
// PROTOTYPE content panels. Same in every variant: the shell is what is being judged, not these screens.
import { Check, Send, TabletSmartphone, BedDouble } from "lucide-react";
import { ARRIVALS, CONVERSATIONS, PROPERTIES, type Tab } from "./mock";
import type { Workspace } from "./useWorkspace";

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium";

function StatusChip({ s }: { s: string }) {
  const c = s === "Checked-in" ? "bg-success/15 text-success" : s === "Confirmed" ? "bg-ink-10 text-ink-80" : "bg-accent/15 text-accent";
  return <span className={`${chip} ${c}`}>{s}</span>;
}

function ArrivalsTable({ ws }: { ws: Workspace }) {
  return (
    <table className="w-full border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr className="text-left text-ink-60">
          {["Guest", "Reservation", "Room type", "Room", "Nights", "Guests", "Source", "Balance", "Status"].map((h) => (
            <th key={h} className="sticky top-0 border-b border-ink-10 bg-surface px-3 py-2 font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ARRIVALS.map((a) => (
          <tr
            key={a.id}
            tabIndex={0}
            onClick={() => ws.open({ id: a.id, kind: "reservation", title: a.guest, sub: a.id })}
            onKeyDown={(e) => e.key === "Enter" && ws.open({ id: a.id, kind: "reservation", title: a.guest, sub: a.id })}
            className="cursor-pointer hover:bg-ink-5"
          >
            <td className="border-b border-ink-5 px-3 py-2 font-medium">{a.guest} <span className="text-ink-40">{a.country}</span></td>
            <td className="border-b border-ink-5 px-3 py-2 font-mono text-[12px] text-ink-60">{a.id}</td>
            <td className="border-b border-ink-5 px-3 py-2">{a.roomType}</td>
            <td className="border-b border-ink-5 px-3 py-2">{a.room ?? <span className="text-warning">unassigned</span>}</td>
            <td className="border-b border-ink-5 px-3 py-2">{a.nights}</td>
            <td className="border-b border-ink-5 px-3 py-2">{a.pax}</td>
            <td className="border-b border-ink-5 px-3 py-2">{a.source}</td>
            <td className="border-b border-ink-5 px-3 py-2 font-mono text-[12px]">{a.balance ? `€ ${a.balance.toFixed(2)}` : "paid"}</td>
            <td className="border-b border-ink-5 px-3 py-2"><StatusChip s={a.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Dashboard({ ws }: { ws: Workspace }) {
  const all = ws.propertyId === "all";
  const kpis = [["Arrivals", "38"], ["Departures", "41"], ["In house", "164"], ["Occupancy", "81 %"], ["Unassigned", "6"], ["Open balance", "€ 4,912"]];
  return (
    <div className="space-y-5 p-6">
      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
        {kpis.map(([k, v]) => (
          <div key={k} className="rounded-[20px] bg-surface-2 p-4 shadow-card">
            <div className="text-[12px] text-ink-60">{k}</div>
            <div className="mt-1 text-[26px] font-medium tracking-tight">{v}</div>
          </div>
        ))}
      </div>
      {all && (
        <div className="grid grid-cols-3 gap-3">
          {PROPERTIES.slice(1).map((p) => (
            <button key={p.id} onClick={() => ws.setPropertyId(p.id)} className="rounded-[20px] bg-surface-2 p-4 text-left shadow-card hover:bg-ink-5">
              <div className="font-medium">{p.name}</div>
              <div className="text-[12px] text-ink-60">{p.city} · {p.rooms} rooms</div>
              <div className="mt-3 h-1.5 rounded-full bg-ink-10"><div className="h-full rounded-full bg-accent" style={{ width: `${60 + p.rooms % 35}%` }} /></div>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-[20px] shadow-card">
        <div className="px-4 pt-4 text-[13px] font-semibold">Arrivals today</div>
        <ArrivalsTable ws={ws} />
      </div>
    </div>
  );
}

function Calendar() {
  const days = Array.from({ length: 14 }, (_, i) => i + 28 > 30 ? i - 2 : i + 28);
  const rooms = ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "114", "115", "116", "117"];
  const bars: Record<string, [number, number, string, string]> = {
    "101": [0, 3, "Kowalska", "bg-accent/80"], "102": [2, 5, "Tanaka", "bg-success/80"], "104": [1, 2, "Weidmann", "bg-accent/80"],
    "105": [4, 6, "Haddad", "bg-accent/80"], "107": [0, 2, "Lefèvre", "bg-success/80"], "108": [6, 4, "Almeida", "bg-accent/80"],
    "110": [3, 7, "Larsen", "bg-accent/80"], "112": [8, 3, "Ortega", "bg-accent/80"], "115": [0, 9, "Group Siemens", "bg-warning/80"],
    "116": [5, 5, "Novak", "bg-accent/80"],
  };
  return (
    <div className="p-4">
      <div className="grid text-[12px]" style={{ gridTemplateColumns: `72px repeat(14, minmax(56px, 1fr))` }}>
        <div className="sticky top-0 bg-surface" />
        {days.map((d, i) => (
          <div key={i} className={`border-b border-ink-10 px-2 py-2 text-center ${i === 0 ? "font-semibold text-accent" : "text-ink-60"}`}>{d}</div>
        ))}
        {rooms.map((r) => (
          <div key={r} className="contents">
            <div className="flex h-8 items-center gap-1.5 border-b border-ink-5 px-2 font-medium"><BedDouble size={14} className="text-ink-40" />{r}</div>
            <div className="relative col-span-14 h-8 border-b border-ink-5" style={{ gridColumn: "2 / -1" }}>
              <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: "repeat(14, 1fr)" }}>
                {days.map((_, i) => <div key={i} className="border-r border-ink-5" />)}
              </div>
              {bars[r] && (
                <button
                  className={`absolute top-1 h-6 truncate rounded-[8px] px-2 text-left text-[12px] font-medium text-white ${bars[r][3]}`}
                  style={{ left: `calc(${(bars[r][0] / 14) * 100}% + 2px)`, width: `calc(${(bars[r][1] / 14) * 100}% - 4px)` }}
                >
                  {bars[r][2]}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FIELDS: [string, string, string?][] = [
  ["First name", "Aiko"], ["Last name", "Tanaka"], ["Email", "aiko.tanaka@example.jp"], ["Phone", "+81 90 1234 5678"],
  ["Street", "2-1 Marunouchi"], ["Postcode", "100-0005"], ["City", "Tokyo"], ["Country", "Japan"],
  ["Nationality", "Japanese"], ["Date of birth", "1988-04-12", "date"], ["ID type", "Passport"], ["ID number", "TR4821193"],
  ["Arrival", "2026-09-28", "date"], ["Departure", "2026-10-03", "date"], ["Adults", "2", "number"], ["Child ages", "6"],
  ["Room type", "Junior Suite"], ["Rate plan", "Flex incl. breakfast"], ["Room", "501"], ["Source", "Booking Engine"],
];

function Reservation({ tab }: { tab: Tab }) {
  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-medium tracking-tight">{tab.title}</h1>
        <span className="font-mono text-[12px] text-ink-60">{tab.sub}</span>
        <StatusChip s="Confirmed" />
        <div className="ml-auto flex gap-2">
          <button className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium shadow-pill hover:bg-ink-5"><TabletSmartphone size={16} />Send to tablet</button>
          <button className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-[13px] font-medium text-white"><Check size={16} />Check in</button>
        </div>
      </div>
      <p className="mt-1 text-[12px] text-ink-60">Tab moves through every field in order. Enter in the last field saves.</p>
      <form className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
        {FIELDS.map(([label, val, type]) => (
          <label key={label} className="block text-[12px] text-ink-60">
            {label}
            <input
              type={type ?? "text"}
              defaultValue={val}
              className="mt-1 h-8 w-full rounded-[10px] border border-ink-10 bg-surface-2 px-2.5 text-[13px] text-ink hover:border-ink-20"
            />
          </label>
        ))}
        <label className="col-span-2 block text-[12px] text-ink-60 lg:col-span-4">
          Notes
          <textarea defaultValue="Anniversary. Quiet room requested." rows={2} className="mt-1 w-full rounded-[10px] border border-ink-10 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink" />
        </label>
      </form>
    </div>
  );
}

function Inbox() {
  return (
    <div className="grid h-full grid-cols-[300px_1fr]">
      <div className="overflow-auto border-r border-ink-10">
        {CONVERSATIONS.map((c, i) => (
          <button key={c.id} className={`flex w-full items-start gap-3 border-b border-ink-5 px-4 py-3 text-left hover:bg-ink-5 ${i === 0 ? "bg-ink-5" : ""}`}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-10 text-[12px] font-medium">{c.guest.split(" ").map((x) => x[0]).join("")}</span>
            <span className="min-w-0 flex-1">
              <span className="flex justify-between"><span className="font-medium">{c.guest}</span><span className="text-[11px] text-ink-60">{c.time}</span></span>
              <span className="block truncate text-[12px] text-ink-60">{c.last}</span>
            </span>
            {c.unread > 0 && <span className="mt-1 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-medium text-white">{c.unread}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-col">
        <div className="border-b border-ink-10 px-5 py-3 font-medium">Aiko Tanaka <span className="font-mono text-[12px] text-ink-60">R-48220</span></div>
        <div className="flex-1 space-y-2 overflow-auto p-5 text-[13px]">
          <div className="max-w-[60%] rounded-[14px] bg-ink-5 px-3 py-2">Hello, we land at 09:15.</div>
          <div className="max-w-[60%] rounded-[14px] bg-ink-5 px-3 py-2">Is early check-in at 11:00 possible?</div>
          <div className="ml-auto max-w-[60%] rounded-[14px] bg-accent px-3 py-2 text-white">Good morning! Let me check with housekeeping.</div>
        </div>
        <div className="flex gap-2 border-t border-ink-10 p-3">
          <input placeholder="Write a message" className="h-9 flex-1 rounded-full border border-ink-10 bg-surface-2 px-4 text-[13px]" />
          <button aria-label="Send" className="grid size-9 place-items-center rounded-full bg-accent text-white"><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function ListPage({ title }: { title: string }) {
  const rows = ARRIVALS.map((a, i) => [a.room ?? "—", a.guest, a.pax, i % 3 === 0 ? "08:30" : "open", i % 2 ? "vegetarian" : ""]);
  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[24px] font-medium tracking-tight">{title}</h1>
        <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[12px] font-medium text-accent">28 Sep 2026</span>
        <button className="ml-auto h-9 rounded-full px-4 text-[13px] font-medium shadow-pill hover:bg-ink-5">Print</button>
      </div>
      <table className="mt-4 w-full text-[14px]">
        <thead><tr className="text-left text-ink-60">{["Room", "Guest", "Guests", "Time", "Note"].map((h) => <th key={h} className="border-b border-ink-10 px-3 py-2.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="hover:bg-ink-5">{r.map((c, j) => <td key={j} className="border-b border-ink-5 px-3 py-2.5">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-[22px] font-medium tracking-tight">{title}</h1>
      <div className="mt-4 grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-24 rounded-[20px] bg-surface-2 shadow-card" />)}
      </div>
    </div>
  );
}

export function TabContent({ tab, ws }: { tab: Tab | null; ws: Workspace }) {
  if (!tab) return <div className="grid h-full place-items-center text-ink-40">No tab open. Pick a module to start.</div>;
  switch (tab.kind) {
    case "dashboard": return <Dashboard ws={ws} />;
    case "arrivals": return <div className="p-2"><ArrivalsTable ws={ws} /></div>;
    case "calendar": return <Calendar />;
    case "reservation": return <Reservation tab={tab} />;
    case "inbox": return <Inbox />;
    case "list": return <ListPage title={tab.title} />;
    default: return <Placeholder title={tab.title} />;
  }
}
