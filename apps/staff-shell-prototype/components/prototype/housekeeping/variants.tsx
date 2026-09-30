"use client";
// PROTOTYPE the three task overviews for the housekeeper's phone.
import { ChevronRight } from "lucide-react";
import type { Hk, Task } from "./model";
import { Flags, StateMark, TYPE_HUE, TYPE_ICON, stateTone } from "./parts";

const rank = (t: Task) => (t.state === "done" || t.state === "skipped" ? 3 : t.changed ? 0 : t.flag === "waiting" ? 0 : t.state === "doing" ? 1 : 2);

// A: list grouped by Section, priority rooms first inside each group.
export const nameA = "List by section";
export function OverviewA({ hk }: { hk: Hk }) {
  const sections = Array.from(new Set(hk.mine.map((t) => t.section)));
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
      {sections.map((s) => (
        <div key={s} className="mb-3">
          <div className="sticky top-0 z-10 bg-canvas py-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{s}</div>
          <div className="space-y-1.5">
            {hk.mine.filter((t) => t.section === s).sort((a, b) => rank(a) - rank(b)).map((t) => {
              const Icon = TYPE_ICON[t.type];
              return (
                <button key={t.id} onClick={() => hk.setOpen(t.id)} className={`flex w-full items-center gap-3 rounded-[18px] p-3 text-left shadow-card active:scale-[0.99] ${stateTone(t)}`}>
                  <span className="grid size-11 shrink-0 place-items-center rounded-[13px]" style={{ background: `color-mix(in srgb, ${TYPE_HUE[t.type]} 16%, transparent)`, color: TYPE_HUE[t.type] }}><Icon size={22} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="text-[22px] font-semibold leading-none tracking-tight">{t.room}</span><span className="text-[13px] text-ink-60">{hk.t[t.type]} · {t.minutes}′</span></span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">{t.guest && <span className="text-[13px] text-ink-60">{t.guest}</span>}<Flags t={t} hk={hk} /></span>
                  </span>
                  <StateMark t={t} />
                  <ChevronRight size={18} className="text-ink-40" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// B: one room at a time. The next room fills the screen; the rest is a strip.
export const nameB = "One room at a time";
export function OverviewB({ hk }: { hk: Hk }) {
  const todo = hk.mine.filter((t) => t.state === "open" || t.state === "doing").sort((a, b) => rank(a) - rank(b));
  const cur = todo[0];
  const total = hk.mine.length;
  const done = total - todo.length;
  if (!cur) return <div className="grid flex-1 place-items-center text-center text-[22px] font-semibold text-success">All rooms done</div>;
  const Icon = TYPE_ICON[cur.type];
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-5">
      <div className="h-2 overflow-hidden rounded-full bg-ink-10"><div className="h-full rounded-full bg-success transition-all duration-300" style={{ width: `${(done / total) * 100}%` }} /></div>
      <button onClick={() => hk.setOpen(cur.id)} className="mt-3 flex flex-1 flex-col items-center justify-center rounded-[30px] bg-surface p-5 text-center shadow-card active:scale-[0.99]">
        <span className="grid size-16 place-items-center rounded-[20px]" style={{ background: `color-mix(in srgb, ${TYPE_HUE[cur.type]} 16%, transparent)`, color: TYPE_HUE[cur.type] }}><Icon size={32} /></span>
        <span className="mt-3 text-[88px] font-semibold leading-none tracking-tight">{cur.room}</span>
        <span className="mt-2 text-[17px] text-ink-60">{hk.t[cur.type]} · {cur.minutes} min</span>
        {cur.guest && <span className="text-[15px] text-ink-60">{cur.guest}, {cur.pax ?? 1}p, {hk.t.until} {cur.until}</span>}
        <span className="mt-2 flex flex-wrap justify-center gap-1.5"><Flags t={cur} hk={hk} /></span>
        {cur.note && <span className="mt-2 rounded-[12px] bg-warning/15 px-3 py-1.5 text-[14px]">{cur.note}</span>}
      </button>
      <div className="mt-3 flex gap-2">
        {cur.state === "open" && <button onClick={() => hk.start(cur.id)} className="h-16 flex-1 rounded-[20px] bg-accent text-[18px] font-semibold text-white active:scale-[0.98]">{hk.t.start}</button>}
        <button onClick={() => hk.finish(cur.id)} className="h-16 flex-1 rounded-[20px] bg-success text-[18px] font-semibold text-white active:scale-[0.98]">{hk.t.done}</button>
      </div>
      <div className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{hk.t.next}</div>
      <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
        {todo.slice(1).map((t) => { const I = TYPE_ICON[t.type]; return <button key={t.id} onClick={() => hk.setOpen(t.id)} className="flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[16px] font-semibold shadow-pill"><I size={16} style={{ color: TYPE_HUE[t.type] }} />{t.room}</button>; })}
      </div>
    </div>
  );
}

// C: tile board. Every room is a tile, colour and icon carry the meaning, almost no text.
export const nameC = "Tile board";
export function OverviewC({ hk }: { hk: Hk }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
      <div className="grid grid-cols-3 gap-2">
        {[...hk.mine].sort((a, b) => rank(a) - rank(b)).map((t) => {
          const Icon = TYPE_ICON[t.type];
          const off = t.state === "done" || t.state === "skipped";
          return (
            <button key={t.id} onClick={() => hk.setOpen(t.id)} className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-[22px] shadow-card active:scale-[0.97] ${off ? "bg-ink-5 text-ink-40" : "text-white"}`} style={off ? undefined : { background: TYPE_HUE[t.type] }}>
              <Icon size={24} />
              <span className="text-[26px] font-semibold leading-none tracking-tight">{t.room}</span>
              <span className="text-[12px] opacity-80">{t.minutes}′</span>
              <span className="absolute right-2 top-2"><StateMark t={t} /></span>
              {(t.flag === "waiting" || t.changed) && !off && <span className="absolute left-2 top-2 size-3.5 rounded-full bg-white ring-2 ring-danger" />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-60">
        {(["departure", "stayover", "arrival", "linen"] as const).map((k) => <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: TYPE_HUE[k] }} />{hk.t[k]}</span>)}
      </div>
    </div>
  );
}
