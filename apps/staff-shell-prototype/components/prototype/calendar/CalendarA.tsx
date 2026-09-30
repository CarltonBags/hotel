"use client";
// PROTOTYPE Calendar A: "Room timeline". One row per room, grouped by room type; type rows carry availability and price per day; unassigned reservations sit in a lane above their type.
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { DAYS, STATUS_STYLE, TODAY, dayInfo, type Res } from "./data";
import type { Cal } from "./useCal";

export const name = "Room timeline";
const LEFT = 168;

function lanes(list: Res[]) {
  const out: Res[][] = [];
  for (const r of [...list].sort((a, b) => a.start - b.start)) {
    const lane = out.find((l) => l[l.length - 1].start + l[l.length - 1].nights <= r.start);
    if (lane) lane.push(r); else out.push([r]);
  }
  return out;
}

export function CalendarA({ cal }: { cal: Cal }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const grab = useRef(0);
  const { dw } = cal;
  const W = DAYS * dw;
  const grid = { backgroundImage: "linear-gradient(to right, var(--color-ink-5) 1px, transparent 1px)", backgroundSize: `${dw}px 100%` };

  const bar = (r: Res, h = 24) => {
    const left = r.start * dw + dw / 2;
    const l = Math.max(2, left);
    const w = r.nights * dw - 3 - (l - left);
    if (w < 8) return null;
    return (
      <button
        key={r.id}
        draggable={r.status !== "out"}
        onDragStart={(e) => { grab.current = (e.clientX - e.currentTarget.getBoundingClientRect().left + (l - left)) / dw; e.dataTransfer.setData("text/plain", r.id); }}
        onClick={() => cal.setPicked(r)}
        title={`${r.guest} · ${r.id} · ${r.nights} nights · ${STATUS_STYLE[r.status].label}`}
        className={`absolute top-1 flex items-center gap-1.5 overflow-hidden rounded-[8px] px-2 text-left text-[12px] font-medium ${STATUS_STYLE[r.status].bar} ${r.room ? "" : "outline-dashed outline-1 -outline-offset-1 outline-white/70"} ${cal.picked?.id === r.id ? "ring-2 ring-ink" : ""}`}
        style={{ left: l, width: w, height: h }}
      >
        <span className="truncate">{r.guest}</span>
        {w > 110 && <span className="shrink-0 opacity-80">{r.pax}p</span>}
        {r.balance > 0 && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-white" title="Open balance" />}
      </button>
    );
  };

  const track = (room: string, typeId: string, children: React.ReactNode, h = 32) => (
    <div
      className="relative shrink-0"
      style={{ width: W, height: h, ...grid }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { const x = e.clientX - e.currentTarget.getBoundingClientRect().left; cal.move(e.dataTransfer.getData("text/plain"), room, typeId, Math.round(x / dw - grab.current - 0.5 + 0.5)); }}
    >{children}</div>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="relative" style={{ width: LEFT + W }}>
        <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LEFT, width: W }}>
          {Array.from({ length: DAYS }, (_, d) => dayInfo(d)).map((i, d) => (i.weekend || i.event) && <div key={d} className={`absolute inset-y-0 ${i.event ? "bg-warning/10" : "bg-ink-5"}`} style={{ left: d * dw, width: dw }} />)}
          <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: TODAY * dw + dw / 2 }} />
        </div>

        <div className="sticky top-0 z-30 flex h-12 border-b border-ink-10 bg-surface">
          <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[12px] font-semibold uppercase tracking-wide text-ink-40" style={{ width: LEFT }}>Room</div>
          {Array.from({ length: DAYS }, (_, d) => dayInfo(d)).map((i, d) => (
            <div key={d} className={`flex shrink-0 flex-col items-center justify-center text-[12px] ${d === TODAY ? "font-semibold text-accent" : i.weekend ? "text-ink-80" : "text-ink-60"}`} style={{ width: dw }}>
              <span>{i.wd}</span><span className="text-[13px]">{i.date}{dw > 60 && ` ${i.month}`}</span>
            </div>
          ))}
        </div>

        {cal.types.map((t) => {
          const s = cal.st[t.id];
          const un = lanes(cal.res.filter((r) => r.typeId === t.id && !r.room));
          const open = !closed[t.id];
          return (
            <div key={t.id}>
              <div className="relative z-10 flex h-10 border-b border-ink-10 bg-surface-2">
                <button onClick={() => setClosed({ ...closed, [t.id]: open })} className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 bg-surface-2 px-3 text-left text-[13px] font-semibold" style={{ width: LEFT }}>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span className="truncate">{t.name}</span><span className="ml-auto font-normal text-ink-40">{t.rooms.length}</span>
                </button>
                {s.avail.map((a, d) => (
                  <div key={d} className="flex shrink-0 flex-col items-center justify-center leading-tight" style={{ width: dw }}>
                    <span className={`text-[13px] font-semibold ${s.stop[d] ? "text-ink-40 line-through" : a <= 0 ? "text-danger" : a <= 2 ? "text-warning" : ""}`}>{a}</span>
                    {dw > 60 && <span className="text-[11px] text-ink-60">€{s.price[d]}{s.minStay[d] > 1 && ` · ${s.minStay[d]}N`}</span>}
                  </div>
                ))}
              </div>
              {open && un.map((lane, k) => (
                <div key={k} className="relative z-10 flex border-b border-ink-5">
                  <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[12px] text-warning" style={{ width: LEFT }}>{k === 0 ? `Unassigned (${un.flat().length})` : ""}</div>
                  <div className="relative shrink-0" style={{ width: W, height: 32, ...grid }}>{lane.map((r) => bar(r))}</div>
                </div>
              ))}
              {open && t.rooms.map((room) => (
                <div key={room} className="relative z-10 flex border-b border-ink-5 hover:bg-ink-5">
                  <div className="sticky left-0 z-10 flex shrink-0 items-center bg-surface px-4 text-[13px] font-medium" style={{ width: LEFT }}>{room}</div>
                  {track(room, t.id, <>
                    {cal.blocks.filter((b) => b.room === room).map((b) => (
                      <div key={b.start} title={`${b.kind === "ooo" ? "Out of Order" : "Out of Service"}: ${b.reason}`} className={`absolute top-1 flex h-6 items-center gap-1 overflow-hidden rounded-[8px] px-2 text-[11px] font-medium ${b.kind === "ooo" ? "bg-ink text-canvas" : "border border-dashed border-warning text-warning"}`} style={{ left: b.start * dw + 2, width: b.nights * dw - 4, ...(b.kind === "ooo" ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.18) 6px 12px)" } : {}) }}>
                        <Wrench size={12} className="shrink-0" /><span className="truncate">{b.kind === "ooo" ? "Out of Order" : "Out of Service"} · {b.reason}</span>
                      </div>
                    ))}
                    {cal.res.filter((r) => r.room === room).map((r) => bar(r))}
                  </>)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
