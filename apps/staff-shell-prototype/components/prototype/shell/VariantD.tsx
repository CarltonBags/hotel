"use client";
// PROTOTYPE Variant D: round 2 of A, "navbar = left rail". Main Menu button top-left, quick-access buttons in the rail,
// pinnable tabs in a strip above the stage, bigger controls, colour per module, selectable accent.
import { Search } from "lucide-react";
import { HUE, INBOX_UNREAD, MODULES, QUICK } from "./mock";
import { KIND_ICON } from "./icons";
import { MainMenu } from "./MainMenu";
import { PropertyMenu } from "./PropertyMenu";
import { TabStrip } from "./TabStrip";
import { AccentSwatches, ThemeButton } from "./UserArea";
import { TabContent } from "./content";
import type { Workspace } from "./useWorkspace";

export const name = "Rail navbar + Menu + pinned tabs";

export function VariantD({ ws }: { ws: Workspace }) {
  return (
    <div className="flex h-dvh gap-6 p-6" style={{ background: "radial-gradient(900px 520px at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%), var(--canvas)" }}>
      <aside className="flex w-[248px] shrink-0 flex-col gap-4">
        <MainMenu ws={ws} wide />
        <PropertyMenu ws={ws} />
        <nav aria-label="Quick access" className="flex flex-col gap-1">
          {QUICK.map((k) => {
            const m = MODULES.find((x) => x.kind === k)!;
            const Icon = KIND_ICON[k];
            const on = ws.active?.kind === k;
            return (
              <button key={k} onClick={() => ws.openModule(k)} className={`flex h-12 items-center gap-3 rounded-[16px] px-2.5 text-[15px] transition-colors duration-100 ${on ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}>
                <span className="grid size-8 place-items-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${HUE[k]} 16%, transparent)`, color: HUE[k] }}><Icon size={19} strokeWidth={1.9} /></span>
                <span className="flex-1 text-left">{m.label}</span>
                {k === "inbox" && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-[12px] font-medium text-white">{INBOX_UNREAD}</span>}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 rounded-[20px] bg-surface p-3 shadow-card">
          <div className="flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-full bg-accent text-[13px] font-medium text-white">CB</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium leading-tight">Carlton B.</span><span className="block text-[12px] leading-tight text-ink-60">Front Desk</span></span>
            <ThemeButton ws={ws} />
          </div>
          <AccentSwatches ws={ws} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-3 pl-1">
          <TabStrip ws={ws} />
          <label className="flex h-11 w-72 items-center gap-2.5 rounded-full bg-surface px-4 text-ink-60 shadow-pill">
            <Search size={17} /><input placeholder="Search guest or reservation" className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-40" />
          </label>
        </div>
        <main className="min-h-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card"><TabContent tab={ws.active} ws={ws} /></main>
      </div>
    </div>
  );
}
