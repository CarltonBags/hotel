"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { iconFor } from "./icons";
import { MainMenu } from "./MainMenu";
import { PropertyMenu } from "./PropertyMenu";
import { MODULES, type ModuleDef } from "./registry";
import { useShell } from "./ShellProvider";
import { onArrowKeys } from "./useDismiss";
import { Notifications } from "./Notifications";
import { TabStrip } from "./TabStrip";
import { ThemeToggle, UserMenu } from "./UserMenu";

/**
 * Variant E from the prototype: floating navbar (Main Menu, property switcher,
 * Quick Access, search, theme, user), tab strip, one full-width Stage.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const shell = useShell();
  const { t, moduleLabel, quickAccess, activeId, openModule, canManageTenant, propertyActions } = shell;
  const visible = useMemo(
    () => MODULES.filter((m) => (!m.requires || canManageTenant) && (!m.requiresProperty || propertyActions.includes(m.requiresProperty))),
    [canManageTenant, propertyActions],
  );
  const quick = quickAccess.map((id) => visible.find((m) => m.id === id)).filter((m): m is ModuleDef => m !== undefined);

  return (
    <div
      className="flex h-dvh flex-col gap-2 p-4 md:p-5"
      style={{ background: "radial-gradient(1100px 420px at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%), var(--canvas)" }}
    >
      <header className="flex shrink-0 items-center gap-3">
        <MainMenu visible={visible} />
        <PropertyMenu />
        <nav aria-label={t("shell.quickAccess")} className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-[20px] bg-surface p-1 shadow-pill">
          {quick.map((m) => {
            const Icon = iconFor(m.icon);
            const on = activeId === m.id;
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => openModule(m.id)}
                aria-current={on ? "page" : undefined}
                className={`relative flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[14px] pl-1.5 pr-3.5 text-[14px] transition-colors duration-100 ${on ? "bg-ink-10 font-medium" : "text-ink-80 hover:bg-ink-5"}`}
              >
                <span className="grid size-7 place-items-center rounded-[9px]" style={{ background: `color-mix(in srgb, ${m.hue} 16%, transparent)`, color: m.hue }}>
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                {moduleLabel(m)}
              </button>
            );
          })}
        </nav>
        <SearchBox visible={visible} />
        <ThemeToggle />
        <UserMenu />
      </header>

      <div className="flex shrink-0 items-center">
        <TabStrip />
      </div>
      <main className="min-h-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card">{children}</main>
      <Notifications />
    </div>
  );
}

/** Navbar search: finds lists and functions now; records join in ticket 25. */
function SearchBox({ visible }: { visible: ModuleDef[] }) {
  const { t, moduleLabel, openModule } = useShell();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const hits = query ? visible.filter((m) => moduleLabel(m).toLowerCase().includes(query)).slice(0, 8) : [];
  return (
    <div className="relative ml-auto min-w-40 max-w-72 flex-1">
      <label className="flex h-12 items-center gap-2.5 rounded-[16px] bg-surface px-4 text-ink-60 shadow-pill">
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              openModule(hits[0].id);
              setQ("");
            }
            if (e.key === "Escape") setQ("");
            if (e.key === "ArrowDown") (e.currentTarget.parentElement?.nextElementSibling?.querySelector("[role=option]") as HTMLElement | null)?.focus();
          }}
          placeholder={t("shell.search")}
          aria-label={t("shell.search")}
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-40"
        />
      </label>
      {hits.length > 0 && (
        <div role="listbox" onKeyDown={onArrowKeys} className="absolute right-0 top-14 z-30 w-full rounded-[14px] bg-surface p-1 shadow-pop">
          {hits.map((m) => (
            <button
              type="button"
              role="option"
              aria-selected={undefined}
              key={m.id}
              onClick={() => {
                openModule(m.id);
                setQ("");
              }}
              className="flex h-10 w-full items-center rounded-[10px] px-3 text-left text-[14px] hover:bg-ink-5"
            >
              {moduleLabel(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
