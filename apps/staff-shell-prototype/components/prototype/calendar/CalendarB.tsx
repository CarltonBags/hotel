"use client";
// PROTOTYPE Calendar B: "Day agenda". No timeline. One column per day with that day's arrivals, departures and free rooms per type, as cards.
import { LogIn, LogOut } from "lucide-react";
import { STATUS_STYLE, TODAY, dayInfo } from "./data";
import type { Cal } from "./useCal";

export const name = "Day agenda";

export function CalendarB({ cal }: { cal: Cal }) {
  const days = Array.from({ length: cal.range }, (_, k) => TODAY + k);
  const total = cal.rooms;
  return (
    <div className="flex h-full overflow-x-auto">
      {days.map((d) => {
        const i = dayInfo(d);
        const arr = cal.res.filter((r) => r.start === d);
        const dep = cal.res.filter((r) => r.start + r.nights === d);
        const free = cal.types.reduce((a, t) => a + Math.max(0, cal.st[t.id].avail[d]), 0);
        return (
          <section key={d} className={`flex w-[260px] shrink-0 flex-col border-r border-ink-10 ${i.event ? "bg-warning/5" : ""}`}>
            <header className="sticky top-0 border-b border-ink-10 bg-surface p-3">
              <div className={`text-[15px] font-semibold ${d === TODAY ? "text-accent" : ""}`}>{i.wd} {i.date} {i.month}{d === TODAY && " · today"}</div>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-60">
                <span>{Math.round(((total - free) / total) * 100)} % occupied</span><span>·</span><span>{free} free</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {cal.types.map((t) => { const a = cal.st[t.id].avail[d]; return <span key={t.id} className={`rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] ${a <= 0 ? "bg-danger/15 text-danger" : a <= 2 ? "bg-warning/15 text-warning" : "bg-ink-5 text-ink-80"}`}>{t.id} {a}</span>; })}
              </div>
            </header>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
              <div className="flex items-center gap-1.5 px-1 pt-1 text-[12px] font-semibold text-ink-60"><LogIn size={13} />Arrivals ({arr.length})</div>
              {arr.slice(0, 14).map((r) => (
                <button key={r.id} onClick={() => cal.setPicked(r)} className={`flex w-full items-center gap-2 rounded-[12px] bg-surface-2 p-2 text-left shadow-card hover:bg-ink-5 ${cal.picked?.id === r.id ? "ring-2 ring-ink" : ""}`}>
                  <span className={`h-8 w-1 shrink-0 rounded-full ${STATUS_STYLE[r.status].bar}`} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.guest}</span><span className="block text-[11px] text-ink-60">{r.typeId} · {r.nights}N · {r.pax}p · {r.source}</span></span>
                  <span className={`rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium ${r.room ? "bg-ink-10" : "bg-warning/20 text-warning"}`}>{r.room ?? "assign"}</span>
                </button>
              ))}
              {arr.length > 14 && <div className="px-1 text-[12px] text-ink-60">+ {arr.length - 14} more arrivals</div>}
              <div className="flex items-center gap-1.5 px-1 pt-2 text-[12px] font-semibold text-ink-60"><LogOut size={13} />Departures ({dep.length})</div>
              <div className="flex flex-wrap gap-1 px-1">
                {dep.slice(0, 30).map((r) => <button key={r.id} onClick={() => cal.setPicked(r)} className="rounded-[6px] bg-ink-5 px-1.5 py-0.5 text-[12px] hover:bg-ink-10" title={r.guest}>{r.room}</button>)}
                {dep.length > 30 && <span className="text-[12px] text-ink-60">+ {dep.length - 30}</span>}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
