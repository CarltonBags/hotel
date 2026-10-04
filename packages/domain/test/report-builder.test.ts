import { describe, expect, it } from "vitest";
import { allowedColumns, checkDefinition } from "../src/report-builder";

const at = (roles: string[]) => ({ propertyRoles: roles.map((role) => ({ propertyId: "p1", role })) }) as never;

describe("report builder rights", () => {
  it("Revenue sees reservations but cannot add contact or guest columns", () => {
    const cols = allowedColumns(at(["revenue"]), "reservations", ["p1"]).map((c) => c.key);
    expect(cols).toContain("confirmation");
    expect(cols).not.toContain("email");
    expect(cols).not.toContain("phone");
    expect(checkDefinition(at(["revenue"]), { dataSet: "reservations", columns: ["confirmation", "email"], filters: [], groupBy: [], totals: false }, ["p1"])).toEqual({ problem: "The column email is not available to you" });
  });

  it("the builder is for Property Manager, Accounting and Revenue; Revenue builds revenue figures, not money movements", () => {
    expect(allowedColumns(at(["front_desk"]), "reservations", ["p1"])).toEqual([]);
    expect(allowedColumns(at(["housekeeping_supervisor"]), "housekeeping_tasks", ["p1"])).toEqual([]);
    expect(allowedColumns(at(["revenue"]), "reservations", ["p1"]).map((c) => c.key)).toContain("total");
    expect(allowedColumns(at(["revenue"]), "charges", ["p1"]).map((c) => c.key)).toEqual(expect.arrayContaining(["net", "gross"]));
    expect(allowedColumns(at(["revenue"]), "payments", ["p1"])).toEqual([]);
    expect(allowedColumns(at(["accounting"]), "reservations", ["p1"]).map((c) => c.key)).toContain("email");
  });

  it("grouping: text columns only, every shown text column grouped", () => {
    const pm = at(["property_manager"]);
    expect("ok" in checkDefinition(pm, { dataSet: "charges", columns: ["category", "net", "gross"], filters: [], groupBy: ["category"], totals: true }, ["p1"])).toBe(true);
    expect(checkDefinition(pm, { dataSet: "charges", columns: ["category", "service", "net"], filters: [], groupBy: ["category"], totals: false }, ["p1"])).toEqual({ problem: "Group by service too, or leave it out" });
    expect(checkDefinition(pm, { dataSet: "charges", columns: ["net"], filters: [], groupBy: ["net"], totals: false }, ["p1"])).toEqual({ problem: "Group by text columns only (net)" });
  });
});
