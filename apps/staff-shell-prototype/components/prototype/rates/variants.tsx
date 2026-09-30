"use client";
// PROTOTYPE the three structures of the Rates screen. The bulk edit panel is shared and lives outside these.
import { useEffect, useRef, useState } from "react";
import { Link2, TriangleAlert } from "lucide-react";
import { DAYS, PLANS, ROWS, TODAY, TYPES, dayInfo, marks, modText, type R } from "./model";

const hatch = { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-ink-10) 5px 10px)" };
const inSel = (r: R, key: string, d: number) => !!r.sel && r.sel.rows.includes(key) && d >= Math.min(r.sel.from, r.sel.to) && d <= Math.max(r.sel.from, r.sel.to);

// A: spreadsheet grid. Rows are rate plan by room type, columns are dates. Drag to select, type to edit, arrows to move.
export const nameA = "Spreadsheet grid";
const LEFT = 236, CW = 66, RH = 42;
export function GridA({ r }: { r: R }) {
  const [focus, setFocus] = useState({ i: 0, d: TODAY });
  const [edit, setEdit] = useState<string | null>(null);
  const [hint, setHint] = useState("Click a cell and type a price. Arrow keys move, Enter goes down, Tab goes right, Shift with arrows selects, Esc cancels.");
  const anchor = useRef<{ i: number; d: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const up = () => (anchor.current = null); window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);

  const select = (a: { i: number; d: number }, b: { i: number; d: number }) => r.setSel({ rows: ROWS.slice(Math.min(a.i, b.i), Math.max(a.i, b.i) + 1).map((x) => x.key), from: a.d, to: b.d });
  const commit = () => {
    if (edit === null) return;
    const key = ROWS[focus.i].key, v = Number(edit);
    if (edit !== "" && !Number.isNaN(v) && v >= 0) { r.setCell(key, focus.d, v); if (v < r.floor(key)) setHint(`${v} is below the Price Floor of ${r.floor(key)} for ${ROWS[focus.i].type.name}. Saved, and flagged for the Property Manager.`); }
    setEdit(null);
  };
  const move = (di: number, dd: number, extend = false) => {
    const n = { i: Math.max(0, Math.min(ROWS.length - 1, focus.i + di)), d: Math.max(0, Math.min(DAYS - 1, focus.d + dd)) };
    setFocus(n);
    if (extend) { const a = anchor.current ?? focus; anchor.current = a; select(a, n); anchor.current = a; } else select(n, n);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (edit !== null) {
      if (e.key === "Enter") { e.preventDefault(); commit(); move(1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); setEdit(null); }
      return;
    }
    const k: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (k[e.key]) { e.preventDefault(); e.stopPropagation(); move(k[e.key][0], k[e.key][1], e.shiftKey); if (!e.shiftKey) anchor.current = null; }
    else if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === "Enter") { e.preventDefault(); start(""); }
    else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); start(e.key); }
  };
  const start = (v: string) => {
    const key = ROWS[focus.i].key;
    if (r.derived(key)) return setHint(`${ROWS[focus.i].plan.name} follows its base rate (${modText(ROWS[focus.i].plan)}). Edit ${PLANS.find((p) => p.id === ROWS[focus.i].plan.parent)!.name} instead.`);
    setEdit(v === "" ? String(r.get(key, focus.d) ?? "") : v);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={box} tabIndex={0} onKeyDown={onKey} className="min-h-0 flex-1 overflow-auto outline-none">
        <div style={{ width: LEFT + DAYS * CW }}>
          <div className="sticky top-0 z-20 flex h-11 border-b border-ink-10 bg-surface">
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: LEFT }} />
            {Array.from({ length: DAYS }, (_, d) => dayInfo(d)).map((i, d) => <div key={d} className={`flex shrink-0 flex-col items-center justify-center text-[11px] leading-tight ${d === TODAY ? "font-semibold text-accent" : i.weekend ? "text-ink-80" : "text-ink-60"} ${i.event ? "bg-warning/15" : i.weekend ? "bg-ink-5" : ""}`} style={{ width: CW }}><span>{i.wd}</span><span className="text-[12px]">{i.date} {i.month}</span></div>)}
          </div>
          {PLANS.map((p) => (
            <div key={p.id}>
              <div className="flex h-8 border-b border-ink-10 bg-surface-2">
                <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-surface-2 px-4 text-[13px] font-semibold" style={{ width: LEFT + 400 }}>{p.name}{p.mod && <span className="flex items-center gap-1 font-normal text-ink-60"><Link2 size={12} />follows {modText(p)}</span>}</div>
              </div>
              {ROWS.map((row, i) => row.plan.id !== p.id ? null : (
                <div key={row.key} className="flex border-b border-ink-5" style={{ height: RH }}>
                  <button onClick={() => { r.setSel({ rows: [row.key], from: 0, to: DAYS - 1 }); setFocus({ i, d: focus.d }); }} className="sticky left-0 z-10 flex shrink-0 items-center justify-between bg-surface px-4 text-left text-[13px] hover:bg-ink-5" style={{ width: LEFT }}><span>{row.type.name}</span><span className="text-[11px] text-ink-40">floor {row.type.floor}</span></button>
                  {Array.from({ length: DAYS }, (_, d) => {
                    const v = r.get(row.key, d), m = marks(r.getR(row.key, d)), rr = r.getR(row.key, d);
                    const f = focus.i === i && focus.d === d, s = inSel(r, row.key, d), low = v !== null && v < row.type.floor, der = r.derived(row.key);
                    return (
                      <div key={d}
                        onMouseDown={(e) => { e.preventDefault(); box.current?.focus(); if (edit !== null) commit(); const c = { i, d }; if (e.shiftKey && anchor.current === null) select(focus, c); else { anchor.current = c; select(c, c); } setFocus(c); }}
                        onMouseEnter={() => { if (anchor.current) select(anchor.current, { i, d }); }}
                        onDoubleClick={() => start("")}
                        className={`relative flex shrink-0 cursor-cell select-none flex-col items-center justify-center border-r border-ink-5 leading-tight ${s ? "bg-accent/12" : dayInfo(d).event ? "bg-warning/8" : ""} ${f ? "z-10 outline outline-2 -outline-offset-2 outline-accent" : ""}`}
                        style={{ width: CW, ...(rr.stop ? hatch : {}) }}>
                        {f && edit !== null
                          ? <input autoFocus value={edit} onChange={(e) => setEdit(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} className="h-full w-full bg-surface text-center text-[14px] font-semibold outline-none" />
                          : <><span className={`text-[14px] ${der ? "text-ink-60" : "font-medium"} ${low ? "text-danger" : ""}`}>{v ?? "—"}{low && <TriangleAlert size={10} className="ml-0.5 inline" />}</span>{m.length > 0 && <span className="text-[9px] font-semibold tracking-tight text-ink-60">{m.join(" ")}</span>}</>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center border-t border-ink-10 px-5 text-[12px] text-ink-60">{hint}</div>
    </div>
  );
}

// B: month calendar. One rate plan and room type at a time, shown as a calendar of large day tiles. Drag across days to select.
export const nameB = "Month calendar per rate";
export function CalendarB({ r }: { r: R }) {
  const [row, setRow] = useState(ROWS[0].key);
  const [all, setAll] = useState(false);
  const down = useRef<number | null>(null);
  useEffect(() => { const up = () => (down.current = null); window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, []);
  const cur = ROWS.find((x) => x.key === row)!;
  const rows = all ? ROWS.filter((x) => x.plan.id === cur.plan.id).map((x) => x.key) : [row];
  const offset = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].indexOf(dayInfo(0).wd);
  return (
    <div className="flex min-w-0 flex-1">
      <div className="w-[230px] shrink-0 overflow-auto border-r border-ink-10 p-2">
        {PLANS.map((p) => (
          <div key={p.id} className="mb-2">
            <div className="px-2 py-1 text-[12px] font-semibold text-ink-60">{p.name}{p.mod && <span className="block font-normal text-ink-40">follows {modText(p)}</span>}</div>
            {TYPES.map((t) => { const k = `${p.id}|${t.id}`; return <button key={k} onClick={() => { setRow(k); r.setSel(null); }} className={`flex h-9 w-full items-center rounded-[10px] px-3 text-left text-[13px] ${row === k ? "bg-ink text-canvas" : "hover:bg-ink-5"}`}>{t.name}</button>; })}
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        <div className="flex items-center gap-3"><h2 className="text-[18px] font-semibold tracking-tight">{cur.plan.name} · {cur.type.name}</h2><label className="flex items-center gap-1.5 text-[13px] text-ink-60"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />apply to all room types of this rate</label></div>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => <div key={w} className="px-1 text-[12px] font-semibold text-ink-40">{w}</div>)}
          {Array.from({ length: offset }, (_, k) => <div key={`o${k}`} />)}
          {Array.from({ length: DAYS }, (_, d) => {
            const i = dayInfo(d), v = r.get(row, d), rr = r.getR(row, d), m = marks(rr), s = inSel(r, row, d), low = v !== null && v < cur.type.floor;
            return (
              <button key={d}
                onMouseDown={() => { down.current = d; r.setSel({ rows, from: d, to: d }); }}
                onMouseEnter={() => { if (down.current !== null) r.setSel({ rows, from: down.current, to: d }); }}
                className={`flex h-[76px] select-none flex-col rounded-[14px] p-2 text-left ${s ? "bg-accent/15 ring-2 ring-accent" : i.event ? "bg-warning/15" : i.weekend ? "bg-ink-5" : "bg-surface-2"} ${d < TODAY ? "opacity-40" : ""}`} style={rr.stop ? hatch : undefined}>
                <span className={`text-[12px] ${d === TODAY ? "font-semibold text-accent" : "text-ink-60"}`}>{i.date} {i.date === 1 || d === 0 ? i.month : ""}</span>
                <span className={`text-[19px] font-semibold leading-tight tracking-tight ${low ? "text-danger" : ""}`}>{v ?? "—"}</span>
                <span className="text-[10px] font-semibold text-ink-60">{m.join(" ")}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// C: price periods. Consecutive days with the same price merge into one block, so the screen shows price changes, not days.
export const nameC = "Price periods";
const DW = 26;
export function PeriodsC({ r }: { r: R }) {
  return (
    <div className="min-w-0 flex-1 overflow-auto">
      <div style={{ width: LEFT + DAYS * DW + 24 }}>
        <div className="sticky top-0 z-20 flex h-9 border-b border-ink-10 bg-surface">
          <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: LEFT }} />
          {Array.from({ length: DAYS }, (_, d) => dayInfo(d)).map((i, d) => <div key={d} className={`flex shrink-0 items-center justify-center text-[10px] ${d === TODAY ? "font-bold text-accent" : i.weekend ? "text-ink-80" : "text-ink-40"} ${i.event ? "bg-warning/15" : ""}`} style={{ width: DW }}>{i.date}</div>)}
        </div>
        {PLANS.map((p) => (
          <div key={p.id}>
            <div className="flex h-8 items-center gap-2 border-b border-ink-10 bg-surface-2 px-4 text-[13px] font-semibold">{p.name}{p.mod && <span className="flex items-center gap-1 font-normal text-ink-60"><Link2 size={12} />follows {modText(p)}</span>}</div>
            {ROWS.filter((x) => x.plan.id === p.id).map((row) => {
              const runs: { from: number; to: number; v: number | null }[] = [];
              for (let d = 0; d < DAYS; d++) { const v = r.get(row.key, d); const last = runs[runs.length - 1]; if (last && last.v === v) last.to = d; else runs.push({ from: d, to: d, v }); }
              return (
                <div key={row.key} className="flex border-b border-ink-5">
                  <button onClick={() => r.setSel({ rows: [row.key], from: 0, to: DAYS - 1 })} className="sticky left-0 z-10 flex h-[58px] shrink-0 items-center justify-between bg-surface px-4 text-left text-[13px] hover:bg-ink-5" style={{ width: LEFT }}><span>{row.type.name}</span><span className="text-[11px] text-ink-40">floor {row.type.floor}</span></button>
                  <div className="relative h-[58px] shrink-0" style={{ width: DAYS * DW }}>
                    {runs.map((u) => {
                      const s = !!r.sel && r.sel.rows.includes(row.key) && Math.min(r.sel.from, r.sel.to) <= u.from && Math.max(r.sel.from, r.sel.to) >= u.to;
                      const low = u.v !== null && u.v < row.type.floor;
                      const w = (u.to - u.from + 1) * DW - 3;
                      return <button key={u.from} onClick={(e) => r.setSel(e.shiftKey && r.sel ? { rows: Array.from(new Set([...r.sel.rows, row.key])), from: Math.min(r.sel.from, r.sel.to, u.from), to: Math.max(r.sel.from, r.sel.to, u.to) } : { rows: [row.key], from: u.from, to: u.to })} title={`${dayInfo(u.from).date} ${dayInfo(u.from).month} to ${dayInfo(u.to).date} ${dayInfo(u.to).month}: ${u.v ?? "no price"}`}
                        className={`absolute top-1.5 flex h-8 items-center justify-center overflow-hidden rounded-[9px] text-[13px] font-semibold ${u.v === null ? "border border-dashed border-warning text-warning" : low ? "bg-danger/20 text-danger" : s ? "bg-accent text-white" : "bg-ink-10 text-ink"} ${s && u.v === null ? "ring-2 ring-accent" : ""}`} style={{ left: u.from * DW + 1, width: w }}>{w > 30 ? u.v ?? "—" : ""}</button>;
                    })}
                    {Array.from({ length: DAYS }, (_, d) => { const m = marks(r.getR(row.key, d)); return m.length ? <span key={d} title={m.join(" ")} className={`absolute bottom-1.5 h-2 rounded-full ${r.getR(row.key, d).stop ? "bg-danger" : "bg-warning"}`} style={{ left: d * DW + 3, width: DW - 6 }} /> : null; })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <div className="flex gap-4 px-4 py-3 text-[12px] text-ink-60"><span>Click a block to select its period. Shift-click adds blocks and rows.</span><span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-warning" />restriction</span><span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-danger" />stop sell</span></div>
      </div>
    </div>
  );
}
