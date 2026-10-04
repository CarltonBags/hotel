"use client";

import type { Messages } from "@/i18n/messages";
import { useFormAction } from "./use-form-action";
import { waitingForRoomAction } from "./folio-actions";

/** Arrived, Waiting for Room: tells housekeeping to prepare the room first. */
export function WaitingButton({ reservationId, waiting, m }: { reservationId: string; waiting: boolean; m: Messages }) {
  const { pending, run, note } = useFormAction(m);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => waitingForRoomAction(reservationId, !waiting))}
        className={`h-9 rounded-full border px-4 text-sm ${waiting ? "border-danger bg-danger/10 text-danger" : "border-ink-10 bg-surface hover:bg-ink-5"}`}
      >
        {waiting ? m["res.notWaiting"] : m["res.waitingForRoom"]}
      </button>
      {note}
    </span>
  );
}
