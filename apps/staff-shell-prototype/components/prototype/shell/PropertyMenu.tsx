"use client";
// PROTOTYPE shared control (not layout): property switcher popover.
import { useState } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";
import { PROPERTIES } from "./mock";
import type { Workspace } from "./useWorkspace";

export function PropertyMenu({ ws, className = "", align = "left" }: { ws: Workspace; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const cur = PROPERTIES.find((p) => p.id === ws.propertyId)!;
  return (
    <div className={`relative ${className}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-10 w-full items-center gap-2 rounded-[14px] bg-surface px-3 text-left shadow-pill hover:bg-surface-2">
        <Building2 size={18} className="shrink-0 text-ink-60" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">{cur.name}</span>
          <span className="block truncate text-[11px] leading-tight text-ink-60">{cur.city}</span>
        </span>
        <ChevronDown size={16} className="text-ink-60" />
      </button>
      {open && (
        <div className={`absolute top-11 z-30 w-64 rounded-[14px] bg-surface p-1 shadow-pop ${align === "right" ? "right-0" : "left-0"}`}>
          {PROPERTIES.map((p) => (
            <button key={p.id} onClick={() => { ws.setPropertyId(p.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-ink-5">
              <span className="flex-1">
                <span className="block text-[13px] font-medium">{p.name}</span>
                <span className="block text-[11px] text-ink-60">{p.city} · {p.rooms} rooms</span>
              </span>
              {p.id === ws.propertyId && <Check size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
