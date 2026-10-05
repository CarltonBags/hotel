"use client";

import { Fragment, useState, useTransition } from "react";
import type { GroupNight } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { saveGridAction } from "../actions";

/** A holding per room type and night: Held Rooms and contract price editable; booked, free and the Tentative warning shown (ticket 58). */
export function HoldingGrid({ groupId, holdingId, roomTypes, editRooms, editPrices, m }: { groupId: string; holdingId: string; roomTypes: { id: string; code: string; nights: GroupNight[] }[]; editRooms: boolean; editPrices: boolean; m: Messages }) {
  const editable = editRooms || editPrices;
  const initial = () => roomTypes.flatMap((t) => t.nights.map((n) => ({ roomTypeId: t.id, date: n.date, rooms: String(n.held), price: n.price === null ? "" : String(n.price) })));
  const [saved, setSaved] = useState(initial);
  const [cells, setCells] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cell = (t: string, d: string) => cells.find((c) => c.roomTypeId === t && c.date === d)!;
  const set = (t: string, d: string, k: "rooms" | "price", v: string) => setCells((cs) => cs.map((c) => (c.roomTypeId === t && c.date === d ? { ...c, [k]: v } : c)));
  const dates = roomTypes[0]?.nights.map((n) => n.date) ?? [];
  const input = "h-8 w-16 rounded-lg border border-ink-10 bg-surface px-2 text-right tabular-nums";
  return (
    <div className="grid gap-2 overflow-x-auto" data-grid>
      <table className="text-[13px]">
        <thead>
          <tr className="text-xs text-ink-60">
            <th />
            {dates.map((d) => (
              <th key={d} className="px-1 text-right font-normal">
                {d.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roomTypes.map((t) => (
            <Fragment key={t.id}>
              <tr>
                <th className="pr-3 text-left">
                  {t.code} · {m["group.held"]}
                </th>
                {t.nights.map((n) => (
                  <td key={n.date} className="px-1 text-right" data-night={`${t.code}|${n.date}`} data-unsold={n.unsold} data-shortfall={n.shortfall || undefined}>
                    {editRooms ? <input value={cell(t.id, n.date).rooms} onChange={(e) => set(t.id, n.date, "rooms", e.target.value)} inputMode="numeric" className={input} /> : n.held}
                    <div className="text-[10px] text-ink-60">
                      {n.pickedUp} {m["group.booked"]} · {n.free} {m["group.free"]}
                    </div>
                    {n.shortfall ? <div className="text-[10px] font-medium text-danger">+{n.shortfall} {m["group.shortfall"]}</div> : null}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="pr-3 text-left text-ink-60">{m["group.price"]}</th>
                {t.nights.map((n) => (
                  <td key={n.date} className="px-1 text-right">
                    {editPrices ? <input value={cell(t.id, n.date).price} onChange={(e) => set(t.id, n.date, "price", e.target.value)} inputMode="decimal" className={input} /> : (n.price ?? "–")}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      {editable ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white disabled:opacity-60"
            onClick={() =>
              start(async () => {
                // only what changed: a price untouched is not written again
                const was = (c: (typeof cells)[number]) => saved.find((x) => x.roomTypeId === c.roomTypeId && x.date === c.date)!;
                const rooms = editRooms ? cells.filter((c) => c.rooms !== was(c).rooms).map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, rooms: Number(c.rooms || 0) })) : [];
                const prices = editPrices ? cells.filter((c) => c.price !== was(c).price && c.price !== "").map((c) => ({ roomTypeId: c.roomTypeId, date: c.date, price: Number(c.price.replace(",", ".")) })) : [];
                const r = await saveGridAction(groupId, holdingId, { rooms, prices });
                // a shrink: the contract may ask a fee (ticket 59)
                const shrunk = rooms.some((c) => c.rooms < Number(saved.find((x) => x.roomTypeId === c.roomTypeId && x.date === c.date)!.rooms || 0));
                setNote(r.error ?? (shrunk ? `${r.message ?? ""} ${m["group.shrunk"]}`.trim() : (r.message ?? null)));
                if (!r.error) setSaved(cells);
              })
            }
          >
            {m["group.saveGrid"]}
          </button>
          {note ? <span className="text-sm">{note}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
