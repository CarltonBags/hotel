"use client";

import { useCallback, useRef, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useShell } from "./ShellProvider";
import { onArrowKeys, useDismiss } from "./useDismiss";

/** Property switcher; "All properties" for users with access to more than one; a plain label with one. */
export function PropertyMenu() {
  const { t, properties, scope, setScope } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const current = properties.find((p) => p.id === scope);
  const title = current ? current.name : t("shell.allProperties");
  const subtitle = current ? `${current.country} · ${current.currency}` : `${properties.length} ${t("shell.properties")}`;
  const options = properties.length > 1 ? [{ id: "all", name: t("shell.allProperties"), sub: `${properties.length} ${t("shell.properties")}` }, ...properties.map((p) => ({ id: p.id, name: p.name, sub: `${p.legalEntityName} · ${p.country}` }))] : properties.map((p) => ({ id: p.id, name: p.name, sub: `${p.legalEntityName} · ${p.country}` }));

  if (properties.length === 0) return null;
  // one property: its name only, nothing to switch
  if (properties.length === 1 && current) {
    return (
      <div aria-label={t("shell.property")} className="flex h-12 w-56 shrink-0 items-center gap-2 rounded-[16px] bg-surface px-3 shadow-pill">
        <Building2 size={18} className="shrink-0 text-ink-60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{current.name}</span>
          <span className="block truncate text-[11px] leading-tight text-ink-60">{subtitle}</span>
        </span>
      </div>
    );
  }
  return (
    <div ref={ref} className="relative w-56 shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t("shell.property")}
        className="flex h-12 w-full items-center gap-2 rounded-[16px] bg-surface px-3 text-left shadow-pill hover:bg-surface-2"
      >
        <Building2 size={18} className="shrink-0 text-ink-60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{title}</span>
          <span className="block truncate text-[11px] leading-tight text-ink-60">{subtitle}</span>
        </span>
        <ChevronDown size={16} className="text-ink-60" />
      </button>
      {open && (
        <div role="listbox" onKeyDown={onArrowKeys} className="absolute left-0 top-14 z-30 w-72 rounded-[14px] bg-surface p-1 shadow-pop">
          {options.map((o) => (
            <button
              type="button"
              role="option"
              aria-selected={o.id === scope}
              key={o.id}
              onClick={() => {
                setScope(o.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-ink-5"
            >
              <span className="flex-1">
                <span className="block text-[13px] font-medium">{o.name}</span>
                <span className="block text-[11px] text-ink-60">{o.sub}</span>
              </span>
              {o.id === scope && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
