"use client";
// PROTOTYPE Variant E: round 2 of A, "navbar = top bar". Main Menu button top-left, quick-access buttons in a floating top navbar,
// pinnable tab strip directly below the navbar, full-width rounded stage. No left rail.
import { Search } from "lucide-react";
import { HUE, INBOX_UNREAD, MODULES, QUICK } from "./mock";
import { KIND_ICON } from "./icons";
import { MainMenu } from "./MainMenu";
import { PropertyMenu } from "./PropertyMenu";
import { TabStrip } from "./TabStrip";
import { AccentSwatches, ThemeButton } from "./UserArea";
import { TabContent } from "./content";
import type { Workspace } from "./useWorkspace";

export const name = "Top navbar + Menu + pinned tabs";

export function VariantE({ ws, content, contentKind = "calendar" }: { ws: Workspace; content?: React.ReactNode; contentKind?: string }) {
  return (
    <div className="flex h-dvh flex-col gap-2 p-5" style={{ background: "radial-gradient(1100px 420px at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%), var(--canvas)" }}>
      <header className="flex shrink-0 items-center gap-3">
        <MainMenu ws={ws} />
        <PropertyMenu ws={ws} className="w-52 shrink-0" />
        <nav aria-label="Quick access" className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-[20px] bg-surface p-1 shadow-pill">
          {QUICK.map((k) => {
            const m = MODULES.find((x) => x.kind === k)!;
            const Icon = KIND_ICON[k];
            const on = ws.active?.kind === k;
            return (
              <button key={k} onClick={() => ws.openModule(k)} className={`relative flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[14px] pl-1.5 pr-3.5 text-[14px] transition-colors duration-100 ${on ? "bg-ink-10 font-medium" : "text-ink-80 hover:bg-ink-5"}`}>
                <span className="grid size-7 place-items-center rounded-[9px]" style={{ background: `color-mix(in srgb, ${HUE[k]} 16%, transparent)`, color: HUE[k] }}><Icon size={17} strokeWidth={1.9} /></span>
                {m.label}
                {k === "inbox" && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-medium text-white">{INBOX_UNREAD}</span>}
              </button>
            );
          })}
        </nav>
        <label className="ml-auto flex h-12 min-w-40 max-w-72 flex-1 items-center gap-2.5 rounded-[16px] bg-surface px-4 text-ink-60 shadow-pill">
          <Search size={17} /><input placeholder="Search" className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-40" />
        </label>
        <div className="flex h-12 shrink-0 items-center rounded-[16px] bg-surface px-3 shadow-pill"><AccentSwatches ws={ws} /></div>
        <ThemeButton ws={ws} />
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-medium text-white">CB</span>
      </header>

      <div className="flex shrink-0 items-center pl-1"><TabStrip ws={ws} /></div>
      <main className="min-h-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card">{content && ws.active?.kind === contentKind ? content : <TabContent tab={ws.active} ws={ws} />}</main>
    </div>
  );
}
