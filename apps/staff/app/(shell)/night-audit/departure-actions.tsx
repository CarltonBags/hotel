"use client";

import type { Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { auditCheckOutAction, auditExtendAction } from "./actions";

const button = "h-8 rounded-full border border-ink-10 bg-surface px-3 text-sm hover:bg-ink-5";

/** Step 2: check a guest past departure out, or extend the stay by one night. */
export function DepartureActions({ propertyId, reservationId, m }: { propertyId: string; reservationId: string; m: Messages }) {
  const { pending, run, note } = useFormAction(m);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} onClick={() => run(() => auditCheckOutAction(propertyId, reservationId))} className={button}>
        {m["na.checkOut"]}
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => auditExtendAction(propertyId, reservationId))} className={button}>
        {m["na.extend"]}
      </button>
      {note}
    </span>
  );
}
