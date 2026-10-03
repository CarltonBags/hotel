"use client";

import { useState } from "react";
import type { Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { decideApprovalAction } from "./actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";

export function DecideButtons({ approvalId, m }: { approvalId: string; m: Messages }) {
  const [note, setNote] = useState("");
  const { pending, run, note: status } = useFormAction(m);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid flex-1 gap-1 text-xs text-ink-60">
        {m["appr.note"]}
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-9 rounded-xl border border-ink-10 bg-surface px-3 text-sm" />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => decideApprovalAction(approvalId, true, note))} className={`${button} bg-accent text-white`}>
        {m["appr.approve"]}
      </button>
      <button type="button" disabled={pending} onClick={() => run(() => decideApprovalAction(approvalId, false, note))} className={`${button} border border-ink-10 bg-surface`}>
        {m["appr.reject"]}
      </button>
      {status}
    </div>
  );
}
