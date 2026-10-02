"use client";

import { useId, useMemo, useState } from "react";
import { WORLD_COUNTRIES, type Language } from "@hoteloftware/domain";

/** Country names in the user's language from the browser's own data, by ISO code. */
export function countryNames(language: Language): Map<string, string> {
  const dn = new Intl.DisplayNames([language], { type: "region" });
  return new Map(WORLD_COUNTRIES.map((c) => [c, dn.of(c) ?? c]));
}

/**
 * A searchable country field: type part of the name or the code, pick from
 * the list. Submits the ISO code under `name`.
 */
export function CountryPicker({
  label,
  name,
  defaultValue,
  readOnly,
  language,
  marked,
  onChange,
}: {
  label: string;
  name: string;
  defaultValue: string;
  readOnly?: boolean | undefined;
  language: Language;
  marked?: boolean | undefined;
  onChange?: ((code: string) => void) | undefined;
}) {
  const names = useMemo(() => countryNames(language), [language]);
  const [code, setCode] = useState(defaultValue.toUpperCase());
  const [text, setText] = useState(code ? (names.get(code) ?? code) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [...names.entries()].slice(0, 8);
    const all = [...names.entries()];
    const exact = all.filter(([c]) => c.toLowerCase() === q);
    const starts = all.filter(([c, n]) => c.toLowerCase() !== q && n.toLowerCase().startsWith(q));
    const contains = all.filter(([c, n]) => c.toLowerCase() !== q && !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
    return [...exact, ...starts, ...contains].slice(0, 8);
  }, [names, q]);
  const pick = (c: string) => {
    setCode(c);
    setText(names.get(c) ?? c);
    setOpen(false);
    onChange?.(c);
  };
  return (
    <label className="relative grid gap-1 text-sm">
      <span className="text-ink-80">
        {label}
        {marked ? <span title="Registration" className="ml-1 text-accent">•</span> : null}
      </span>
      <input type="hidden" name={name} value={code} />
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        value={text}
        readOnly={readOnly}
        onFocus={(e) => {
          if (readOnly) return;
          // typing replaces the shown country at once
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          // leaving the field: an empty text clears, anything else keeps the last picked country
          setTimeout(() => setOpen(false), 120);
          if (!text.trim()) {
            setCode("");
            onChange?.("");
          } else setText(code ? (names.get(code) ?? code) : "");
        }}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, matches.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter" && open && matches[active]) (e.preventDefault(), pick(matches[active]![0]));
          if (e.key === "Escape") setOpen(false);
        }}
        className={`h-10 w-full rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm${readOnly ? " opacity-60" : ""}`}
      />
      {open && matches.length ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-xl bg-surface p-1 shadow-pop">
          {matches.map(([c, n], i) => (
            <li
              key={c}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(c))}
              className={`flex cursor-pointer justify-between rounded-lg px-3 py-1.5 ${i === active ? "bg-ink-5" : ""}`}
            >
              <span>{n}</span>
              <span className="text-ink-60">{c}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}
