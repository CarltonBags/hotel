"use client";

import { Building2 } from "lucide-react";
import { useShell } from "./ShellProvider";

/** After sign-in: a front-office user with roles at several properties chooses where they work now. */
export function PropertyChooser() {
  const { t, user, propertyChoices, setScope } = useShell();
  return (
    <main className="grid min-h-dvh place-items-center p-6" style={{ background: "var(--canvas)" }}>
      <section aria-label={t("shell.chooseProperty")} className="grid w-full max-w-md gap-4 rounded-2xl bg-surface p-6 shadow-pop">
        <div>
          <h1 className="text-xl font-medium">{t("shell.chooseProperty")}</h1>
          <p className="text-sm text-ink-60">{t("shell.choosePropertyHelp", { name: user.name })}</p>
        </div>
        <ul className="grid gap-2">
          {propertyChoices.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setScope(p.id)} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-left hover:bg-ink-5">
                <Building2 size={18} className="text-ink-60" />
                <span>
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-xs text-ink-60">
                    {p.legalEntityName} · {p.country}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
