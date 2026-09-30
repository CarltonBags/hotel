"use client";
// PROTOTYPE, throwaway. Question: what should the Calendar look like and how does it behave inside the chosen shell, up to 400 rooms?
// Three structures via ?variant=: A room timeline, B day agenda, C availability matrix with drill-down. Range and room count via the toolbar.
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PrototypeSwitcher } from "../PrototypeSwitcher";
import { useWorkspace } from "../shell/useWorkspace";
import { VariantE } from "../shell/VariantE";
import { STATUS_STYLE, dayInfo } from "./data";
import { useCal } from "./useCal";
import { CalendarA, name as nameA } from "./CalendarA";
import { CalendarB, name as nameB } from "./CalendarB";
import { CalendarC, name as nameC } from "./CalendarC";

const VARIANTS = [{ key: "A", name: nameA }, { key: "B", name: nameB }, { key: "C", name: nameC }];

export function CalendarPrototype() {
  const q = useSearchParams();
  const raw = q.get("variant") ?? "A";
  const variant = VARIANTS.some((v) => v.key === raw) ? raw : "A";
  const ws = useWorkspace();
  const cal = useCal();
  useEffect(() => {
    ws.activate("calendar");
    const p = new URLSearchParams(window.location.search); // PROTOTYPE debug params
    if (p.get("rooms") === "400") cal.setScale(7);
    const r = Number(p.get("range")); if (r === 7 || r === 14 || r === 30) cal.setRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seg = (on: boolean) => `h-9 rounded-full px-3.5 text-[13px] ${on ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`;
  const p = cal.picked;

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-10 px-5 py-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Calendar</h1>
        <div className="flex rounded-full bg-surface-2 p-0.5">{([7, 14, 30] as const).map((r) => <button key={r} onClick={() => cal.setRange(r)} className={seg(cal.range === r)}>{r} days</button>)}</div>
        <div className="flex rounded-full bg-surface-2 p-0.5" title="Prototype control: hotel size"><button onClick={() => cal.setScale(1)} className={seg(cal.scale === 1)}>54 rooms</button><button onClick={() => cal.setScale(7)} className={seg(cal.scale === 7)}>378 rooms</button></div>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-ink-60">
          {(Object.keys(STATUS_STYLE) as (keyof typeof STATUS_STYLE)[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-full ${STATUS_STYLE[k].bar}`} />{STATUS_STYLE[k].label}</span>)}
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed border-ink-60" />Unassigned</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {variant === "A" && <CalendarA cal={cal} />}
        {variant === "B" && <CalendarB cal={cal} />}
        {variant === "C" && <CalendarC cal={cal} />}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-ink-10 px-5 text-[13px]">
        {p ? (
          <><span className={`size-2.5 rounded-full ${STATUS_STYLE[p.status].bar}`} /><span className="font-medium">{p.guest}</span><span className="font-mono text-[12px] text-ink-60">{p.id}</span>
            <span className="text-ink-60">{dayInfo(p.start).date} {dayInfo(p.start).month} · {p.nights} nights · {p.typeId} · room {p.room ?? "unassigned"} · {p.pax} guests · {p.source} · {p.balance ? `open € ${p.balance}` : "paid"}</span>
            <button onClick={() => ws.open({ id: p.id, kind: "reservation", title: p.guest, sub: p.id })} className="ml-auto h-8 rounded-full bg-ink px-3 text-[13px] font-medium text-canvas">Open as tab</button>
            <button aria-label="Clear selection" onClick={() => cal.setPicked(null)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5"><X size={15} /></button></>
        ) : <span className="text-ink-60">{cal.msg}</span>}
      </div>
    </div>
  );

  return (
    <>
      <VariantE ws={ws} content={content} />
      <PrototypeSwitcher variants={VARIANTS} current={variant} state={{ variant, range: cal.range, rooms: cal.rooms, reservations: cal.res.length, picked: cal.picked, lastAction: cal.msg }} />
    </>
  );
}
