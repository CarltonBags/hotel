"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { globalSearch, setPropertyScope, type SearchHits } from "@/app/(shell)/actions";
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
export function Shell({ children, banner }: { children: React.ReactNode; banner?: React.ReactNode }) {
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
      <header className="flex shrink-0 items-center gap-3 print:hidden">
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

      {banner}
      <div className="flex shrink-0 items-center print:hidden">
        <TabStrip />
      </div>
      <main className="min-h-0 flex-1 overflow-auto rounded-stage bg-surface shadow-card print:overflow-visible print:shadow-none">{children}</main>
      <Notifications />
    </div>
  );
}

/**
 * Navbar search: functions from the Main Menu, and from two characters on
 * reservations at every property the user may see and Guest profiles. A
 * reservation at another property switches the navbar to that property first.
 */
function SearchBox({ visible }: { visible: ModuleDef[] }) {
  const { t, moduleLabel, openModule, openRecord, scope, language } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHits>({ reservations: [], guests: [] });
  const query = q.trim().toLowerCase();
  const functions = query ? visible.filter((m) => moduleLabel(m).toLowerCase().includes(query)).slice(0, 6) : [];
  useEffect(() => {
    // results of an older query must not stay selectable while a new one runs
    setHits({ reservations: [], guests: [] });
    if (query.length < 2) return;
    let current = true;
    const timer = setTimeout(() => {
      void globalSearch(query).then((h) => {
        if (current) setHits(h);
      });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const shortDate = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const clear = () => {
    setQ("");
    setHits({ reservations: [], guests: [] });
  };
  const openReservation = async (r: SearchHits["reservations"][number]) => {
    clear();
    if (scope !== r.propertyId) {
      await setPropertyScope(r.propertyId);
      router.push(`/reservations/${r.id}`);
      return;
    }
    openRecord("reservations", r.id, `${r.confirmationNumber} · ${r.guestName}`, `/reservations/${r.id}`);
  };
  const options: { key: string; group: string; label: string; detail?: string; run: () => void }[] = [
    ...functions.map((m) => ({ key: `m:${m.id}`, group: t("shell.searchFunctions"), label: moduleLabel(m), run: () => (openModule(m.id), clear()) })),
    ...hits.reservations.map((r) => ({
      key: `r:${r.id}`,
      group: t("shell.searchReservations"),
      label: `${r.confirmationNumber} · ${r.guestName} · ${shortDate(r.arrival)} – ${shortDate(r.departure)}`,
      detail: r.propertyName,
      run: () => void openReservation(r),
    })),
    ...hits.guests.map((g) => ({ key: `g:${g.id}`, group: t("shell.searchGuests"), label: g.name, run: () => (openRecord("guests", g.id, g.name, `/guests/${g.id}`), clear()) })),
  ];
  return (
    <div className="relative ml-auto min-w-40 max-w-72 flex-1">
      <label className="flex h-12 items-center gap-2.5 rounded-[16px] bg-surface px-4 text-ink-60 shadow-pill">
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && options[0]) options[0].run();
            if (e.key === "Escape") clear();
            if (e.key === "ArrowDown") (e.currentTarget.parentElement?.nextElementSibling?.querySelector("[role=option]") as HTMLElement | null)?.focus();
          }}
          placeholder={t("shell.search")}
          aria-label={t("shell.search")}
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-40"
        />
      </label>
      {options.length > 0 && (
        <div role="listbox" aria-label={t("shell.search")} onKeyDown={onArrowKeys} className="absolute right-0 top-14 z-30 w-[28rem] max-w-[90vw] rounded-[14px] bg-surface p-1 shadow-pop">
          {options.map((o, i) => (
            <div key={o.key}>
              {i === 0 || options[i - 1]!.group !== o.group ? <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-40">{o.group}</div> : null}
              <button type="button" role="option" aria-selected={undefined} onClick={o.run} className="flex min-h-10 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[14px] hover:bg-ink-5">
                <span className="truncate">{o.label}</span>
                {o.detail ? <span className="ml-auto shrink-0 text-[12px] text-ink-60">{o.detail}</span> : null}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
