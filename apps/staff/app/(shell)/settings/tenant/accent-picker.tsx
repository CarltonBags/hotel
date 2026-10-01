"use client";

import { useTransition } from "react";
import { saveTenantAccent } from "@/app/(shell)/actions";
import { useShell } from "@/shell/ShellProvider";

export function AccentPicker({ current, accents, label }: { current: string; accents: { id: string; label: string; light: string; dark: string }[]; label: string }) {
  const { effectiveTheme } = useShell();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-3">
      {accents.map((a) => (
        <button
          type="button"
          key={a.id}
          role="radio"
          aria-checked={current === a.id}
          disabled={pending}
          onClick={() => start(() => saveTenantAccent(a.id))}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm ring-offset-2 ring-offset-surface-2 ${current === a.id ? "bg-surface shadow-pill ring-2 ring-ink-40" : "hover:bg-surface"}`}
        >
          <span className="size-5 rounded-full" style={{ background: effectiveTheme === "dark" ? a.dark : a.light }} />
          {a.label}
        </button>
      ))}
    </div>
  );
}
