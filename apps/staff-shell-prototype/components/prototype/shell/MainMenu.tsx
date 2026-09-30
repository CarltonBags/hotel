"use client";
// PROTOTYPE shared control: the one main button that opens the nested menu of every list and function.
import { useEffect, useRef, useState } from "react";
import { ChevronRight, LayoutGrid, Search } from "lucide-react";
import { MAIN_MENU } from "./mock";
import { MENU_ICON } from "./icons";
import type { Workspace } from "./useWorkspace";

export function MainMenu({ ws, wide = false }: { ws: Workspace; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(1);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("menu") === "1") setOpen(true); // PROTOTYPE debug param
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, []);

  const pick = (label: string, kind?: string) => {
    if (kind) ws.openModule(kind as never); else ws.openList(label);
    setOpen(false); setQ("");
  };
  const hits = q ? MAIN_MENU.flatMap((g) => g.items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())).map((i) => ({ ...i, group: g.group }))) : [];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex h-12 shrink-0 items-center gap-2.5 rounded-[16px] bg-accent px-4 text-[15px] font-medium text-white shadow-pill transition-transform duration-100 hover:brightness-105 active:scale-[0.98] ${wide ? "w-full" : ""}`}
      >
        <LayoutGrid size={20} strokeWidth={1.9} />
        Menu
      </button>
      {open && (
        <div className="absolute left-0 top-14 z-40 w-[620px] overflow-hidden rounded-[24px] bg-surface shadow-pop">
          <label className="flex h-14 items-center gap-3 border-b border-ink-10 px-5 text-ink-60">
            <Search size={18} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a list or function" className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-40" />
          </label>
          {q ? (
            <div className="max-h-[420px] overflow-auto p-2">
              {hits.length === 0 && <div className="p-4 text-ink-60">Nothing found.</div>}
              {hits.map((i) => (
                <button key={i.group + i.label} onClick={() => pick(i.label, i.kind)} className="flex h-11 w-full items-center justify-between rounded-[12px] px-3 text-left text-[15px] hover:bg-ink-5">
                  {i.label}<span className="text-[12px] text-ink-40">{i.group}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[260px_1fr]">
              <div className="border-r border-ink-10 p-2">
                {MAIN_MENU.map((g, i) => {
                  const Icon = MENU_ICON[g.icon];
                  return (
                    <button key={g.group} onMouseEnter={() => setGroup(i)} onFocus={() => setGroup(i)} onClick={() => setGroup(i)} className={`flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] ${group === i ? "bg-ink-10 font-medium" : "hover:bg-ink-5"}`}>
                      <Icon size={19} strokeWidth={1.75} className={group === i ? "text-accent" : "text-ink-60"} />
                      <span className="flex-1">{g.group}</span>
                      <ChevronRight size={16} className="text-ink-40" />
                    </button>
                  );
                })}
              </div>
              <div className="p-2">
                <div className="px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{MAIN_MENU[group].group}</div>
                {MAIN_MENU[group].items.map((i) => (
                  <button key={i.label} onClick={() => pick(i.label, i.kind)} className="flex h-11 w-full items-center rounded-[12px] px-3 text-left text-[15px] hover:bg-ink-5">{i.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
