"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openBillAction } from "../actions";

/** Open a bill at a table (or, with a guest's name or a note, without one) and go to it. */
export function NewBill({ outletId, tableId, label, placeholder }: { outletId: string; tableId: string | null; label: string; placeholder?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1">
      {placeholder ? <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 rounded-lg border border-ink-10 bg-surface px-2 text-sm" /> : null}
      <button
        type="button"
        disabled={pending}
        data-new-bill
        onClick={() =>
          start(async () => {
            const r = await openBillAction(outletId, tableId, text);
            if (r.billId) router.push(`/outlet/${outletId}/bill/${r.billId}`);
            else setError(r.error ?? null);
          })
        }
        className="h-9 rounded-full border border-ink-10 text-sm font-medium disabled:opacity-60"
      >
        + {label}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
