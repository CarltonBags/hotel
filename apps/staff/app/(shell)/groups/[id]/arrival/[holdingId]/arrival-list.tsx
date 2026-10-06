"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GroupArrival } from "@hoteloftware/db";
import { ActionForm } from "@/components/form-fields";
import type { Messages } from "@/i18n/messages";
import { checkInGroupAction, nameReservationAction } from "../../../billing-actions";

/** The arrival's reservations with their rooms: names changed until check-in, checked in selected or all at once. */
export function ArrivalList({ groupId, holdingId, reservations, canCheckIn, canRename, m }: { groupId: string; holdingId: string; reservations: GroupArrival[]; canCheckIn: boolean; canRename: boolean; m: Messages }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (ids: string[] | null) =>
    start(async () => {
      const r = await checkInGroupAction(groupId, holdingId, ids);
      setNote({ error: !!r.error, text: r.error ?? r.message ?? "" });
      setPicked([]);
      router.refresh();
    });
  const button = "h-9 rounded-full px-4 text-sm font-medium disabled:opacity-60";
  const confirmed = reservations.filter((r) => r.status === "confirmed");
  return (
    <section className="grid gap-3 rounded-2xl bg-surface-2 p-5 text-sm" data-arrival-list>
      <table className="w-full">
        <tbody>
          {reservations.map((r) => (
            <tr key={r.reservationId} data-reservation={r.confirmationNumber} data-status={r.status} data-room={r.room ?? ""}>
              <td className="pr-2">
                {canCheckIn && r.status === "confirmed" ? (
                  <input type="checkbox" aria-label={r.guest} checked={picked.includes(r.reservationId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.reservationId] : p.filter((x) => x !== r.reservationId)))} />
                ) : null}
              </td>
              <td className="pr-3">{r.roomType}</td>
              <td className="pr-3 font-medium">
                {r.room ?? "–"}
                {r.floor ? <span className="text-ink-60"> · {r.floor}</span> : null}
              </td>
              <td className="pr-3">
                {canRename && r.status === "confirmed" ? (
                  <ActionForm action={nameReservationAction} submitLabel={m["action.save"]} className="flex flex-wrap items-center gap-1">
                    <input type="hidden" name="groupId" value={groupId} />
                    <input type="hidden" name="holdingId" value={holdingId} />
                    <input type="hidden" name="reservationId" value={r.reservationId} />
                    <input name="firstName" aria-label={m["guests.firstName"]} defaultValue={r.pending ? "" : r.guest.split(" ").slice(0, -1).join(" ")} placeholder={r.pending ? m["group.placeholder"] : ""} className="h-8 w-28 rounded-lg border border-ink-10 bg-surface px-2" />
                    <input name="lastName" aria-label={m["guests.lastName"]} defaultValue={r.pending ? "" : r.guest.split(" ").at(-1)} placeholder={r.pending ? r.guest : ""} className="h-8 w-32 rounded-lg border border-ink-10 bg-surface px-2" />
                  </ActionForm>
                ) : (
                  <span>{r.guest}</span>
                )}
              </td>
              <td className="pr-3 text-ink-60">{r.persons}</td>
              <td>
                <a href={`/reservations/${r.reservationId}`} className="text-accent underline">
                  {r.confirmationNumber}
                </a>{" "}
                <span className="text-ink-60">{m[`res.status.${r.status}` as keyof Messages] ?? r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canCheckIn && confirmed.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending || !picked.length} onClick={() => run(picked)} className={`${button} border border-ink-10`}>
            {m["group.checkInSelected"]}
          </button>
          <button type="button" disabled={pending} onClick={() => run(null)} className={`${button} bg-accent text-white`} data-check-in-all>
            {m["group.checkInAll"]}
          </button>
        </div>
      ) : null}
      {note ? (
        <p role={note.error ? "alert" : "status"} className={note.error ? "text-danger" : "text-ink-60"}>
          {note.text}
        </p>
      ) : null}
    </section>
  );
}
