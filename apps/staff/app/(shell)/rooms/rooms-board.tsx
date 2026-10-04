"use client";

import Link from "next/link";
import { useState } from "react";
import { addDays, type Cleanliness, type RoomBlockKind } from "@hoteloftware/domain";
import type { RoomState } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { assignHousekeepingAction, createBlockAction, endBlockAction, inspectionAction, setCleanlinessAction } from "./actions";

const button = "h-8 rounded-full border border-ink-10 bg-surface px-3 text-xs hover:bg-ink-5 disabled:opacity-40";
const input = "h-8 rounded-lg border border-ink-10 bg-surface px-2 text-xs";
const tone: Record<Cleanliness, string> = { dirty: "bg-danger/15 text-danger", clean: "bg-warning/15", inspected: "bg-success/15 text-success" };
type Filter = "all" | "dirty" | "notReady" | "blocked";

/** The rooms as cards: set Cleanliness, see tonight's guest, block or unblock, give the day's Housekeeping Task to a Housekeeper. */
export function RoomsBoard({
  propertyId,
  businessDate,
  inspectionRequired,
  rooms,
  housekeepers,
  names,
  rights,
  m,
}: {
  propertyId: string;
  businessDate: string;
  inspectionRequired: boolean;
  rooms: RoomState[];
  housekeepers: { id: string; name: string }[];
  names: Record<string, string>;
  rights: { dirty: boolean; clean: boolean; inspected: boolean; outOfOrder: boolean; outOfService: boolean; assign: boolean; settings: boolean };
  m: Messages;
}) {
  const { pending, run, note } = useFormAction(m);
  const [filter, setFilter] = useState<Filter>("all");
  const [blocking, setBlocking] = useState<string | null>(null);
  const [block, setBlock] = useState<{ kind: RoomBlockKind; from: string; to: string; reason: string }>({ kind: rights.outOfOrder ? "out_of_order" : "out_of_service", from: businessDate, to: addDays(businessDate, 1), reason: "" });
  const shown = rooms.filter((r) => filter === "all" || (filter === "dirty" && r.cleanliness === "dirty") || (filter === "notReady" && !r.ready) || (filter === "blocked" && r.blocks.length > 0));
  const canBlock = rights.outOfOrder || rights.outOfService;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["all", "dirty", "notReady", "blocked"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={`${button} ${filter === f ? "border-accent bg-accent/15" : ""}`}>
            {m[`rs.filter.${f}`]}
          </button>
        ))}
        <span className="flex-1" />
        {rights.settings ? (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" defaultChecked={inspectionRequired} disabled={pending} onChange={(e) => run(() => inspectionAction(propertyId, e.target.checked))} />
            {m["rs.inspection"]}
          </label>
        ) : null}
      </div>
      {note}
      {shown.length === 0 ? <p className="text-ink-60">{m["rs.none"]}</p> : null}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
        {shown.map((r) => (
          <li key={r.id} data-room={r.number} className="grid content-start gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{r.number}</span>
              <span className="rounded-full bg-ink-5 px-1.5 text-xs">{r.roomTypeCode}</span>
              <span data-cleanliness={r.cleanliness} className={`ml-auto rounded-full px-2 text-xs ${tone[r.cleanliness]}`}>
                {m[`rooms.cleanliness.${r.cleanliness}`]} · {r.ready ? m["rs.ready"] : m["rs.notReady"]}
              </span>
            </div>
            <div className="text-xs text-ink-80">
              {r.occupiedBy ? (
                <Link href={`/reservations/${r.occupiedBy.reservationId}`} className="underline">
                  {m["rs.occupied"]} · {r.occupiedBy.guestSurname} ({r.occupiedBy.guests}) · {fill(m["rs.until"], { date: r.occupiedBy.departure })}
                </Link>
              ) : (
                <span className="text-ink-60">{m["rs.vacant"]}</span>
              )}
              {r.arrival ? (
                <span>
                  {" "}
                  ·{" "}
                  <Link href={`/reservations/${r.arrival.reservationId}`} className="underline">
                    {m["rs.arrival"]} {r.arrival.guestSurname}
                  </Link>
                </span>
              ) : null}
            </div>
            {r.blocks.map((b) => (
              <div key={b.id} data-block={b.kind} className={`flex flex-wrap items-center gap-1 rounded-lg px-2 py-1 text-xs ${b.kind === "out_of_order" ? "bg-danger/10" : "bg-warning/10"}`}>
                <strong>{m[`rooms.block.${b.kind}`]}</strong> {b.from} – {b.to} · {b.reason}
                {b.kind === "out_of_order" && b.conflicts.length ? <span className="w-full text-danger">{fill(m["rs.conflicts"], { list: b.conflicts.join(", ") })}</span> : null}
                {(b.kind === "out_of_order" ? rights.outOfOrder : rights.outOfService) ? (
                  <button type="button" disabled={pending} onClick={() => run(() => endBlockAction(b.id))} className={`${button} ml-auto h-6`}>
                    {m["rs.endBlock"]}
                  </button>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap gap-1">
              {(["dirty", "clean", "inspected"] as const)
                .filter((to) => rights[to] && r.cleanliness !== to)
                .map((to) => (
                  <button key={to} type="button" disabled={pending} onClick={() => run(() => setCleanlinessAction(r.id, to))} className={button}>
                    {fill(m["rs.set"], { state: m[`rooms.cleanliness.${to}`] })}
                  </button>
                ))}
              {canBlock ? (
                <button type="button" onClick={() => setBlocking(blocking === r.id ? null : r.id)} aria-expanded={blocking === r.id} className={button}>
                  {m["rs.block"]}
                </button>
              ) : null}
            </div>
            {rights.assign ? (
              <label className="grid gap-1 text-xs text-ink-60">
                {m["rs.assignee"]}
                <select value={r.task?.assigneeId ?? ""} disabled={pending} onChange={(e) => run(() => assignHousekeepingAction(r.id, e.target.value || null))} className={input}>
                  <option value="">{m["rs.unassigned"]}</option>
                  {housekeepers.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : r.task?.assigneeId ? (
              <p className="text-xs text-ink-60">
                {m["rs.assignee"]} {names[r.task.assigneeId] ?? ""}
              </p>
            ) : null}
            {blocking === r.id ? (
              <form
                className="grid gap-1 rounded-lg bg-surface p-2 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    () => createBlockAction({ roomId: r.id, ...block }),
                    () => setBlocking(null),
                  );
                }}
              >
                <select value={block.kind} onChange={(e) => setBlock({ ...block, kind: e.target.value as RoomBlockKind })} aria-label={m["rs.blockKind"]} className={input}>
                  {rights.outOfOrder ? <option value="out_of_order">{m["rooms.block.out_of_order"]}</option> : null}
                  {rights.outOfService ? <option value="out_of_service">{m["rooms.block.out_of_service"]}</option> : null}
                </select>
                <label className="grid gap-0.5">
                  {m["rs.from"]}
                  <input type="date" value={block.from} min={businessDate} onChange={(e) => setBlock({ ...block, from: e.target.value })} className={input} />
                </label>
                <label className="grid gap-0.5">
                  {m["rs.to"]}
                  <input type="date" value={block.to} min={addDays(block.from, 1)} onChange={(e) => setBlock({ ...block, to: e.target.value })} className={input} />
                </label>
                <input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} placeholder={m["rs.reason"]} required maxLength={300} className={input} />
                <button type="submit" disabled={pending || !block.reason.trim()} className="h-8 rounded-full bg-accent px-3 text-xs font-medium text-white disabled:opacity-40">
                  {m["rs.block"]}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
