"use client";
// PROTOTYPE Variant A: "Rail + Stage". Warmwind two-layer shell: inset canvas, labelled left rail, one rounded stage, pill tabs in the stage header.
import { Moon, Plus, Search, Sun, X } from "lucide-react";
import { INBOX_UNREAD, MODULES } from "./mock";
import { KIND_ICON } from "./icons";
import { PropertyMenu } from "./PropertyMenu";
import { TabContent } from "./content";
import type { Workspace } from "./useWorkspace";

export const name = "Rail + Stage";

export function VariantA({ ws }: { ws: Workspace }) {
  return (
    <div className="flex h-dvh gap-5 bg-canvas p-5">
      <aside className="flex w-[220px] shrink-0 flex-col gap-4">
        <div className="flex items-center gap-2 px-2 pt-1 text-[17px] font-medium tracking-tight">
          <span className="grid size-7 place-items-center rounded-[10px] bg-ink text-canvas">H</span>Hoteloftware
        </div>
        <PropertyMenu ws={ws} />
        <nav className="flex flex-col gap-0.5">
          {MODULES.map((m) => {
            const Icon = KIND_ICON[m.kind];
            const on = ws.active?.kind === m.kind;
            return (
              <button key={m.kind} onClick={() => ws.openModule(m.kind)} className={`flex h-10 items-center gap-3 rounded-[14px] px-3 text-[14px] transition-colors duration-100 ${on ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}>
                <Icon size={20} strokeWidth={1.75} className={on ? "text-accent" : ""} />
                <span className="flex-1 text-left">{m.label}</span>
                {m.kind === "inbox" && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-white">{INBOX_UNREAD}</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2 rounded-[14px] bg-surface p-2 shadow-pill">
          <span className="grid size-8 place-items-center rounded-full bg-ink-10 text-[12px] font-medium">CB</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium leading-tight">Carlton B.</span><span className="block text-[11px] leading-tight text-ink-60">Front Desk</span></span>
          <button aria-label="Toggle theme" onClick={ws.toggleTheme} className="grid size-8 place-items-center rounded-full hover:bg-ink-5">{ws.theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-stage bg-surface shadow-card">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-ink-10 px-3">
          <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
                  className={`group flex h-8 shrink-0 items-center rounded-full pl-3 pr-1 text-[13px] ${on ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`}
                >
                  <button role="tab" aria-selected={on} onClick={() => ws.activate(t.id)} className="flex items-center gap-1.5">
                    <Icon size={15} strokeWidth={1.75} />
                    <span className="max-w-40 truncate">{t.title}</span>
                  </button>
                  <button aria-label={`Close ${t.title}`} onClick={() => ws.close(t.id)} className={`ml-1 grid size-6 place-items-center rounded-full ${on ? "hover:bg-canvas/20" : "hover:bg-ink-10"}`}><X size={14} /></button>
                </div>
              );
            })}
            <button aria-label="New reservation" onClick={() => ws.open({ id: `R-${49000 + ws.tabs.length}`, kind: "reservation", title: "New reservation", sub: "draft" })} className="grid size-8 shrink-0 place-items-center rounded-full text-ink-60 hover:bg-ink-5"><Plus size={16} /></button>
          </div>
          <label className="flex h-8 w-56 items-center gap-2 rounded-full bg-surface-2 px-3 text-ink-60">
            <Search size={15} /><input placeholder="Search guest or reservation" className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-40" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto"><TabContent tab={ws.active} ws={ws} /></div>
      </main>
    </div>
  );
}
