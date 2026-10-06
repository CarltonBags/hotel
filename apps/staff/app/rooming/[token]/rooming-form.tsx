"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OrganiserRooming } from "@hoteloftware/db";
import { fillRoomingAction } from "./actions";

/** One row per room of the group: first and last name, until the guest has checked in. */
export function RoomingForm({ token, view }: { token: string; view: OrganiserRooming }) {
  const router = useRouter();
  const rooms = view.holdings.flatMap((h) => h.rooms);
  const [names, setNames] = useState(() => Object.fromEntries(rooms.map((r) => [r.reservationId, { firstName: r.firstName, lastName: r.lastName }])));
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = "h-10 w-full rounded-lg border border-black/15 px-2";
  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const changed = rooms.filter((r) => r.open && (names[r.reservationId]!.firstName !== r.firstName || names[r.reservationId]!.lastName !== r.lastName));
          const res = await fillRoomingAction(token, changed.map((r) => ({ reservationId: r.reservationId, ...names[r.reservationId]! })));
          setNote(res.error ?? `Gespeichert · Saved (${res.saved ?? 0})`);
          router.refresh();
        });
      }}
    >
      {view.holdings.map((h) => (
        <section key={h.arrival} className="grid gap-2">
          <h2 className="font-medium">
            {h.arrival} – {h.departure}
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/60">
                <th className="pr-2 font-normal">Zimmer · Room</th>
                <th className="pr-2 font-normal">Vorname · First name</th>
                <th className="font-normal">Nachname · Last name</th>
              </tr>
            </thead>
            <tbody>
              {h.rooms.map((r, i) => (
                <tr key={r.reservationId} data-room-row={i}>
                  <td className="pr-2">
                    {i + 1}. {r.roomType}
                  </td>
                  <td className="pr-2 py-1">
                    <input aria-label="First name" disabled={!r.open} value={names[r.reservationId]!.firstName} onChange={(e) => setNames((n) => ({ ...n, [r.reservationId]: { ...n[r.reservationId]!, firstName: e.target.value } }))} className={input} />
                  </td>
                  <td className="py-1">
                    <input aria-label="Last name" disabled={!r.open} value={names[r.reservationId]!.lastName} onChange={(e) => setNames((n) => ({ ...n, [r.reservationId]: { ...n[r.reservationId]!, lastName: e.target.value } }))} className={input} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="h-11 rounded-full bg-black px-6 font-medium text-white disabled:opacity-50">
          Speichern · Save
        </button>
        {note ? <span role="status">{note}</span> : null}
      </div>
    </form>
  );
}
