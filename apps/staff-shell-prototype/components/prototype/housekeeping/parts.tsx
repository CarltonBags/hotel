"use client";
// PROTOTYPE shared parts of the phone view: icons, header, room sheet, maintenance queue. Variants own only the task overview.
import { useState } from "react";
import { Ban, BedDouble, Camera, Check, CheckCheck, Clock, DoorClosed, Hourglass, Languages, Layers, LogIn, LogOut, Minus, PackageSearch, Play, Plus, Star, TriangleAlert, WifiOff, Wine, Wrench, X, type LucideIcon } from "lucide-react";
import { MINIBAR, QUICK_ISSUES, pendingCount, type Hk, type Lang, type Task, type TaskType } from "./model";

export const TYPE_ICON: Record<TaskType, LucideIcon> = { departure: LogOut, stayover: BedDouble, arrival: LogIn, linen: Layers };
export const TYPE_HUE: Record<TaskType, string> = { departure: "#e2552b", stayover: "#0071e3", arrival: "#1fa971", linen: "#7c5cff" };

export function stateTone(t: Task) {
  if (t.state === "done") return "bg-success/15 text-success";
  if (t.state === "skipped") return "bg-ink-10 text-ink-60";
  if (t.state === "doing") return "bg-accent/15 text-accent";
  return "bg-surface-2 text-ink";
}

export function Flags({ t, hk }: { t: Task; hk: Hk }) {
  return (
    <>
      {t.flag === "waiting" && <span className="flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger"><Hourglass size={12} />{hk.t.waiting}</span>}
      {t.flag === "vip" && <span className="flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning"><Star size={12} />VIP</span>}
      {t.changed && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">{hk.t.changed}</span>}
      {t.pending && <span className="flex items-center gap-1 rounded-full bg-ink-10 px-2 py-0.5 text-[11px] text-ink-60"><WifiOff size={11} />{hk.t.sync}</span>}
    </>
  );
}

export function StateMark({ t }: { t: Task }) {
  if (t.state === "done") return t.clean === "inspected" ? <CheckCheck size={20} className="text-success" /> : <Check size={20} className="text-success" />;
  if (t.state === "skipped") return t.skipReason === "dnd" ? <DoorClosed size={20} className="text-ink-60" /> : <Ban size={20} className="text-ink-60" />;
  if (t.state === "doing") return <Play size={20} className="text-accent" />;
  return null;
}

export function PhoneHeader({ hk }: { hk: Hk }) {
  const mine = hk.mine;
  const left = mine.filter((x) => x.state === "open" || x.state === "doing").reduce((a, x) => a + x.minutes, 0);
  const done = mine.filter((x) => x.state === "done" || x.state === "skipped").length;
  const next: Record<Lang, Lang> = { en: "de", de: "pl", pl: "en" };
  return (
    <div className="shrink-0 px-4 pb-2 pt-12">
      <div className="flex items-center gap-2">
        <span className="grid size-10 place-items-center rounded-full bg-accent text-[14px] font-medium text-white">An</span>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-semibold leading-tight tracking-tight">{hk.role === "housekeeper" ? hk.t.mine : hk.t.queue}</div>
          {hk.role === "housekeeper" && <div className="flex items-center gap-1 text-[13px] text-ink-60"><Clock size={13} />{done}/{mine.length} · {left} {hk.t.left}</div>}
        </div>
        <button onClick={() => hk.setLang(next[hk.lang])} aria-label="Language" className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium uppercase shadow-pill"><Languages size={16} />{hk.lang}</button>
      </div>
      {!hk.online && <div className="mt-2 flex items-start gap-2 rounded-[14px] bg-warning/20 p-2.5 text-[13px]"><WifiOff size={16} className="mt-0.5 shrink-0" /><span>{hk.t.offline} ({pendingCount(hk)})</span></div>}
    </div>
  );
}

export function RoomSheet({ hk }: { hk: Hk }) {
  const [panel, setPanel] = useState<"main" | "issue" | "lost">("main");
  const t = hk.tasks.find((x) => x.id === hk.open);
  if (!t) return null;
  const Icon = TYPE_ICON[t.type];
  const close = () => { hk.setOpen(null); setPanel("main"); };
  const big = "flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-[18px] text-[13px] font-medium active:scale-[0.98]";
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40" onClick={close}>
      <div className="max-h-[88%] overflow-auto rounded-t-[30px] bg-canvas p-4 pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-ink-20" />
        <div className="flex items-center gap-3">
          <span className="grid size-14 place-items-center rounded-[16px]" style={{ background: `color-mix(in srgb, ${TYPE_HUE[t.type]} 16%, transparent)`, color: TYPE_HUE[t.type] }}><Icon size={28} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[34px] font-semibold leading-none tracking-tight">{t.room}</div>
            <div className="mt-1 text-[14px] text-ink-60">{hk.t[t.type]} · {t.minutes} min{t.guest && ` · ${t.guest}, ${t.pax ?? 1}p, ${hk.t.until} ${t.until}`}</div>
          </div>
          <button aria-label="Close" onClick={close} className="grid size-10 place-items-center rounded-full bg-surface shadow-pill"><X size={18} /></button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5"><Flags t={t} hk={hk} /></div>
        {t.note && <div className="mt-2 flex items-start gap-2 rounded-[14px] bg-surface p-3 text-[14px] shadow-card"><TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />{t.note}</div>}

        {panel === "main" && (
          <>
            <div className="mt-4 flex gap-2">
              {t.state === "open" && <button onClick={() => hk.start(t.id)} className={`${big} bg-accent text-white`}><Play size={22} />{hk.t.start}</button>}
              {(t.state === "open" || t.state === "doing") && <button onClick={() => { hk.finish(t.id); close(); }} className={`${big} bg-success text-white`}><Check size={22} />{hk.t.done}</button>}
              {(t.state === "done" || t.state === "skipped") && <button onClick={() => hk.reopen(t.id)} className={`${big} bg-surface shadow-pill`}>Undo</button>}
            </div>
            {t.type !== "departure" && t.type !== "arrival" && (t.state === "open" || t.state === "doing") && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => { hk.skip(t.id, "declined"); close(); }} className={`${big} bg-surface shadow-pill`}><Ban size={20} />{hk.t.declined}</button>
                <button onClick={() => { hk.skip(t.id, "dnd"); close(); }} className={`${big} bg-surface shadow-pill`}><DoorClosed size={20} />{hk.t.dnd}</button>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-ink-60"><Wine size={15} />{hk.t.minibar}</div>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {MINIBAR.map((m) => (
                <div key={m} className="flex h-12 items-center gap-1 rounded-[14px] bg-surface pl-3 pr-1 shadow-card">
                  <span className="flex-1 text-[14px]">{m}</span>
                  <button aria-label={`Less ${m}`} onClick={() => hk.minibar(t.id, m, -1)} className="grid size-9 place-items-center rounded-full hover:bg-ink-5"><Minus size={16} /></button>
                  <span className="w-5 text-center text-[15px] font-semibold">{t.minibar[m] ?? 0}</span>
                  <button aria-label={`More ${m}`} onClick={() => hk.minibar(t.id, m, 1)} className="grid size-9 place-items-center rounded-full bg-ink-5"><Plus size={16} /></button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setPanel("issue")} className={`${big} bg-surface shadow-pill`}><Wrench size={20} />{hk.t.issue}</button>
              <button onClick={() => setPanel("lost")} className={`${big} bg-surface shadow-pill`}><PackageSearch size={20} />{hk.t.lost}</button>
            </div>
          </>
        )}
        {panel !== "main" && (
          <div className="mt-4">
            <div className="text-[15px] font-semibold">{panel === "issue" ? hk.t.issue : hk.t.lost}</div>
            <button className="mt-2 flex h-24 w-full flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed border-ink-20 text-[13px] text-ink-60"><Camera size={24} />{hk.t.photo}</button>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(panel === "issue" ? QUICK_ISSUES : ["Phone", "Charger", "Clothing", "Jewellery", "Document", "Other"]).map((q) => (
                <button key={q} onClick={() => { hk.report(`Room ${t.room}`, panel === "issue" ? q : `Found: ${q}`); setPanel("main"); }} className="h-12 rounded-[14px] bg-surface text-[14px] shadow-card active:scale-[0.98]">{q}</button>
              ))}
            </div>
            <button onClick={() => setPanel("main")} className="mt-3 h-12 w-full rounded-full text-[14px] text-ink-60">Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MaintenanceQueue({ hk }: { hk: Hk }) {
  const order = { now: 0, today: 1, later: 2 } as const;
  const tone = { now: "bg-danger/15 text-danger", today: "bg-warning/20 text-warning", later: "bg-ink-10 text-ink-60" } as const;
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 pb-6">
      {[...hk.issues].sort((a, b) => (a.state === "done" ? 1 : 0) - (b.state === "done" ? 1 : 0) || order[a.urgency] - order[b.urgency]).map((i) => (
        <div key={i.id} className={`rounded-[18px] bg-surface p-3 shadow-card ${i.state === "done" ? "opacity-50" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="text-[17px] font-semibold tracking-tight">{i.place}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${tone[i.urgency]}`}>{i.urgency}</span>
            {i.block && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-canvas">{i.block}</span>}
            {i.pending && <WifiOff size={13} className="text-ink-60" />}
          </div>
          <div className="mt-0.5 text-[14px]">{i.text}</div>
          <div className="text-[12px] text-ink-60">reported by {i.by}</div>
          {i.state !== "done" && (
            <div className="mt-2 flex gap-2">
              {i.state === "open" && <button onClick={() => hk.issueState(i.id, "doing")} className="h-11 flex-1 rounded-full bg-accent text-[14px] font-medium text-white">{hk.t.take}</button>}
              <button onClick={() => hk.issueState(i.id, "done")} className="h-11 flex-1 rounded-full bg-success text-[14px] font-medium text-white">{hk.t.fixed}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
