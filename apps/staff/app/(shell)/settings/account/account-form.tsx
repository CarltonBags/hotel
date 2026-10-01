"use client";

import { useState, useTransition } from "react";
import { savePreferences } from "@/app/(shell)/actions";

export function AccountForm({
  language,
  theme,
  quickAccess,
  options,
  labels,
}: {
  language: "de" | "en";
  theme: "light" | "dark" | "system";
  quickAccess: string[] | null;
  options: { id: string; label: string }[];
  labels: Record<"language" | "theme" | "light" | "dark" | "system" | "quickAccess" | "quickAccessHelp" | "save" | "saved", string>;
}) {
  const [lang, setLang] = useState(language);
  const [th, setTh] = useState(theme);
  const [quick, setQuick] = useState<string[]>(quickAccess ?? []);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const select = "h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm";

  return (
    <form
      className="mt-6 grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await savePreferences({ language: lang, theme: th, quickAccess: quick.length ? quick : null });
          setSaved(true);
        });
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{labels.language}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as "de" | "en")} className={select}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-80">{labels.theme}</span>
          <select value={th} onChange={(e) => setTh(e.target.value as typeof th)} className={select}>
            <option value="light">{labels.light}</option>
            <option value="dark">{labels.dark}</option>
            <option value="system">{labels.system}</option>
          </select>
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm text-ink-80">{labels.quickAccess}</legend>
        <p className="text-sm text-ink-60">{labels.quickAccessHelp}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {options.map((o) => {
            const on = quick.includes(o.id);
            return (
              <label key={o.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && quick.length >= 8}
                  onChange={(e) => setQuick(e.target.checked ? [...quick, o.id] : quick.filter((x) => x !== o.id))}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      {saved ? <p role="status" className="text-sm text-success">{labels.saved}</p> : null}
      <button type="submit" disabled={pending} className="h-10 justify-self-start rounded-full bg-accent px-5 text-sm font-medium text-white shadow-pill disabled:opacity-60">
        {labels.save}
      </button>
    </form>
  );
}
