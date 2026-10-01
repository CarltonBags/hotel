"use client";

import { useState } from "react";
import { Pin, PinOff, Plus, X } from "lucide-react";
import { iconFor } from "./icons";
import { MODULE_BY_ID } from "./registry";
import { useShell } from "./ShellProvider";

/** Pinned Tabs first (icon only), then Workspace Tabs, then "New reservation". */
export function TabStrip() {
  const { t, tabs, activeId, pinned, activate, close, pin, move, openModule } = useShell();
  const [dragging, setDragging] = useState<string | null>(null);
  const unpinnedIndex = (id: string) => tabs.filter((x) => !pinned.includes(x.id)).findIndex((x) => x.id === id);

  return (
    <div role="tablist" aria-label={t("shell.workspaceTabs")} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 pl-1">
      {tabs.map((tab) => {
        const m = MODULE_BY_ID.get(tab.module);
        const Icon = iconFor(m?.icon ?? "List");
        const hue = m?.hue ?? "#6b7280";
        const on = tab.id === activeId;
        const isPinned = pinned.includes(tab.id);
        return (
          <div
            key={tab.id}
            draggable={!isPinned}
            onDragStart={() => setDragging(tab.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging && dragging !== tab.id && !isPinned) move(dragging, unpinnedIndex(tab.id));
              setDragging(null);
            }}
            title={isPinned ? `${tab.title} (${t("shell.pinned")})` : tab.title}
            className={`group relative flex h-10 shrink-0 items-center rounded-full text-[14px] transition-colors duration-100 ${isPinned ? "px-1" : "pl-3.5 pr-1"} ${on ? "bg-surface font-medium shadow-pill" : "text-ink-80 hover:bg-ink-5"}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={tab.title}
              onClick={() => activate(tab.id)}
              className={`flex items-center gap-2 ${isPinned ? "size-8 justify-center" : ""}`}
            >
              <Icon size={17} strokeWidth={1.8} style={{ color: on ? hue : undefined }} />
              {!isPinned && <span className="max-w-44 truncate">{tab.title}</span>}
            </button>
            <button
              type="button"
              aria-label={`${isPinned ? t("shell.unpin") : t("shell.pin")}: ${tab.title}`}
              onClick={() => pin(tab.id)}
              className={`grid size-7 place-items-center rounded-full text-ink-60 hover:bg-ink-10 ${isPinned ? "absolute -right-1 -top-1 hidden size-5 bg-surface shadow-pill group-hover:grid group-focus-within:grid" : "ml-1 opacity-0 focus:opacity-100 group-hover:opacity-100"}`}
            >
              {isPinned ? <PinOff size={11} /> : <Pin size={14} />}
            </button>
            {!isPinned && (
              <button
                type="button"
                aria-label={`${t("shell.close")}: ${tab.title}`}
                onClick={() => close(tab.id)}
                className="grid size-7 place-items-center rounded-full text-ink-60 hover:bg-ink-10"
              >
                <X size={15} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => openModule("new_reservation")}
        className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] text-ink-60 hover:bg-ink-5 hover:text-ink"
      >
        <Plus size={18} />
        {t("shell.newReservation")}
      </button>
    </div>
  );
}
