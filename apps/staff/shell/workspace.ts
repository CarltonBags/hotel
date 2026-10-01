/**
 * Workspace tabs (decided in "App shell and multi-tab navigation prototype").
 * Pure reducer; the provider persists it. Module tabs are singletons, record
 * tabs one per record, Pinned Tabs sit first and cannot be closed until unpinned.
 */
export interface Tab {
  /** Module id for module tabs, `<module>:<recordId>` for record tabs. */
  id: string;
  kind: "module" | "record";
  module: string;
  title: string;
  href: string;
}

export interface WorkspaceState {
  tabs: Tab[];
  activeId: string | null;
  /** Pinned tab ids in pin order. */
  pinned: string[];
}

export function openTab(state: WorkspaceState, tab: Tab): WorkspaceState {
  const existing = state.tabs.find((t) => t.id === tab.id);
  const tabs = existing ? state.tabs.map((t) => (t.id === tab.id ? { ...t, title: tab.title, href: tab.href } : t)) : [...state.tabs, tab];
  return { ...state, tabs, activeId: tab.id };
}

export function activateTab(state: WorkspaceState, id: string): WorkspaceState {
  return state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state;
}

export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
  if (state.pinned.includes(id)) return state;
  const ordered = orderedTabs(state);
  const index = ordered.findIndex((t) => t.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (activeId === id) {
    const remaining = ordered.filter((t) => t.id !== id);
    activeId = remaining[Math.max(0, index - 1)]?.id ?? null;
  }
  return { ...state, tabs, activeId };
}

export function togglePin(state: WorkspaceState, id: string): WorkspaceState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  const pinned = state.pinned.includes(id) ? state.pinned.filter((p) => p !== id) : [...state.pinned, id];
  return { ...state, pinned };
}

/** Pinned first in pin order, then workspace tabs in their own order. */
export function orderedTabs(state: WorkspaceState): Tab[] {
  const byId = new Map(state.tabs.map((t) => [t.id, t]));
  const pinned = state.pinned.map((id) => byId.get(id)).filter((t): t is Tab => t !== undefined);
  const rest = state.tabs.filter((t) => !state.pinned.includes(t.id));
  return [...pinned, ...rest];
}

/** Move a workspace tab to a position among the unpinned tabs (0 = right after the pinned block). */
export function moveTab(state: WorkspaceState, id: string, toIndex: number): WorkspaceState {
  if (state.pinned.includes(id)) return state;
  const rest = state.tabs.filter((t) => !state.pinned.includes(t.id));
  const from = rest.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const [tab] = rest.splice(from, 1);
  rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, tab!);
  const pinnedTabs = state.tabs.filter((t) => state.pinned.includes(t.id));
  return { ...state, tabs: [...pinnedTabs, ...rest] };
}

/** Drop pinned ids that no longer have a tab (for example after a tenant change). */
export function reconcile(state: WorkspaceState): WorkspaceState {
  const ids = new Set(state.tabs.map((t) => t.id));
  return { ...state, pinned: state.pinned.filter((id) => ids.has(id)) };
}
