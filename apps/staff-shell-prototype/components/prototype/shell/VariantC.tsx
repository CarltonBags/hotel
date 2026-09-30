"use client";
// PROTOTYPE Variant C: "Dock + open items + split". Floating module dock at the top centre, open records as a grouped vertical list, up to two stages side by side.
import { Columns2, Moon, PanelRightClose, Sun, X } from "lucide-react";
import { INBOX_UNREAD, MODULES, type Tab } from "./mock";
import { KIND_ICON } from "./icons";
import { PropertyMenu } from "./PropertyMenu";
import { TabContent } from "./content";
import type { Workspace } from "./useWorkspace";

export const name = "Dock + open items + split view";

const GROUPS: { label: string; match: (t: Tab) => boolean }[] = [
  { label: "Modules", match: (t) => t.kind !== "reservation" && t.kind !== "guest" },
  { label: "Reservations", match: (t) => t.kind === "reservation" },
  { label: "Guests", match: (t) => t.kind === "guest" },
];

export function VariantC({ ws }: { ws: Workspace }) {
  return (
    <div className="flex h-dvh flex-col gap-3 bg-canvas p-4">
      <div className="flex shrink-0 items-center gap-3">
        <PropertyMenu ws={ws} className="w-60" />
        <nav className="mx-auto flex items-center gap-1 rounded-[22px] bg-surface p-1.5 shadow-pill">
          {MODULES.map((m) => {
            const Icon = KIND_ICON[m.kind];
            const on = ws.active?.kind === m.kind || ws.split?.kind === m.kind;
            return (
              <button key={m.kind} onClick={() => ws.openModule(m.kind)} className={`relative flex h-14 w-[76px] flex-col items-center justify-center gap-1 rounded-[16px] text-[11px] transition-transform duration-100 hover:-translate-y-px ${on ? "bg-ink text-canvas" : "text-ink-80 hover:bg-ink-5"}`}>
                <Icon size={22} strokeWidth={1.75} />
                {m.label}
                {m.kind === "inbox" && <span className="absolute right-3 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-white">{INBOX_UNREAD}</span>}
              </button>
            );
          })}
        </nav>
        <div className="flex w-60 items-center justify-end gap-2">
          <button aria-label="Toggle theme" onClick={ws.toggleTheme} className="grid size-10 place-items-center rounded-full bg-surface shadow-pill">{ws.theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
          <span className="grid size-10 place-items-center rounded-full bg-surface text-[12px] font-medium shadow-pill">CB</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <aside className="w-60 shrink-0 overflow-auto rounded-[20px] bg-surface p-2 shadow-card">
          {GROUPS.map((g) => {
            const items = ws.tabs.filter(g.match);
            if (!items.length) return null;
            return (
              <div key={g.label} className="mb-2">
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-40">{g.label}</div>
                {items.map((t) => {
                  const Icon = KIND_ICON[t.kind];
                  const on = t.id === ws.activeId;
                  const inSplit = t.id === ws.splitId;
                  return (
                    <div key={t.id} className={`group flex h-9 items-center rounded-[10px] pl-2 pr-1 text-[13px] ${on ? "bg-ink-10 font-medium" : inSplit ? "bg-accent/10" : "hover:bg-ink-5"}`}>
                      <button onClick={() => ws.activate(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <Icon size={16} strokeWidth={1.75} className={on ? "text-accent" : "text-ink-60"} />
                        <span className="truncate">{t.title}</span>
                      </button>
                      <button aria-label={`Open ${t.title} in split view`} title="Open beside" onClick={() => ws.setSplitId(inSplit ? null : t.id)} className="grid size-6 place-items-center rounded-[8px] text-ink-60 opacity-0 hover:bg-ink-10 focus:opacity-100 group-hover:opacity-100"><Columns2 size={14} /></button>
                      <button aria-label={`Close ${t.title}`} onClick={() => ws.close(t.id)} className="grid size-6 place-items-center rounded-[8px] text-ink-60 hover:bg-ink-10"><X size={14} /></button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card"><TabContent tab={ws.active} ws={ws} /></main>
        {ws.split && ws.split.id !== ws.activeId && (
          <section className="relative min-w-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card">
            <button aria-label="Close split view" onClick={() => ws.setSplitId(null)} className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-surface shadow-pill"><PanelRightClose size={15} /></button>
            <TabContent tab={ws.split} ws={ws} />
          </section>
        )}
      </div>
    </div>
  );
}
