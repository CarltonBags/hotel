"use client";
// PROTOTYPE calendar state. In memory only.
import { useMemo, useState } from "react";
import { DAYS, build, stats, type Res } from "./data";

export function useCal() {
  const [scale, setScale] = useState(1);
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const base = useMemo(() => build(scale), [scale]);
  const [edits, setEdits] = useState<Record<string, Partial<Res>>>({});
  const [msg, setMsg] = useState("Drag a reservation to another room or date. Drag an unassigned reservation onto a room to assign it.");
  const [picked, setPicked] = useState<Res | null>(null);
  const res = useMemo(() => base.res.map((r) => (edits[r.id] ? { ...r, ...edits[r.id] } : r)), [base, edits]);
  const st = useMemo(() => stats(base.types, res, base.blocks), [base, res]);
  const dw = range === 7 ? 150 : range === 14 ? 84 : 44;

  const move = (id: string, room: string, typeId: string, start: number) => {
    const r = res.find((x) => x.id === id);
    if (!r) return;
    if (r.status === "out") return setMsg(`${r.guest}: a checked-out stay cannot be moved.`);
    if (r.status === "in" && start !== r.start) return setMsg(`${r.guest} is checked in: the arrival date is fixed. Use a room move instead.`);
    const s = Math.max(0, Math.min(DAYS - r.nights, start));
    const clash = res.find((x) => x.id !== id && x.room === room && x.start < s + r.nights && s < x.start + x.nights);
    if (clash) return setMsg(`Room ${room} is taken by ${clash.guest} on those nights. Nothing changed.`);
    const blk = base.blocks.find((b) => b.kind === "ooo" && b.room === room && b.start < s + r.nights && s < b.start + b.nights);
    if (blk) return setMsg(`Room ${room} is Out of Order (${blk.reason}). Nothing changed.`);
    setEdits((e) => ({ ...e, [id]: { room, typeId, start: s } }));
    const parts = [r.room ? `moved ${r.room} → ${room}` : `assigned to ${room}`];
    if (s !== r.start) parts.push(`dates shifted by ${s - r.start} day(s), availability re-checked, new nights priced at current rates`);
    if (typeId !== r.typeId) parts.push(`room type changed ${r.typeId} → ${typeId}, staff must confirm price`);
    setMsg(`${r.guest} (${id}): ${parts.join("; ")}.`);
  };

  return { ...base, res, st, dw, range, setRange, scale, setScale: (n: number) => { setEdits({}); setScale(n); }, move, msg, setMsg, picked, setPicked, rooms: base.types.reduce((a, t) => a + t.rooms.length, 0) };
}
export type Cal = ReturnType<typeof useCal>;
