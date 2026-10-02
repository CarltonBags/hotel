"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RoomChoice } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";
import { roomChoicesAction } from "./actions";
import { checkInAction } from "./folio-actions";
import { RoomPicker } from "./room-picker";

/**
 * Check-in from the reservation tab, the Today workspace or the arrivals
 * list. Without a room for tonight it opens the room choice first and assigns
 * and checks in together. The server checks date, room and rights again.
 */
export function CheckInButton({ reservationId, needsRoom = false, compact = false, m }: { reservationId: string; needsRoom?: boolean; compact?: boolean; m: Messages }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<RoomChoice[] | null>(null);
  const [room, setRoom] = useState("");
  const checkIn = (roomId?: string) =>
    startTransition(async () => {
      const res = await checkInAction(reservationId, roomId ?? null);
      setError(res.error ?? null);
      if (!res.error) {
        setChoices(null);
        router.refresh();
      }
    });
  const open = () =>
    startTransition(async () => {
      setError(null);
      setRoom("");
      setChoices(await roomChoicesAction(reservationId));
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => (needsRoom ? open() : checkIn())}
        className={`${compact ? "h-7 px-3 text-xs" : "h-9 px-4 text-sm"} rounded-full bg-accent font-medium text-white disabled:opacity-60`}
      >
        {m["res.checkIn"]}
      </button>
      {error && !choices ? (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
      {choices ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4 text-left" onClick={() => setChoices(null)}>
          <div role="dialog" aria-label={m["res.pickRoomToCheckIn"]} onClick={(e) => e.stopPropagation()} className="grid w-full max-w-3xl gap-3 rounded-2xl bg-surface p-5 shadow-pop">
            <h2 className="font-medium">{m["res.pickRoomToCheckIn"]}</h2>
            <RoomPicker choices={choices} selected={room} onSelect={setRoom} m={m} />
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" disabled={!room || pending} onClick={() => checkIn(room)} className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-white disabled:opacity-40">
                {m["res.assignAndCheckIn"]}
              </button>
              <button type="button" onClick={() => setChoices(null)} className="h-9 rounded-full border border-ink-10 bg-surface px-4 text-sm hover:bg-ink-5">
                {m["res.keepAsIs"]}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
