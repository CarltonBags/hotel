import { describe, expect, it } from "vitest";
import { closeTab, moveTab, openTab, orderedTabs, togglePin, type WorkspaceState } from "./workspace";

/**
 * Seam: the tab reducer. Module tabs are singletons, record tabs one per
 * record, pinned tabs sit first and cannot be closed until unpinned, closing
 * the active tab activates its neighbour.
 */
const today = { id: "today", kind: "module" as const, module: "today", title: "Today", href: "/" };
const calendar = { id: "calendar", kind: "module" as const, module: "calendar", title: "Calendar", href: "/soon/calendar" };
const guest = { id: "guest:42", kind: "record" as const, module: "guests", title: "Aiko Tanaka", href: "/guests/42" };

const empty: WorkspaceState = { tabs: [], activeId: null, pinned: [] };

describe("workspace tabs", () => {
  it("opens a module tab once and activates it on reopen", () => {
    let s = openTab(empty, today);
    s = openTab(s, calendar);
    s = openTab(s, today);
    expect(s.tabs.map((t) => t.id)).toEqual(["today", "calendar"]);
    expect(s.activeId).toBe("today");
  });

  it("opens one tab per record and keeps the title of the latest open", () => {
    let s = openTab(empty, guest);
    s = openTab(s, { ...guest, title: "Aiko Tanaka (R-48220)" });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.title).toBe("Aiko Tanaka (R-48220)");
  });

  it("closing the active tab activates the tab to its left, or the next one", () => {
    let s = openTab(openTab(openTab(empty, today), calendar), guest);
    s = closeTab(s, "guest:42");
    expect(s.activeId).toBe("calendar");
    s = closeTab(s, "today");
    expect(s.activeId).toBe("calendar");
    s = closeTab(s, "calendar");
    expect(s.activeId).toBeNull();
  });

  it("pinned tabs come first, in pin order, and cannot be closed", () => {
    let s = openTab(openTab(openTab(empty, today), calendar), guest);
    s = togglePin(s, "guest:42");
    s = togglePin(s, "calendar");
    expect(orderedTabs(s).map((t) => t.id)).toEqual(["guest:42", "calendar", "today"]);
    const before = s;
    s = closeTab(s, "calendar");
    expect(s).toBe(before);
    s = togglePin(s, "calendar");
    s = closeTab(s, "calendar");
    expect(s.tabs.map((t) => t.id)).toEqual(["today", "guest:42"]);
  });

  it("reorders workspace tabs by drag, never past the pinned block", () => {
    let s = openTab(openTab(openTab(empty, today), calendar), guest);
    s = moveTab(s, "guest:42", 0);
    expect(s.tabs.map((t) => t.id)).toEqual(["guest:42", "today", "calendar"]);
    s = togglePin(s, "today");
    s = moveTab(s, "calendar", 0);
    expect(orderedTabs(s).map((t) => t.id)).toEqual(["today", "calendar", "guest:42"]);
  });
});
