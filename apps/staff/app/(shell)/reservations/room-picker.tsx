"use client";

import { useState } from "react";
import { BedDouble, Search } from "lucide-react";
import type { RoomChoice } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";

/**
 * Rooms as cards: number and name, room type, floor and section, features.
 * Taken rooms show who holds them and cannot be picked. A filter narrows by
 * number, type or feature.
 */
export function RoomPicker({ choices, selected, onSelect, m }: { choices: RoomChoice[]; selected: string; onSelect: (id: string) => void; m: Messages }) {
  const [q, setQ] = useState("");
  const [freeOnly, setFreeOnly] = useState(true);
  const t = q.trim().toLowerCase();
  const shown = choices.filter(
    (c) => (!freeOnly || c.free) && (!t || c.number.toLowerCase().startsWith(t) || c.roomTypeCode.toLowerCase() === t || c.features.some((f) => f.toLowerCase().includes(t)) || c.name.toLowerCase().includes(t)),
  );
  const free = choices.filter((c) => c.free).length;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-ink-10 bg-surface px-3 text-ink-60">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m["rooms.filter"]} aria-label={m["rooms.filter"]} className="w-full bg-transparent text-ink outline-none" />
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
          {fill(m["rooms.freeOnly"], { n: String(free) })}
        </label>
      </div>
      {shown.length === 0 ? <p className="text-sm text-danger">{m["res.noFreeRoom"]}</p> : null}
      <ul aria-label={m["res.freeRoom"]} className="grid max-h-80 grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 overflow-auto p-0.5">
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-room={c.number}
              disabled={!c.free}
              aria-pressed={selected === c.id}
              onClick={() => onSelect(c.id)}
              className={`grid h-full w-full content-start gap-1 rounded-xl border p-2.5 text-left text-xs ${
                selected === c.id ? "border-accent bg-accent/10 ring-2 ring-accent" : c.free ? "border-ink-10 bg-surface hover:border-accent" : "cursor-not-allowed border-ink-10 bg-ink-5 opacity-60"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <BedDouble size={14} className="text-ink-60" />
                <span className="text-sm font-semibold">{c.number}</span>
                <span className="rounded-full bg-ink-5 px-1.5">{c.roomTypeCode}</span>
              </span>
              {c.name ? <span className="text-ink-80">{c.name}</span> : null}
              <span className="text-ink-60">
                {[c.floor ? fill(m["rooms.floorN"], { floor: c.floor }) : null, c.section, fill(m["rooms.beds"], { n: String(c.bedPlaces) })].filter(Boolean).join(" · ")}
              </span>
              {c.features.length ? (
                <span className="flex flex-wrap gap-1">
                  {c.features.map((f) => (
                    <span key={f} className="rounded-full bg-accent/10 px-1.5 text-accent">
                      {f}
                    </span>
                  ))}
                </span>
              ) : null}
              {!c.free ? <span className="text-danger">{fill(m["rooms.takenBy"], { who: c.occupiedBy ?? "" })}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
