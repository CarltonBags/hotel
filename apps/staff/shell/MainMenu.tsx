"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LayoutGrid, Search, Star } from "lucide-react";
import { toggleQuickAccess } from "@/app/(shell)/actions";
import { iconFor } from "./icons";
import { GROUPS, type ModuleDef } from "./registry";
import { useShell } from "./ShellProvider";
import { onArrowKeys, useDismiss } from "./useDismiss";

/** The one entry to every list and function: groups on the left, items on the right, search on top. */
export function MainMenu({ visible }: { visible: ModuleDef[] }) {
  const shell = useShell();
  const { t, moduleLabel, menuOpen: open, setMenuOpen: setOpen } = shell;
  const [group, setGroup] = useState(0);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const groups = GROUPS.filter((g) => visible.some((m) => m.group === g.id));

  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(ref, open, close);

  const pick = (m: ModuleDef) => {
    shell.openModule(m.id);
    setOpen(false);
    setQ("");
  };
  const query = q.trim().toLowerCase();
  const hits = query ? visible.filter((m) => moduleLabel(m).toLowerCase().includes(query)) : [];
  const current = groups[group] ?? groups[0];
  const items = current ? visible.filter((m) => m.group === current.id) : [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("shell.mainMenu")}
        className="flex h-12 shrink-0 items-center gap-2.5 rounded-[16px] bg-accent px-4 text-[15px] font-medium text-white shadow-pill transition-transform duration-100 hover:brightness-105 active:scale-[0.98]"
      >
        <LayoutGrid size={20} strokeWidth={1.9} />
        {t("shell.menu")}
      </button>
      {open && (
        <div role="menu" onKeyDown={onArrowKeys} className="absolute left-0 top-14 z-40 w-[min(620px,calc(100vw-40px))] overflow-hidden rounded-[24px] bg-surface shadow-pop">
          <label className="flex h-14 items-center gap-3 border-b border-ink-10 px-5 text-ink-60">
            <Search size={18} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) pick(hits[0]);
              }}
              placeholder={t("shell.findFunction")}
              className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-40"
            />
          </label>
          {query ? (
            <div className="max-h-[420px] overflow-auto p-2">
              {hits.length === 0 && <div className="p-4 text-ink-60">{t("shell.nothingFound")}</div>}
              {hits.map((m) => (
                <MenuItem key={m.id} m={m} onPick={pick} trailing={t(GROUPS.find((g) => g.id === m.group)!.label)} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[240px_1fr]">
              <div className="border-r border-ink-10 p-2">
                {groups.map((g, i) => {
                  const Icon = iconFor(g.icon);
                  const on = group === i;
                  return (
                    <button
                      type="button"
                      key={g.id}
                      onMouseEnter={() => setGroup(i)}
                      onFocus={() => setGroup(i)}
                      onClick={() => setGroup(i)}
                      className={`flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[15px] ${on ? "bg-ink-10 font-medium" : "hover:bg-ink-5"}`}
                    >
                      <Icon size={19} strokeWidth={1.75} className={on ? "text-accent" : "text-ink-60"} />
                      <span className="flex-1">{t(g.label)}</span>
                      <ChevronRight size={16} className="text-ink-40" />
                    </button>
                  );
                })}
              </div>
              <div className="p-2">
                {current && <div className="px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-ink-40">{t(current.label)}</div>}
                {items.map((m) => (
                  <MenuItem key={m.id} m={m} onPick={pick} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ m, onPick, trailing }: { m: ModuleDef; onPick: (m: ModuleDef) => void; trailing?: string }) {
  const { t, moduleLabel, quickAccess } = useShell();
  const router = useRouter();
  const [pending, start] = useTransition();
  const Icon = iconFor(m.icon);
  const inQuick = quickAccess.includes(m.id);
  return (
    <div className="group flex items-center rounded-[12px] hover:bg-ink-5">
      <button type="button" role="menuitem" onClick={() => onPick(m)} className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-[12px] px-3 text-left text-[15px]">
        <span className="grid size-7 shrink-0 place-items-center rounded-[9px]" style={{ background: `color-mix(in srgb, ${m.hue} 16%, transparent)`, color: m.hue }}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1 truncate">{moduleLabel(m)}</span>
        {m.soon ? <span className="rounded-full bg-ink-5 px-2 text-[11px] text-ink-60">#{m.soon}</span> : null}
        {trailing ? <span className="text-[12px] text-ink-60">{trailing}</span> : null}
      </button>
      <button
        type="button"
        aria-label={`${inQuick ? t("shell.removeFromQuickAccess") : t("shell.addToQuickAccess")}: ${moduleLabel(m)}`}
        aria-pressed={inQuick}
        disabled={pending}
        onClick={() => start(async () => {
          await toggleQuickAccess(m.id);
          router.refresh();
        })}
        className={`mr-1 grid size-8 shrink-0 place-items-center rounded-full text-ink-60 hover:bg-ink-10 ${inQuick ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"}`}
      >
        <Star size={15} fill={inQuick ? "currentColor" : "none"} className={inQuick ? "text-accent" : ""} />
      </button>
    </div>
  );
}

