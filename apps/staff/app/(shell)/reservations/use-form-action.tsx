"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";

/**
 * Run a server action from a button: shows its message, refreshes the page's
 * data on success and runs `after` (say, to clear a form).
 */
export function useFormAction(m: Messages) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.error ? { kind: "error", text: res.error } : { kind: "ok", text: res.message ?? m["grid.saved"] });
      if (!res.error) {
        after?.();
        router.refresh();
      }
    });
  const note = message ? (
    <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : "text-ink-60"}`}>
      {message.text}
    </p>
  ) : null;
  return { pending, run, note };
}
