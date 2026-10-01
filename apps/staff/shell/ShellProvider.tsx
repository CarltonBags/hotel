"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Language, Theme } from "@hoteloftware/domain";
import type { PinnedTab, Property } from "@hoteloftware/db";
import { fill, type MessageKey, type Messages } from "@/i18n/messages";
import { savePinnedTabs, savePreferences, setPropertyScope } from "@/app/(shell)/actions";
import { MODULE_BY_ID, moduleForPath, type ModuleDef } from "./registry";
import { activateTab, closeTab, moveTab, openTab, orderedTabs, reconcile, togglePin, type Tab, type WorkspaceState } from "./workspace";

export interface ShellProps {
  tenant: { id: string; name: string; slug: string };
  user: { id: string; name: string; email: string; username: string | null };
  properties: Property[];
  scope: string;
  pinnedTabs: PinnedTab[];
  quickAccess: string[];
  messages: Messages;
  language: Language;
  theme: Theme;
  accent: { id: string; light: string; dark: string };
  canManageTenant: boolean;
}

type Action =
  | { type: "open"; tab: Tab }
  | { type: "activate"; id: string }
  | { type: "close"; id: string }
  | { type: "pin"; id: string }
  | { type: "move"; id: string; to: number }
  | { type: "replace"; state: WorkspaceState };

function reduce(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "open":
      return openTab(state, action.tab);
    case "activate":
      return activateTab(state, action.id);
    case "close":
      return closeTab(state, action.id);
    case "pin":
      return togglePin(state, action.id);
    case "move":
      return moveTab(state, action.id, action.to);
    case "replace":
      return action.state;
  }
}

export interface ShellContext extends ShellProps {
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  moduleLabel: (m: ModuleDef) => string;
  tabs: Tab[];
  activeId: string | null;
  pinned: string[];
  openModule: (id: string) => void;
  openRecord: (module: string, recordId: string, title: string, href: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  pin: (id: string) => void;
  move: (id: string, to: number) => void;
  setScope: (scope: string) => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
  effectiveTheme: "light" | "dark";
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

const Ctx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShell outside ShellProvider");
  return ctx;
}

function storageKey(p: ShellProps): string {
  return `hs:ws:${p.tenant.id}:${p.user.id}:${p.scope}`;
}

function moduleTab(m: ModuleDef, label: string): Tab {
  return { id: m.id, kind: "module", module: m.id, title: label, href: m.href };
}

/** Rebuild the workspace from storage plus the server's pinned list, so pinned tabs restore after login. */
function initialState(p: ShellProps, moduleLabel: (m: ModuleDef) => string): WorkspaceState {
  let stored: WorkspaceState = { tabs: [], activeId: null, pinned: [] };
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey(p)) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<WorkspaceState>) : null;
    if (parsed && Array.isArray(parsed.tabs)) {
      stored = {
        tabs: parsed.tabs.filter((t): t is Tab => typeof t?.id === "string" && typeof t.href === "string" && typeof t.module === "string"),
        activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
        pinned: [],
      };
    }
  } catch {
    /* no or corrupt storage: start empty */
  }
  const tabs = [...stored.tabs];
  for (const pinned of p.pinnedTabs) {
    if (!tabs.some((t) => t.id === pinned.id)) {
      const m = pinned.kind === "module" ? MODULE_BY_ID.get(pinned.module) : undefined;
      tabs.push(m ? moduleTab(m, moduleLabel(m)) : { ...pinned });
    }
  }
  return reconcile({ tabs, activeId: stored.activeId, pinned: p.pinnedTabs.map((t) => t.id) });
}

export function ShellProvider({ children, ...props }: ShellProps & { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => (values ? fill(props.messages[key], values) : props.messages[key]),
    [props.messages],
  );
  const moduleLabel = useCallback((m: ModuleDef) => props.messages[m.label], [props.messages]);

  const [state, dispatch] = useReducer(reduce, null, () => ({ tabs: [], activeId: null, pinned: props.pinnedTabs.map((t) => t.id) }));
  const [hydrated, setHydrated] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Hydrate from localStorage after mount (server render has no storage).
  useEffect(() => {
    dispatch({ type: "replace", state: initialState(props, moduleLabel) });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tenant.id, props.user.id, props.scope]);

  // Keep the tab strip in step with the route: a direct navigation opens its module tab.
  useEffect(() => {
    if (!hydrated) return;
    const m = moduleForPath(pathname);
    if (m) dispatch({ type: "open", tab: moduleTab(m, moduleLabel(m)) });
  }, [pathname, hydrated, moduleLabel]);

  // Persist workspace tabs locally and pinned tabs on the server, saves serialised so they commit in order.
  const lastPinned = useRef(props.pinnedTabs.map((t) => t.id).join("|"));
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const key = storageKey(props);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* no storage */
    }
    const pinnedKey = state.pinned.join("|");
    if (pinnedKey !== lastPinned.current) {
      lastPinned.current = pinnedKey;
      const byId = new Map(state.tabs.map((t) => [t.id, t]));
      const pinned = state.pinned.map((id) => byId.get(id)).filter((t): t is Tab => t !== undefined);
      saveQueue.current = saveQueue.current.then(() => savePinnedTabs(props.scope, pinned)).catch(() => undefined);
    }
  }, [state, hydrated, key, props.scope]);

  // Theme: explicit choice wins, "system" follows the OS.
  const [osDark, setOsDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setOsDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const effectiveTheme: "light" | "dark" = props.theme === "system" ? (osDark ? "dark" : "light") : props.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = props.theme === "system" ? "" : props.theme;
    document.documentElement.style.setProperty("--accent-light", props.accent.light);
    document.documentElement.style.setProperty("--accent-dark", props.accent.dark);
  }, [props.theme, props.accent]);

  const navigate = useCallback(
    (tab: Tab) => {
      dispatch({ type: "open", tab });
      if (tab.href !== pathname) router.push(tab.href);
    },
    [router, pathname],
  );

  const value = useMemo<ShellContext>(
    () => ({
      ...props,
      t,
      moduleLabel,
      // Module tabs take their title from the registry at render time, so a language change relabels them.
      tabs: orderedTabs(state).map((tab) => {
        const m = tab.kind === "module" ? MODULE_BY_ID.get(tab.module) : undefined;
        return m ? { ...tab, title: moduleLabel(m) } : tab;
      }),
      activeId: moduleForPath(pathname)?.id ?? state.activeId,
      pinned: state.pinned,
      openModule: (id) => {
        const m = MODULE_BY_ID.get(id);
        if (m) navigate(moduleTab(m, moduleLabel(m)));
      },
      openRecord: (module, recordId, title, href) => navigate({ id: `${module}:${recordId}`, kind: "record", module, title, href }),
      activate: (id) => {
        const tab = state.tabs.find((x) => x.id === id);
        if (tab) navigate(tab);
      },
      close: (id) => {
        const next = closeTab(state, id);
        if (next === state) return;
        dispatch({ type: "close", id });
        if (state.activeId === id || moduleForPath(pathname)?.id === id) {
          const target = next.tabs.find((x) => x.id === next.activeId);
          router.push(target?.href ?? "/");
        }
      },
      pin: (id) => dispatch({ type: "pin", id }),
      move: (id, to) => dispatch({ type: "move", id, to }),
      setScope: (scope) => {
        void setPropertyScope(scope).then(() => router.refresh());
      },
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme === "system" ? "" : theme;
        void savePreferences({ theme }).then(() => router.refresh());
      },
      setLanguage: (language) => {
        void savePreferences({ language }).then(() => router.refresh());
      },
      effectiveTheme,
      menuOpen,
      setMenuOpen,
    }),
    [props, t, moduleLabel, state, pathname, navigate, router, effectiveTheme, menuOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

