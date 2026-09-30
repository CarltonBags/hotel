"use client";
// PROTOTYPE model and state for the Rates grid. In memory only.
import { useMemo, useState } from "react";
import { DAYS, dayInfo } from "../calendar/data";

export { DAYS, dayInfo };
export const TODAY = 3;
export type Restr = { stop?: boolean; cta?: boolean; ctd?: boolean; minArr?: number; minThru?: number; maxStay?: number };
export type Plan = { id: string; name: string; parent?: string; mod?: { kind: "amount" | "percent"; value: number } };
export const TYPES = [
  { id: "DBL", name: "Double", base: 149, floor: 99 },
  { id: "DBS", name: "Double Superior", base: 189, floor: 129 },
  { id: "JRS", name: "Junior Suite", base: 259, floor: 179 },
  { id: "STE", name: "Suite", base: 389, floor: 279 },
];
export const PLANS: Plan[] = [
  { id: "flex", name: "Flexible" },
  { id: "flexbb", name: "Flexible with breakfast", parent: "flex", mod: { kind: "amount", value: 36 } },
  { id: "saver", name: "Saver, non-refundable", parent: "flex", mod: { kind: "percent", value: -12 } },
  { id: "corp", name: "Corporate" },
];
export const ROWS = PLANS.flatMap((p) => TYPES.map((t) => ({ key: `${p.id}|${t.id}`, plan: p, type: t })));
export const modText = (p: Plan) => (p.mod ? `${PLANS.find((x) => x.id === p.parent)!.name} ${p.mod.value > 0 ? "+" : "−"} ${Math.abs(p.mod.value)}${p.mod.kind === "percent" ? " %" : ""}` : "");

const seed = () => {
  const price: Record<string, (number | null)[]> = {};
  const restr: Record<string, Restr[]> = {};
  for (const p of PLANS.filter((x) => !x.parent)) for (const t of TYPES) {
    const k = `${p.id}|${t.id}`;
    price[k] = Array.from({ length: DAYS }, (_, d) => { const i = dayInfo(d); const b = p.id === "corp" ? Math.round(t.base * 0.82) : t.base; if (p.id === "corp" && d > 39) return null; return Math.round(b * (i.event ? 1.6 : i.weekend ? 1.15 : 1)); });
    restr[k] = Array.from({ length: DAYS }, (_, d) => { const i = dayInfo(d); const r: Restr = {}; if (i.event && p.id === "flex") r.minThru = 2; if (p.id === "flex" && t.id === "STE" && d === 13) r.stop = true; if (p.id === "flex" && t.id === "DBL" && d === 20) r.cta = true; return r; });
  }
  price["flex|DBL"][8] = 89; // below floor, to show the warning
  return { price, restr };
};

export type Sel = { rows: string[]; from: number; to: number };
export type Bulk = { weekdays: boolean[]; action: "none" | "set" | "amount" | "percent"; value: number; restr: { key: keyof Restr | ""; value: number | boolean } };
export const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const wdIndex = (d: number) => WD.indexOf(dayInfo(d).wd);

export function useRates() {
  const init = useMemo(seed, []);
  const [price, setPrice] = useState(init.price);
  const [restr, setRestr] = useState(init.restr);
  const [sel, setSel] = useState<Sel | null>(null);
  const [log, setLog] = useState<{ at: string; text: string }[]>([]);
  const [pending, setPending] = useState(0);
  const [synced, setSynced] = useState("09:41");
  const [bulk, setBulk] = useState<Bulk>({ weekdays: WD.map(() => true), action: "none", value: 0, restr: { key: "", value: true } });

  const base = (rowKey: string) => { const [pid, tid] = rowKey.split("|"); const p = PLANS.find((x) => x.id === pid)!; return p.parent ? `${p.parent}|${tid}` : rowKey; };
  const derived = (rowKey: string) => base(rowKey) !== rowKey;
  const get = (rowKey: string, d: number): number | null => {
    const v = price[base(rowKey)][d];
    if (v === null) return null;
    const p = PLANS.find((x) => x.id === rowKey.split("|")[0])!;
    if (!p.mod) return v;
    return p.mod.kind === "amount" ? v + p.mod.value : Math.round(v * (1 + p.mod.value / 100));
  };
  const getR = (rowKey: string, d: number): Restr => restr[base(rowKey)][d];
  const floor = (rowKey: string) => TYPES.find((t) => t.id === rowKey.split("|")[1])!.floor;
  const note = (text: string, n: number) => {
    setLog((l) => [{ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), text }, ...l].slice(0, 12));
    setPending((x) => x + n);
    setTimeout(() => { setPending(0); setSynced(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })); }, 2600);
  };
  const setCell = (rowKey: string, d: number, v: number) => {
    if (derived(rowKey)) return;
    const old = price[rowKey][d];
    if (old === v) return;
    setPrice((p) => ({ ...p, [rowKey]: p[rowKey].map((x, i) => (i === d ? v : x)) }));
    const follow = ROWS.filter((r) => base(r.key) === rowKey && r.key !== rowKey).length;
    note(`${rowLabel(rowKey)}, ${dayInfo(d).date} ${dayInfo(d).month}: ${old ?? "empty"} → ${v}${follow ? `; ${follow} derived rate(s) follow` : ""}`, 1 + follow);
  };
  const targets = (s: Sel, b: Bulk) => {
    const out: { row: string; d: number }[] = [];
    for (const row of Array.from(new Set(s.rows.map(base)))) for (let d = Math.min(s.from, s.to); d <= Math.max(s.from, s.to); d++) if (b.weekdays[wdIndex(d)]) out.push({ row, d });
    return out;
  };
  const next = (old: number | null, b: Bulk) => (b.action === "set" ? b.value : old === null ? null : b.action === "amount" ? old + b.value : b.action === "percent" ? Math.round(old * (1 + b.value / 100)) : old);
  const preview = (s: Sel | null, b: Bulk) => {
    if (!s) return null;
    const t = targets(s, b);
    const vals = t.map((x) => next(price[x.row][x.d], b)).filter((v): v is number => v !== null);
    const below = t.filter((x) => { const v = next(price[x.row][x.d], b); return v !== null && v < floor(x.row); }).length;
    const conflict = b.restr.key === "minArr" || b.restr.key === "minThru" ? t.filter((x) => (restr[x.row][x.d].maxStay ?? 99) < Number(b.restr.value)).length : 0;
    const follow = ROWS.filter((r) => derived(r.key) && t.some((x) => x.row === base(r.key))).length;
    return { cells: t.length, rows: new Set(t.map((x) => x.row)).size, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, below, conflict, follow, skippedDerived: s.rows.filter(derived).length };
  };
  const apply = () => {
    if (!sel) return;
    const t = targets(sel, bulk);
    if (bulk.action !== "none") setPrice((p) => { const n = { ...p }; for (const x of t) { n[x.row] = [...n[x.row]]; n[x.row][x.d] = next(n[x.row][x.d], bulk); } return n; });
    if (bulk.restr.key) setRestr((r) => { const n = { ...r }; for (const x of t) { n[x.row] = [...n[x.row]]; const cur = { ...n[x.row][x.d] } as Record<string, unknown>; if (bulk.restr.value === false || bulk.restr.value === 0) delete cur[bulk.restr.key]; else cur[bulk.restr.key] = bulk.restr.value; n[x.row][x.d] = cur as Restr; } return n; });
    const what = [bulk.action === "set" ? `price set to ${bulk.value}` : bulk.action === "amount" ? `price ${bulk.value >= 0 ? "+" : ""}${bulk.value}` : bulk.action === "percent" ? `price ${bulk.value >= 0 ? "+" : ""}${bulk.value} %` : "", bulk.restr.key ? `${bulk.restr.key} = ${bulk.restr.value}` : ""].filter(Boolean).join(", ");
    note(`Bulk edit: ${what} on ${t.length} cells`, t.length);
    setBulk({ ...bulk, action: "none", value: 0, restr: { key: "", value: true } });
  };
  const ends = ROWS.filter((r) => !derived(r.key)).map((r) => ({ row: r.key, last: price[r.key].findLastIndex((v) => v !== null) })).filter((x) => x.last < DAYS - 1);

  return { price, restr, sel, setSel, log, pending, synced, bulk, setBulk, get, getR, floor, derived, base, setCell, preview, apply, ends };
}
export type R = ReturnType<typeof useRates>;
export const rowLabel = (k: string) => { const r = ROWS.find((x) => x.key === k)!; return `${r.plan.name} · ${r.type.name}`; };
export const marks = (x: Restr) => [x.stop && "STOP", x.cta && "CTA", x.ctd && "CTD", x.minArr && `${x.minArr}N`, x.minThru && `${x.minThru}T`, x.maxStay && `≤${x.maxStay}`].filter(Boolean) as string[];
