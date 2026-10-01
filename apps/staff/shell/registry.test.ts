import { describe, expect, it } from "vitest";
import { GROUPS, MODULES, moduleForPath } from "./registry";

describe("module registry", () => {
  it("has unique ids and every module in a known group", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const m of MODULES) expect(groups.has(m.group), m.id).toBe(true);
  });

  it("resolves the module for a pathname", () => {
    expect(moduleForPath("/")?.id).toBe("today");
    expect(moduleForPath("/settings/users")?.id).toBe("settings_users");
    expect(moduleForPath("/settings/users/anything")?.id).toBe("settings_users");
    expect(moduleForPath("/soon/calendar")?.id).toBe("calendar");
    expect(moduleForPath("/nowhere")).toBeUndefined();
  });
});
