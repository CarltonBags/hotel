"use client";
// PROTOTYPE shared bulk edit panel with preview, change log and sync state. Same in every variant.
import { Check, CircleCheck, History, Link2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { DAYS, WD, dayInfo, rowLabel, type R, type Restr } from "./model";

const RESTR: [keyof Restr, string, boolean][] = [["stop", "Stop sell", false], ["cta", "Closed to arrival", false], ["ctd", "Closed to departure", false], ["minArr", "Min stay on arrival", true], ["minThru", "Min stay through", true], ["maxStay", "Max stay", true]];

export function SyncState({ r }: { r: R }) {
  return r.pending > 0
    ? <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-[12px] font-medium text-accent"><RefreshCw size={13} className="animate-spin" />Sending {r.pending} change{r.pending > 1 ? "s" : ""} to channels</span>
    : <span className="flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-[12px] font-medium text-success"><CircleCheck size={13} />Channels up to date · {r.synced}</span>;
}

export function Warnings({ r }: { r: R }) {
  if (!r.ends.length) return null;
  return <div className="flex items-center gap-2 border-b border-ink-10 bg-warning/10 px-5 py-2 text-[13px]"><TriangleAlert size={15} className="shrink-0 text-warning" />{r.ends.map((e) => `${rowLabel(e.row)}: prices end on ${dayInfo(e.last).date} ${dayInfo(e.last).month}`).slice(0, 2).join(" · ")}{r.ends.length > 2 && ` · and ${r.ends.length - 2} more`}. Guests cannot book later dates on these rates.</div>;
}

export function BulkPanel({ r }: { r: R }) {
  const s = r.sel, b = r.bulk;
  const pv = r.preview(s, b);
  const seg = (on: boolean) => `h-9 flex-1 rounded-[10px] text-[13px] ${on ? "bg-ink text-canvas" : "bg-surface-2 text-ink-80 hover:bg-ink-5"}`;
  const inp = "h-9 w-full rounded-[10px] border border-ink-10 bg-surface-2 px-3 text-[14px]";
  const nothing = b.action === "none" && !b.restr.key;
  return (
    <aside className="flex w-[330px] shrink-0 flex-col border-l border-ink-10">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold tracking-tight">Bulk edit</h2>{s && <button aria-label="Clear selection" onClick={() => r.setSel(null)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5"><X size={15} /></button>}</div>
        {!s ? <p className="mt-2 text-[13px] text-ink-60">Select cells by dragging, or click a row name to select the whole row. Then set what should change.</p> : (
          <div className="mt-2 space-y-3">
            <div className="rounded-[12px] bg-surface-2 p-3 text-[13px]">
              <div className="font-medium">{dayInfo(Math.min(s.from, s.to)).date} {dayInfo(Math.min(s.from, s.to)).month} to {dayInfo(Math.max(s.from, s.to)).date} {dayInfo(Math.max(s.from, s.to)).month}</div>
              <ul className="mt-1 space-y-0.5 text-ink-60">{s.rows.slice(0, 5).map((k) => <li key={k} className="flex items-center gap-1">{r.derived(k) && <Link2 size={12} />}{rowLabel(k)}</li>)}{s.rows.length > 5 && <li>and {s.rows.length - 5} more rows</li>}</ul>
            </div>
            <div><div className="mb-1 text-[12px] font-semibold text-ink-60">Weekdays</div><div className="flex gap-1">{WD.map((w, i) => <button key={w} onClick={() => r.setBulk({ ...b, weekdays: b.weekdays.map((x, k) => (k === i ? !x : x)) })} className={`h-9 flex-1 rounded-[10px] text-[12px] ${b.weekdays[i] ? "bg-ink text-canvas" : "bg-surface-2 text-ink-40"}`}>{w}</button>)}</div></div>
            <div><div className="mb-1 text-[12px] font-semibold text-ink-60">Price</div>
              <div className="flex gap-1">{([["none", "Keep"], ["set", "Set"], ["amount", "± €"], ["percent", "± %"]] as const).map(([k, l]) => <button key={k} onClick={() => r.setBulk({ ...b, action: k })} className={seg(b.action === k)}>{l}</button>)}</div>
              {b.action !== "none" && <input type="number" autoFocus value={b.value || ""} onChange={(e) => r.setBulk({ ...b, value: Number(e.target.value) })} placeholder={b.action === "set" ? "New price" : "e.g. -10"} className={`${inp} mt-1.5`} />}
            </div>
            <div><div className="mb-1 text-[12px] font-semibold text-ink-60">Restriction</div>
              <select value={b.restr.key} onChange={(e) => { const k = e.target.value as keyof Restr | ""; const num = RESTR.find((x) => x[0] === k)?.[2]; r.setBulk({ ...b, restr: { key: k, value: num ? 2 : true } }); }} className={inp}>
                <option value="">No change</option>{RESTR.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {b.restr.key && (RESTR.find((x) => x[0] === b.restr.key)![2]
                ? <input type="number" min={0} value={Number(b.restr.value)} onChange={(e) => r.setBulk({ ...b, restr: { ...b.restr, value: Number(e.target.value) } })} className={`${inp} mt-1.5`} />
                : <div className="mt-1.5 flex gap-1"><button onClick={() => r.setBulk({ ...b, restr: { ...b.restr, value: true } })} className={seg(b.restr.value === true)}>Switch on</button><button onClick={() => r.setBulk({ ...b, restr: { ...b.restr, value: false } })} className={seg(b.restr.value === false)}>Switch off</button></div>)}
              {b.restr.key && Number(b.restr.value) === 0 && <div className="mt-1 text-[12px] text-ink-60">0 removes the restriction.</div>}
            </div>
            {pv && !nothing && (
              <div className="rounded-[12px] border border-ink-10 p-3 text-[13px]">
                <div className="font-semibold">Before you apply</div>
                <div className="mt-1 text-ink-80">{pv.cells} cells in {pv.rows} base row{pv.rows > 1 ? "s" : ""} will change.{pv.min !== null && b.action !== "none" && ` New prices from ${pv.min} to ${pv.max}.`}</div>
                {pv.follow > 0 && <div className="mt-1 flex items-start gap-1.5 text-ink-60"><Link2 size={13} className="mt-0.5 shrink-0" />{pv.follow} derived row{pv.follow > 1 ? "s" : ""} follow automatically.</div>}
                {pv.skippedDerived > 0 && <div className="mt-1 text-ink-60">{pv.skippedDerived} selected derived row{pv.skippedDerived > 1 ? "s are" : " is"} changed through the base rate.</div>}
                {pv.below > 0 && <div className="mt-1 flex items-start gap-1.5 text-danger"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{pv.below} cell{pv.below > 1 ? "s" : ""} fall below the Price Floor.</div>}
                {pv.conflict > 0 && <div className="mt-1 flex items-start gap-1.5 text-danger"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{pv.conflict} cell{pv.conflict > 1 ? "s" : ""}: minimum stay longer than maximum stay.</div>}
              </div>
            )}
            <button disabled={nothing || !pv?.cells} onClick={r.apply} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-medium text-white disabled:opacity-30"><Check size={16} />Apply to {pv?.cells ?? 0} cells</button>
          </div>
        )}
        <div className="mt-5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-60"><History size={14} />Changes</div>
        <ul className="mt-1 space-y-1.5 text-[12px]">{r.log.length === 0 && <li className="text-ink-40">Nothing changed yet. Horizon shown: {DAYS} days.</li>}{r.log.map((l, i) => <li key={i}><span className="font-mono text-ink-40">{l.at}</span> <span className="text-ink-80">{l.text}</span> <span className="text-ink-40">· Carlton B.</span></li>)}</ul>
      </div>
    </aside>
  );
}
