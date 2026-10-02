"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkInAction } from "./folio-actions";

/** Check-in from the reservation tab or the arrivals list; the server checks the date, the room and the right again. */
export function CheckInButton({ reservationId, label, compact = false }: { reservationId: string; label: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await checkInAction(reservationId);
            setError(res.error ?? null);
            if (!res.error) router.refresh();
          })
        }
        className={`${compact ? "h-7 px-3 text-xs" : "h-9 px-4 text-sm"} rounded-full bg-accent font-medium text-white disabled:opacity-60`}
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
