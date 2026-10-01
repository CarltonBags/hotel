"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, CircleDashed, History, Link2, TriangleAlert, Undo2, X } from "lucide-react";
import {
  OPEN_RESTRICTION,
  RESTRICTION_FIELDS,
  addDays,
  cellKey,
  datesFrom,
  localeFor,
  planBulkEdit,
  weekdayIndex,
  type BulkEdit,
  type Derivation,
  type Language,
  type PriceAction,
  type Restriction,
  type RestrictionField,
} from "@hoteloftware/domain";
import type { BelowFloor, PriceEnd, RateChange } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { applyBulk, saveCell, undo, type GridActionState } from "./actions";
import type { GridCell, GridRowView } from "./grid-data";

interface PlanInfo {
  id: string;
  code: string;
  name: string;
  basePlanId: string | null;
  basePlanName: string | null;
  derivation: Derivation | null;
}

interface Props {
  property: { id: string; name: string; currency: string; country: string; timeZone: string };
  today: string;
  from: string;
  days: number;
  rows: GridRowView[];
  cells: Record<string, GridCell>;
  plans: PlanInfo[];
  belowFloor: BelowFloor[];
  priceEnds: PriceEnd[];
  changes: (Omit<RateChange, "at"> & { at: string; userName: string })[];
  language: Language;
  m: Messages;
}

const LEFT = 236;
const CW = 66;
const RH = 42;
const NUMERIC: RestrictionField[] = ["minStayArrival", "minStayThrough", "maxStay"];
const hatch = { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-ink-10) 5px 10px)" };

type Pos = { i: number; d: number };
type Sel = { a: Pos; b: Pos };

function marks(r: Restriction): string[] {
  return [
    r.stopSell && "STOP",
    r.closedToArrival && "CTA",
    r.closedToDeparture && "CTD",
    r.minStayArrival && `${r.minStayArrival}N`,
    r.minStayThrough && `${r.minStayThrough}T`,
    r.maxStay && `≤${r.maxStay}`,
  ].filter((x): x is string => Boolean(x));
}

const showPrice = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function RatesGrid(props: Props) {
  const { property, today, from, days, rows, plans, m, language } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dates = useMemo(() => datesFrom(from, days), [from, days]);
  const locale = localeFor(language, property.country);
  const fmtDay = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }), [locale]);
  const fmtWd = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }), [locale]);
  const day = (d: string) => fmtDay.format(new Date(`${d}T00:00:00Z`));
  const wd = (d: string) => fmtWd.format(new Date(`${d}T00:00:00Z`));
  const weekdayNames = useMemo(() => datesFrom("2026-01-05", 7).map((d) => fmtWd.format(new Date(`${d}T00:00:00Z`))), [fmtWd]);

  // typed prices shown at once, until the refreshed server data arrives
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  useEffect(() => setOverrides({}), [props.cells]);
  const cell = (row: GridRowView, d: string): GridCell => {
    const c = props.cells[cellKey(row.ratePlanId, row.roomTypeId, d)];
    const o = overrides[cellKey(row.ratePlanId, row.roomTypeId, d)];
    return { price: o ?? c?.price ?? null, restriction: c?.restriction ?? OPEN_RESTRICTION, own: c?.own ?? OPEN_RESTRICTION };
  };

  const todayIndex = Math.max(0, dates.indexOf(today));
  const [focus, setFocus] = useState<Pos>({ i: 0, d: todayIndex });
  const [sel, setSel] = useState<Sel | null>(null);
  const [edit, setEditState] = useState<string | null>(null);
  // mirrors `edit` so a commit runs once even when Enter and the input's blur both fire
  const editRef = useRef<string | null>(null);
  const setEdit = (v: string | null) => {
    editRef.current = v;
    setEditState(v);
  };
  const [message, setMessage] = useState<{ kind: "hint" | "warning" | "error"; text: string }>({ kind: "hint", text: m["grid.hint"] });
  const anchor = useRef<Pos | null>(null);
  const dragging = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const report = (r: GridActionState) => {
    if (r.error) setMessage({ kind: "error", text: r.error });
    else if (r.warning) setMessage({ kind: "warning", text: r.warning });
    else if (r.notice) setMessage({ kind: "hint", text: r.notice });
    else setMessage({ kind: "hint", text: m["grid.saved"] });
  };

  const isDerived = (row: GridRowView) => row.basePlanId !== null;
  const planOf = (row: GridRowView) => plans.find((p) => p.id === row.ratePlanId);
  const ruleText = (d: Derivation | null) => (d ? `${d.value > 0 ? "+" : "−"} ${Math.abs(d.value)}${d.kind === "percent" ? " %" : ""}` : "");

  const select = (a: Pos, b: Pos) => setSel({ a, b });
  const move = (di: number, dd: number, extend = false) => {
    const n = { i: Math.max(0, Math.min(rows.length - 1, focus.i + di)), d: Math.max(0, Math.min(dates.length - 1, focus.d + dd)) };
    setFocus(n);
    if (extend) {
      const a = anchor.current ?? focus;
      anchor.current = a;
      select(a, n);
    } else {
      anchor.current = null;
      select(n, n);
    }
  };

  const start = (initial: string) => {
    const row = rows[focus.i];
    if (!row) return;
    if (isDerived(row)) {
      const p = planOf(row);
      setMessage({ kind: "hint", text: fill(m["grid.derivedHint"], { plan: row.ratePlanName, base: p?.basePlanName ?? "", rule: ruleText(row.derivation) }) });
      return;
    }
    const v = cell(row, dates[focus.d]!).price;
    setEdit(initial === "" ? (v === null ? "" : showPrice(v)) : initial);
  };

  const commit = () => {
    const value = editRef.current;
    if (value === null) return;
    const row = rows[focus.i];
    const date = dates[focus.d];
    const raw = value.replace(",", ".");
    setEdit(null);
    // the input unmounts; keep keyboard focus on the grid
    requestAnimationFrame(() => box.current?.focus());
    if (!row || !date || raw === "") return;
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) return setMessage({ kind: "error", text: m["grid.badPrice"] });
    if (price === cell(row, date).price) return;
    setOverrides((o) => ({ ...o, [cellKey(row.ratePlanId, row.roomTypeId, date)]: price }));
    startTransition(async () => {
      report(await saveCell({ propertyId: property.id, ratePlanId: row.ratePlanId, roomTypeId: row.roomTypeId, date, price }));
      router.refresh();
    });
  };

  const runUndo = () =>
    startTransition(async () => {
      report(await undo(property.id));
      router.refresh();
    });

  const onKey = (e: React.KeyboardEvent) => {
    if (edit !== null) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        move(1, 0);
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit();
        move(0, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEdit(null);
        requestAnimationFrame(() => box.current?.focus());
      }
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      move(a[0], a[1], e.shiftKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      start("");
    } else if (/^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      start(e.key);
    } else if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runUndo();
    } else if (e.key === "Escape") {
      setSel(null);
    }
  };

  const inSel = (i: number, d: number) => !!sel && i >= Math.min(sel.a.i, sel.b.i) && i <= Math.max(sel.a.i, sel.b.i) && d >= Math.min(sel.a.d, sel.b.d) && d <= Math.max(sel.a.d, sel.b.d);

  // group rows under their plan heading, keeping each row's index for focus
  const groups = useMemo(() => {
    const out: { plan: PlanInfo; rows: { row: GridRowView; i: number }[] }[] = [];
    rows.forEach((row, i) => {
      let g = out.find((x) => x.plan.id === row.ratePlanId);
      if (!g) {
        g = { plan: plans.find((p) => p.id === row.ratePlanId)!, rows: [] };
        out.push(g);
      }
      g.rows.push({ row, i });
    });
    return out;
  }, [rows, plans]);

  const shift = (n: number) => router.push(`/rates?from=${addDays(from, n)}`);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-ink-10 px-5 py-3">
          <h1 className="text-xl font-medium">{m["module.rates"]}</h1>
          <span className="text-ink-60">· {property.name}</span>
          <span className="flex items-center gap-1.5 rounded-full bg-ink-5 px-3 py-1 text-xs text-ink-80">
            <CircleDashed size={13} />
            {m["grid.syncNotConnected"]}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label={m["grid.prev"]} onClick={() => shift(-14)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => router.push("/rates")} className="h-8 rounded-full px-3 text-sm hover:bg-ink-5">
              {m["grid.today"]}
            </button>
            <button type="button" aria-label={m["grid.next"]} onClick={() => shift(14)} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={runUndo} disabled={pending} className="ml-2 flex h-8 items-center gap-1 rounded-full px-3 text-sm hover:bg-ink-5 disabled:opacity-40">
              <Undo2 size={14} />
              {m["grid.undo"]}
            </button>
          </div>
          <p className="w-full text-xs text-ink-60">
            STOP {m["rates.restriction.stopSell"]} · CTA {m["rates.restriction.closedToArrival"]} · CTD {m["rates.restriction.closedToDeparture"]} · 2N {m["rates.restriction.minStayArrival"]} · 2T{" "}
            {m["rates.restriction.minStayThrough"]} · ≤7 {m["rates.restriction.maxStay"]} · <span className="text-danger">{m["grid.redBelowFloor"]}</span>
          </p>
        </header>
        <EndsBanner ends={props.priceEnds} day={day} m={m} />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {rows.length === 0 ? (
              <p className="p-6 text-ink-60">{m["grid.noPlans"]}</p>
            ) : (
              <div ref={box} tabIndex={0} onKeyDown={onKey} role="grid" aria-label={m["module.rates"]} className="min-h-0 flex-1 overflow-auto outline-none">
                <div style={{ width: LEFT + dates.length * CW }}>
                  <div className="sticky top-0 z-20 flex h-11 border-b border-ink-10 bg-surface">
                    <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: LEFT }} />
                    {dates.map((d) => {
                      const weekend = weekdayIndex(d) >= 5;
                      return (
                        <div
                          key={d}
                          role="columnheader"
                          aria-current={d === today ? "date" : undefined}
                          className={`flex shrink-0 flex-col items-center justify-center text-[11px] leading-tight ${d === today ? "font-semibold text-accent" : weekend ? "text-ink-80" : "text-ink-60"} ${weekend ? "bg-ink-5" : ""}`}
                          style={{ width: CW }}
                        >
                          <span>{wd(d)}</span>
                          <span className="text-[12px]">{day(d)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {groups.map((g) => (
                    <div key={g.plan.id}>
                      <div className="flex h-8 border-b border-ink-10 bg-surface-2">
                        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-surface-2 px-4 text-[13px] font-semibold" style={{ width: LEFT + 400 }}>
                          {g.plan.name}
                          {g.plan.basePlanId ? (
                            <span className="flex items-center gap-1 font-normal text-ink-60">
                              <Link2 size={12} />
                              {fill(m["grid.follows"], { base: g.plan.basePlanName ?? "", rule: ruleText(g.plan.derivation) })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {g.rows.map(({ row, i }) => (
                        <div key={`${row.ratePlanId}|${row.roomTypeId}`} role="row" className="flex border-b border-ink-5" style={{ height: RH }}>
                          <button
                            type="button"
                            onClick={() => {
                              setFocus({ i, d: focus.d });
                              select({ i, d: 0 }, { i, d: dates.length - 1 });
                            }}
                            className="sticky left-0 z-10 flex shrink-0 items-center justify-between bg-surface px-4 text-left text-[13px] hover:bg-ink-5"
                            style={{ width: LEFT }}
                          >
                            <span>{row.roomTypeName}</span>
                            {row.priceFloor !== null ? <span className="text-[11px] text-ink-40">{fill(m["grid.floor"], { value: showPrice(row.priceFloor) })}</span> : null}
                          </button>
                          {dates.map((d, di) => {
                            const c = cell(row, d);
                            const mk = marks(c.restriction);
                            const focused = focus.i === i && focus.d === di;
                            const low = c.price !== null && row.priceFloor !== null && c.price < row.priceFloor;
                            const derived = isDerived(row);
                            return (
                              <div
                                key={d}
                                role="gridcell"
                                data-row={i}
                                data-date={d}
                                aria-selected={inSel(i, di)}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  // focusing the grid blurs an open input, whose blur commits it
                                  box.current?.focus();
                                  const p = { i, d: di };
                                  if (e.shiftKey) select(anchor.current ?? focus, p);
                                  else {
                                    anchor.current = p;
                                    select(p, p);
                                  }
                                  dragging.current = true;
                                  setFocus(p);
                                }}
                                onMouseEnter={() => {
                                  if (dragging.current && anchor.current) select(anchor.current, { i, d: di });
                                }}
                                onDoubleClick={() => start("")}
                                className={`relative flex shrink-0 cursor-cell select-none flex-col items-center justify-center border-r border-ink-5 leading-tight ${inSel(i, di) ? "bg-accent/10" : derived ? "bg-ink-5/40" : ""} ${focused ? "z-10 outline outline-2 -outline-offset-2 outline-accent" : ""}`}
                                style={{ width: CW, ...(c.restriction.stopSell ? hatch : {}) }}
                              >
                                {focused && edit !== null ? (
                                  <input
                                    autoFocus
                                    aria-label={m["grid.price"]}
                                    value={edit}
                                    onChange={(e) => setEdit(e.target.value.replace(/[^0-9.,]/g, ""))}
                                    onBlur={commit}
                                    className="h-full w-full bg-surface text-center text-[14px] font-semibold outline-none"
                                  />
                                ) : (
                                  <>
                                    <span className={`text-[14px] ${derived ? "text-ink-60" : "font-medium"} ${low ? "text-danger" : ""}`}>
                                      {c.price === null ? "—" : showPrice(c.price)}
                                      {low ? <TriangleAlert size={10} className="ml-0.5 inline" aria-label={m["grid.belowFloor"]} /> : null}
                                    </span>
                                    {mk.length ? <span className="text-[9px] font-semibold tracking-tight text-ink-60">{mk.join(" ")}</span> : null}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div
              role={message.kind === "hint" ? "status" : "alert"}
              className={`flex min-h-9 shrink-0 items-center border-t border-ink-10 px-5 text-[12px] ${message.kind === "error" ? "text-danger" : message.kind === "warning" ? "text-warning" : "text-ink-60"}`}
            >
              {pending ? m["action.saving"] : message.text}
            </div>
          </div>
          <BulkPanel
            {...props}
            dates={dates}
            sel={sel}
            clear={() => setSel(null)}
            day={day}
            weekdayNames={weekdayNames}
            cellOf={cell}
            onApplied={(r) => {
              report(r);
              if (r.ok) setSel(null);
              router.refresh();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function EndsBanner({ ends, day, m }: { ends: PriceEnd[]; day: (d: string) => string; m: Messages }) {
  if (ends.length === 0) return null;
  const parts = ends.map((e) => (e.lastDate ? fill(m["grid.endsOn"], { row: `${e.ratePlanName} · ${e.roomTypeCode}`, date: day(e.lastDate) }) : fill(m["grid.noPricesYet"], { row: `${e.ratePlanName} · ${e.roomTypeCode}` })));
  return (
    <div role="note" className="flex items-center gap-2 border-b border-ink-10 bg-warning/10 px-5 py-2 text-[13px]">
      <TriangleAlert size={15} className="shrink-0 text-warning" />
      <span>
        {parts.slice(0, 2).join(" · ")}
        {parts.length > 2 ? ` · ${fill(m["grid.andMore"], { n: String(parts.length - 2) })}` : ""}. {m["grid.endsTail"]}
      </span>
    </div>
  );
}

type BulkProps = Props & {
  dates: string[];
  sel: Sel | null;
  clear: () => void;
  day: (d: string) => string;
  weekdayNames: string[];
  cellOf: (row: GridRowView, d: string) => GridCell;
  onApplied: (r: GridActionState) => void;
};

function BulkPanel({ property, rows, dates, sel, clear, day, weekdayNames, cellOf, onApplied, belowFloor, changes, language, m }: BulkProps) {
  const [weekdays, setWeekdays] = useState<boolean[]>([true, true, true, true, true, true, true]);
  const [action, setAction] = useState<PriceAction>("keep");
  const [value, setValue] = useState("");
  const [field, setField] = useState<RestrictionField | "">("");
  const [restrValue, setRestrValue] = useState<string>("on");
  const [pending, startTransition] = useTransition();

  const priceValue = Number(value.replace(",", "."));
  const priceValid = action === "keep" || (value.trim() !== "" && value.trim() !== "-" && Number.isFinite(priceValue));
  const edit: BulkEdit | null = useMemo(() => {
    if (!sel) return null;
    const r0 = Math.min(sel.a.i, sel.b.i);
    const r1 = Math.max(sel.a.i, sel.b.i);
    const d0 = dates[Math.min(sel.a.d, sel.b.d)]!;
    const d1 = dates[Math.max(sel.a.d, sel.b.d)]!;
    const numeric = field !== "" && NUMERIC.includes(field);
    return {
      rows: rows.slice(r0, r1 + 1).map((r) => ({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId })),
      from: d0,
      to: d1,
      weekdays,
      price: { action, value: priceValid && action !== "keep" ? priceValue : 0 },
      restriction: field === "" ? null : { field, value: numeric ? (restrValue === "" || Number(restrValue) === 0 ? null : Number(restrValue)) : restrValue === "on" },
    };
  }, [sel, priceValid, rows, dates, weekdays, action, priceValue, field, restrValue]);

  const plan = useMemo(() => {
    if (!edit || !priceValid) return null;
    const find = (p: string, r: string) => rows.find((x) => x.ratePlanId === p && x.roomTypeId === r);
    return planBulkEdit(edit, rows, {
      price: (p, r, d) => {
        const row = find(p, r);
        return row ? cellOf(row, d).price : null;
      },
      restriction: (p, r, d) => {
        const row = find(p, r);
        return row ? cellOf(row, d).own : OPEN_RESTRICTION;
      },
    });
  }, [edit, priceValid, rows, cellOf]);

  const nothing = action === "keep" && field === "";
  const pv = plan?.preview;
  const seg = (on: boolean) => `h-9 flex-1 rounded-[10px] text-[13px] ${on ? "bg-ink text-canvas" : "bg-surface-2 text-ink-80 hover:bg-ink-5"}`;
  const inp = "h-9 w-full rounded-[10px] border border-ink-10 bg-surface-2 px-3 text-[14px]";

  const apply = () => {
    if (!edit || !pv) return;
    startTransition(async () => {
      const r = await applyBulk(property.id, edit, pv.cells);
      onApplied(r);
      if (r.ok) {
        setAction("keep");
        setValue("");
        setField("");
      }
    });
  };

  const label = (p: string, r: string) => {
    const row = rows.find((x) => x.ratePlanId === p && x.roomTypeId === r);
    return row ? `${row.ratePlanCode} · ${row.roomTypeCode}` : "?";
  };
  const groups = useMemo(() => {
    const out: { id: string; at: string; userName: string; items: typeof changes }[] = [];
    for (const c of changes) {
      let g = out.find((x) => x.id === c.changeId);
      if (!g) {
        g = { id: c.changeId, at: c.at, userName: c.userName, items: [] };
        out.push(g);
      }
      g.items.push(c);
    }
    return out.slice(0, 12);
  }, [changes]);
  // the property's clock, not the browser's
  const time = (iso: string) => new Date(iso).toLocaleTimeString(localeFor(language, property.country), { hour: "2-digit", minute: "2-digit", timeZone: property.timeZone });
  const fieldLabel = (f: string) => (f === "price" ? m["grid.price"] : m[`rates.restriction.${f as RestrictionField}`]);

  return (
    <aside aria-label={m["bulk.title"]} className="flex w-[330px] shrink-0 flex-col border-l border-ink-10">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold tracking-tight">{m["bulk.title"]}</h2>
          {sel ? (
            <button type="button" aria-label={m["bulk.clear"]} onClick={clear} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">
              <X size={15} />
            </button>
          ) : null}
        </div>
        {!edit ? (
          <p className="mt-2 text-[13px] text-ink-60">{m["bulk.empty"]}</p>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="rounded-[12px] bg-surface-2 p-3 text-[13px]">
              <div className="font-medium">{fill(m["bulk.range"], { from: day(edit.from), to: day(edit.to) })}</div>
              <ul className="mt-1 space-y-0.5 text-ink-60">
                {edit.rows.slice(0, 5).map((r) => (
                  <li key={`${r.ratePlanId}|${r.roomTypeId}`} className="flex items-center gap-1">
                    {rows.find((x) => x.ratePlanId === r.ratePlanId && x.roomTypeId === r.roomTypeId)?.basePlanId ? <Link2 size={12} /> : null}
                    {label(r.ratePlanId, r.roomTypeId)}
                  </li>
                ))}
                {edit.rows.length > 5 ? <li>{fill(m["grid.andMore"], { n: String(edit.rows.length - 5) })}</li> : null}
              </ul>
            </div>
            <fieldset>
              <legend className="mb-1 text-[12px] font-semibold text-ink-60">{m["bulk.weekdays"]}</legend>
              <div className="flex gap-1">
                {weekdayNames.map((w, i) => (
                  <button
                    type="button"
                    key={w}
                    aria-pressed={weekdays[i]}
                    onClick={() => setWeekdays((x) => x.map((v, k) => (k === i ? !v : v)))}
                    className={`h-9 flex-1 rounded-[10px] text-[12px] ${weekdays[i] ? "bg-ink text-canvas" : "bg-surface-2 text-ink-40"}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-[12px] font-semibold text-ink-60">{m["grid.price"]}</legend>
              <div className="flex gap-1">
                {(
                  [
                    ["keep", m["bulk.keep"]],
                    ["set", m["bulk.set"]],
                    ["amount", `± ${property.currency}`],
                    ["percent", "± %"],
                  ] as const
                ).map(([k, l]) => (
                  <button type="button" key={k} aria-pressed={action === k} onClick={() => setAction(k)} className={seg(action === k)}>
                    {l}
                  </button>
                ))}
              </div>
              {action !== "keep" ? (
                <input
                  aria-label={m["bulk.value"]}
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/[^0-9.,-]/g, ""))}
                  placeholder={action === "set" ? m["bulk.newPrice"] : "-10"}
                  className={`${inp} mt-1.5`}
                />
              ) : null}
              {!priceValid ? <p className="mt-1 text-[12px] text-ink-60">{m["bulk.needValue"]}</p> : null}
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-[12px] font-semibold text-ink-60">{m["bulk.restriction"]}</legend>
              <select
                aria-label={m["bulk.restriction"]}
                value={field}
                onChange={(e) => {
                  const f = e.target.value as RestrictionField | "";
                  setField(f);
                  setRestrValue(f !== "" && NUMERIC.includes(f) ? "2" : "on");
                }}
                className={inp}
              >
                <option value="">{m["bulk.noChange"]}</option>
                {RESTRICTION_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {m[`rates.restriction.${f}`]}
                  </option>
                ))}
              </select>
              {field !== "" && NUMERIC.includes(field) ? (
                <>
                  <input aria-label={m["bulk.nights"]} inputMode="numeric" value={restrValue} onChange={(e) => setRestrValue(e.target.value.replace(/[^0-9]/g, ""))} className={`${inp} mt-1.5`} />
                  <p className="mt-1 text-[12px] text-ink-60">{m["bulk.removeHint"]}</p>
                </>
              ) : field !== "" ? (
                <div className="mt-1.5 flex gap-1">
                  <button type="button" aria-pressed={restrValue === "on"} onClick={() => setRestrValue("on")} className={seg(restrValue === "on")}>
                    {m["bulk.on"]}
                  </button>
                  <button type="button" aria-pressed={restrValue === "off"} onClick={() => setRestrValue("off")} className={seg(restrValue === "off")}>
                    {m["bulk.off"]}
                  </button>
                </div>
              ) : null}
            </fieldset>
            {pv && !nothing ? (
              <div data-testid="bulk-preview" className="rounded-[12px] border border-ink-10 p-3 text-[13px]">
                <div className="font-semibold">{m["bulk.before"]}</div>
                <div className="mt-1 text-ink-80">
                  {fill(m["bulk.cells"], { cells: String(pv.cells), rows: String(pv.rows) })}
                  {pv.min !== null ? ` ${fill(m["bulk.priceRange"], { min: showPrice(pv.min), max: showPrice(pv.max ?? pv.min) })}` : ""}
                </div>
                {pv.derivedFollowing > 0 ? (
                  <div className="mt-1 flex items-start gap-1.5 text-ink-60">
                    <Link2 size={13} className="mt-0.5 shrink-0" />
                    {fill(m["bulk.follow"], { n: String(pv.derivedFollowing) })}
                  </div>
                ) : null}
                {pv.derivedSelected > 0 ? <div className="mt-1 text-ink-60">{fill(m["bulk.derivedSelected"], { n: String(pv.derivedSelected) })}</div> : null}
                {pv.belowFloor > 0 ? <Warn text={fill(m["bulk.belowFloor"], { n: String(pv.belowFloor) })} /> : null}
                {pv.minAboveMax > 0 ? <Warn text={fill(m["bulk.minAboveMax"], { n: String(pv.minAboveMax) })} /> : null}
                {pv.negative > 0 ? <Warn text={fill(m["bulk.negative"], { n: String(pv.negative) })} /> : null}
              </div>
            ) : null}
            <button
              type="button"
              disabled={nothing || !pv?.cells || pv.negative > 0 || pending}
              onClick={apply}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-[14px] font-medium text-white disabled:opacity-30"
            >
              <Check size={16} />
              {pending ? m["action.saving"] : fill(m["bulk.apply"], { n: String(pv?.cells ?? 0) })}
            </button>
          </div>
        )}

        <section aria-label={m["grid.belowFloorTitle"]} className="mt-5">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-danger">
            <TriangleAlert size={14} />
            {fill(m["grid.belowFloorTitle"], { n: String(belowFloor.length) })}
          </h3>
          <p className="text-[11px] text-ink-40">{m["grid.belowFloorHelp"]}</p>
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {belowFloor.slice(0, 15).map((b) => (
              <li key={`${b.ratePlanId}|${b.roomTypeId}|${b.date}`}>
                {b.ratePlanCode} · {b.roomTypeCode} · {day(b.date)}: <span className="text-danger">{showPrice(b.price)}</span> <span className="text-ink-40">/ {showPrice(b.priceFloor)}</span>
              </li>
            ))}
            {belowFloor.length > 15 ? <li className="text-ink-40">{fill(m["grid.andMore"], { n: String(belowFloor.length - 15) })}</li> : null}
          </ul>
        </section>

        <section aria-label={m["grid.changes"]} className="mt-5">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-60">
            <History size={14} />
            {m["grid.changes"]}
          </h3>
          <ul className="mt-1 space-y-2 text-[12px]">
            {groups.length === 0 ? <li className="text-ink-40">{m["grid.noChanges"]}</li> : null}
            {groups.map((g) => (
              <li key={g.id}>
                <span className="font-mono text-ink-40">{time(g.at)}</span> <span className="text-ink-60">· {g.userName}</span>
                <ul className="text-ink-80">
                  {g.items.slice(0, 3).map((c) => (
                    <li key={c.id}>
                      {label(c.ratePlanId, c.roomTypeId)} {day(c.date)} {fieldLabel(c.field)}: {logValue(c.field, c.oldValue)} → {logValue(c.field, c.newValue)}
                      {c.reason !== "edit" ? <span className="text-ink-40"> ({m[`grid.reason.${c.reason as "derived" | "undo" | "room_type_removed" | "became_derived"}`] ?? c.reason})</span> : null}
                    </li>
                  ))}
                  {g.items.length > 3 ? <li className="text-ink-40">{fill(m["grid.andMore"], { n: String(g.items.length - 3) })}</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}

function Warn({ text }: { text: string }) {
  return (
    <div className="mt-1 flex items-start gap-1.5 text-danger">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      {text}
    </div>
  );
}


function logValue(field: string, v: string | null): string {
  if (v === null) return "—";
  return field === "price" ? showPrice(Number(v)) : v;
}
