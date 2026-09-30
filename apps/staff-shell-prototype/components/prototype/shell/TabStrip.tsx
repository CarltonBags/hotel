"use client";
// PROTOTYPE shared control: workspace tabs with pinning. Pinned tabs sit first, icon-only, and cannot be closed until unpinned.
import { Pin, PinOff, Plus, X } from "lucide-react";
import { HUE } from "./mock";
import { KIND_ICON } from "./icons";
import type { Workspace } from "./useWorkspace";

export function TabStrip({ ws }: { ws: Workspace }) {
  return (
    <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1">
      {ws.ordered.map((t) => {
        const Icon = KIND_ICON[t.kind];
        const on = t.id === ws.activeId;
        const pinned = ws.pinned.includes(t.id);
        const i = ws.tabs.findIndex((x) => x.id === t.id);
        return (
          <div
            key={t.id}
            draggable={!pinned}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => ws.move(Number(e.dataTransfer.getData("text/plain")), i)}
            title={pinned ? `${t.title} (pinned)` : t.title}
            className={`group relative flex h-10 shrink-0 items-center rounded-full text-[14px] transition-colors duration-100 ${pinned ? "px-1" : "pl-3.5 pr-1"} ${on ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}
          >
            <button role="tab" aria-selected={on} aria-label={t.title} onClick={() => ws.activate(t.id)} className={`flex items-center gap-2 ${pinned ? "size-8 justify-center" : ""}`}>
              <Icon size={17} strokeWidth={1.8} style={{ color: on ? HUE[t.kind] : undefined }} />
              {!pinned && <span className="max-w-44 truncate">{t.title}</span>}
            </button>
            <button aria-label={pinned ? `Unpin ${t.title}` : `Pin ${t.title}`} onClick={() => ws.togglePin(t.id)} className={`grid size-7 place-items-center rounded-full text-ink-60 hover:bg-ink-10 ${pinned ? "absolute -right-1 -top-1 hidden size-5 bg-surface shadow-pill group-hover:grid" : "ml-1 opacity-0 focus:opacity-100 group-hover:opacity-100"}`}>
              {pinned ? <PinOff size={11} /> : <Pin size={14} />}
            </button>
            {!pinned && <button aria-label={`Close ${t.title}`} onClick={() => ws.close(t.id)} className="grid size-7 place-items-center rounded-full text-ink-60 hover:bg-ink-10"><X size={15} /></button>}
          </div>
        );
      })}
      <button onClick={ws.newReservation} className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] text-ink-60 hover:bg-ink-5 hover:text-ink"><Plus size={18} />New reservation</button>
    </div>
  );
}
