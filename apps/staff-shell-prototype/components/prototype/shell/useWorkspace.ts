"use client";
// PROTOTYPE state: workspace tabs, theme, active property. In memory only.
import { useEffect, useState } from "react";
import { ACCENTS, INITIAL_TABS, MODULES, type Tab, type TabKind } from "./mock";

export function useWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>(INITIAL_TABS);
  const [activeId, setActiveId] = useState<string>("dashboard");
  const [splitId, setSplitId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [propertyId, setPropertyId] = useState("muc");
  const [pinned, setPinned] = useState<string[]>(["dashboard"]);
  const [accent, setAccent] = useState("ocean");

  useEffect(() => {
    const a = ACCENTS.find((x) => x.id === accent)!;
    document.documentElement.style.setProperty("--accent", theme === "light" ? a.light : a.dark);
  }, [accent, theme]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("theme") === "dark") setTheme("dark"); // PROTOTYPE debug param
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const open = (tab: Tab) => {
    if (!tabs.some((t) => t.id === tab.id)) setTabs([...tabs, tab]);
    setActiveId(tab.id);
  };
  const openModule = (kind: TabKind) => {
    const m = MODULES.find((x) => x.kind === kind)!;
    open({ id: kind, kind, title: m.label });
  };
  const openList = (label: string) => open({ id: `list:${label}`, kind: "list", title: label });
  const togglePin = (id: string) => setPinned(pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id]);
  const newReservation = () => {
    const id = `R-${49000 + tabs.length}`;
    open({ id, kind: "reservation", title: "New reservation", sub: "draft" });
  };
  const close = (id: string) => {
    const i = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (splitId === id) setSplitId(null);
    setPinned(pinned.filter((x) => x !== id));
    if (activeId === id) setActiveId(next[Math.max(0, i - 1)]?.id ?? "");
  };
  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...tabs];
    const [t] = next.splice(from, 1);
    next.splice(to, 0, t);
    setTabs(next);
  };

  return {
    tabs, activeId, splitId, theme, propertyId, pinned, accent,
    ordered: [...tabs.filter((t) => pinned.includes(t.id)), ...tabs.filter((t) => !pinned.includes(t.id))],
    openList, togglePin, newReservation, setAccent,
    active: tabs.find((t) => t.id === activeId) ?? null,
    split: tabs.find((t) => t.id === splitId) ?? null,
    open, openModule, close, move,
    activate: setActiveId, setSplitId, setPropertyId,
    toggleTheme: () => setTheme(theme === "light" ? "dark" : "light"),
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
