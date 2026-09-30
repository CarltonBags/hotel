"use client";
// PROTOTYPE Variant B: "Top bar + browser tabs". No rail, no inset: full-bleed content, modules in a horizontal menu, tabs attached to the content like a browser.
import { Moon, Plus, Search, Sun, X } from "lucide-react";
import { INBOX_UNREAD, MODULES } from "./mock";
import { KIND_ICON } from "./icons";
import { PropertyMenu } from "./PropertyMenu";
import { TabContent } from "./content";
import type { Workspace } from "./useWorkspace";

export const name = "Top bar + browser tabs";

export function VariantB({ ws }: { ws: Workspace }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 px-4">
        <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-[15px] font-medium text-canvas">H</span>
        <PropertyMenu ws={ws} className="w-56" />
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {MODULES.map((m) => {
            const Icon = KIND_ICON[m.kind];
            const on = ws.active?.kind === m.kind;
            return (
              <button key={m.kind} onClick={() => ws.openModule(m.kind)} className={`relative flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[13px] ${on ? "font-medium text-ink" : "text-ink-60 hover:bg-ink-5 hover:text-ink"}`}>
                <Icon size={18} strokeWidth={1.75} className={on ? "text-accent" : ""} />
                {m.label}
                {m.kind === "inbox" && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-white">{INBOX_UNREAD}</span>}
                {on && <span className="absolute inset-x-3 -bottom-[10px] h-0.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </nav>
        <label className="flex h-9 w-64 items-center gap-2 rounded-[10px] bg-surface px-3 text-ink-60 shadow-pill">
          <Search size={15} /><input placeholder="Search guest or reservation" className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-40" />
        </label>
        <button aria-label="Toggle theme" onClick={ws.toggleTheme} className="grid size-9 place-items-center rounded-[10px] hover:bg-ink-5">{ws.theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
        <span className="grid size-9 place-items-center rounded-full bg-ink-10 text-[12px] font-medium">CB</span>
      </header>

      <div role="tablist" className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto px-3">
        {ws.tabs.map((t, i) => {
          const Icon = KIND_ICON[t.kind];
          const on = t.id === ws.activeId;
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => ws.move(Number(e.dataTransfer.getData("text/plain")), i)}
              className={`flex h-9 w-52 shrink-0 items-center rounded-t-[12px] pl-3 pr-1.5 text-[13px] ${on ? "bg-surface font-medium" : "bg-ink-5 text-ink-60 hover:bg-ink-10"}`}
            >
              <button role="tab" aria-selected={on} onClick={() => ws.activate(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <Icon size={15} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{t.title}</span>
                {t.sub && <span className="shrink-0 font-mono text-[11px] text-ink-40">{t.sub}</span>}
              </button>
              <button aria-label={`Close ${t.title}`} onClick={() => ws.close(t.id)} className="grid size-6 shrink-0 place-items-center rounded-[8px] hover:bg-ink-10"><X size={14} /></button>
            </div>
          );
        })}
        <button aria-label="New reservation" onClick={() => ws.open({ id: `R-${49000 + ws.tabs.length}`, kind: "reservation", title: "New reservation", sub: "draft" })} className="mb-1 ml-1 grid size-7 shrink-0 place-items-center rounded-[8px] text-ink-60 hover:bg-ink-10"><Plus size={16} /></button>
      </div>

      <main className="min-h-0 flex-1 overflow-auto bg-surface"><TabContent tab={ws.active} ws={ws} /></main>
    </div>
  );
}
