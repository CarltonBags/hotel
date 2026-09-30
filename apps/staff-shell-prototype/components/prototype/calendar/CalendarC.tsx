"use client";
// PROTOTYPE Calendar C: "Availability matrix". Room types by days as a heat map of free rooms with price and restrictions; selecting a cell lists the reservations behind it. No room rows.
import { useState } from "react";
import { DAYS, STATUS_STYLE, TODAY, dayInfo } from "./data";
import type { Cal } from "./useCal";

export const name = "Availability matrix with drill-down";
const LEFT = 190;

export function CalendarC({ cal }: { cal: Cal }) {
  const [sel, setSel] = useState<{ t: string; d: number }>({ t: "DBL", d: TODAY });
  const dw = Math.max(cal.dw, 52);
  const t = cal.types.find((x) => x.id === sel.t)!;
  const list = cal.res.filter((r) => r.typeId === sel.t && r.start <= sel.d && sel.d < r.start + r.nights);
  const dep = cal.res.filter((r) => r.typeId === sel.t && r.start + r.nights === sel.d);
  const i = dayInfo(sel.d);
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div style={{ width: LEFT + DAYS * dw }}>
          <div className="sticky top-0 z-20 flex h-12 border-b border-ink-10 bg-surface">
            <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40" style={{ width: LEFT }}>Room type</div>
            {Array.from({ length: DAYS }, (_, d) => dayInfo(d)).map((x, d) => (
              <div key={d} className={`flex shrink-0 flex-col items-center justify-center text-[12px] ${d === TODAY ? "font-semibold text-accent" : x.weekend ? "text-ink-80" : "text-ink-60"} ${x.event ? "bg-warning/10" : ""}`} style={{ width: dw }}><span>{x.wd}</span><span className="text-[13px]">{x.date}</span></div>
            ))}
          </div>
          {cal.types.map((ty) => {
            const s = cal.st[ty.id];
            return (
              <div key={ty.id} className="flex border-b border-ink-5">
                <div className="sticky left-0 z-10 flex shrink-0 items-center justify-between bg-surface px-4 text-[14px] font-medium" style={{ width: LEFT }}>{ty.name}<span className="text-[12px] font-normal text-ink-40">{ty.rooms.length}</span></div>
                {s.avail.map((a, d) => {
                  const ratio = Math.max(0, a) / ty.rooms.length;
                  const on = sel.t === ty.id && sel.d === d;
                  return (
                    <button key={d} onClick={() => setSel({ t: ty.id, d })} className={`relative flex h-[68px] shrink-0 flex-col items-center justify-center gap-0.5 border-r border-ink-5 ${on ? "z-10 ring-2 ring-inset ring-ink" : ""}`} style={{ width: dw, background: s.stop[d] ? "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-ink-10) 5px 10px)" : `color-mix(in srgb, ${a <= 0 ? "var(--danger)" : ratio < 0.2 ? "var(--warning)" : "var(--success)"} ${a <= 0 ? 22 : ratio < 0.2 ? 20 : Math.round(6 + ratio * 16)}%, transparent)` }}>
                      <span className={`text-[17px] font-semibold leading-none ${a <= 0 ? "text-danger" : ""}`}>{a}</span>
                      <span className="text-[11px] text-ink-60">€{s.price[d]}</span>
                      <span className="h-3 text-[10px] font-semibold text-ink-80">{s.stop[d] ? "STOP" : s.minStay[d] > 1 ? `min ${s.minStay[d]}` : ""}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="flex border-b border-ink-10 bg-surface-2">
            <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface-2 px-4 text-[13px] font-semibold" style={{ width: LEFT }}>Occupancy</div>
            {Array.from({ length: DAYS }, (_, d) => { const free = cal.types.reduce((a, ty) => a + Math.max(0, cal.st[ty.id].avail[d]), 0); return <div key={d} className="flex h-9 shrink-0 items-center justify-center text-[12px] text-ink-80" style={{ width: dw }}>{Math.round(((cal.rooms - free) / cal.rooms) * 100)}%</div>; })}
          </div>
        </div>
      </div>
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-ink-10">
        <div className="border-b border-ink-10 p-4">
          <div className="text-[12px] text-ink-60">{i.wd} {i.date} {i.month}</div>
          <div className="text-[18px] font-semibold tracking-tight">{t.name}</div>
          <div className="mt-1 text-[13px] text-ink-60">{cal.st[t.id].avail[sel.d]} free of {t.rooms.length} · €{cal.st[t.id].price[sel.d]} · {list.length} staying · {dep.length} leaving</div>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {list.map((r) => (
            <button key={r.id} onClick={() => cal.setPicked(r)} className={`flex w-full items-center gap-2 rounded-[10px] p-2 text-left hover:bg-ink-5 ${cal.picked?.id === r.id ? "bg-ink-5" : ""}`}>
              <span className={`h-8 w-1 shrink-0 rounded-full ${STATUS_STYLE[r.status].bar}`} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{r.guest}</span><span className="block text-[11px] text-ink-60">{r.start === sel.d ? "arrives" : "staying"} · {r.nights}N · {r.source}</span></span>
              <span className={`rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium ${r.room ? "bg-ink-10" : "bg-warning/20 text-warning"}`}>{r.room ?? "assign"}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
