import { describe, expect, it } from "vitest";
import { FLOOR_LANGUAGES, floorSections, isRtl, parsePhoneOp } from "../src/floor";

describe("phone view rules", () => {
  it("ships ten languages, Arabic right to left", () => {
    expect(FLOOR_LANGUAGES).toEqual(["de", "en", "pl", "ro", "bg", "hr", "hu", "tr", "uk", "ar"]);
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("tr")).toBe(false);
  });

  it("groups rooms by Section, priority and changed first, then by room number", () => {
    const t = (room: string, section: string | null, extra: { priority?: boolean; changed?: boolean; status?: string } = {}) => ({
      roomNumber: room,
      section,
      priority: extra.priority ?? false,
      changed: extra.changed ?? false,
      status: extra.status ?? "open",
    });
    const groups = floorSections([t("204", "Floor 2"), t("110", "Floor 1"), t("214", "Floor 2", { changed: true }), t("201", "Floor 2", { priority: true }), t("202", "Floor 2"), t("999", null)]);
    expect(groups.map((g) => [g.section, g.tasks.map((x) => x.roomNumber)])).toEqual([
      ["Floor 1", ["110"]],
      ["Floor 2", ["201", "214", "202", "204"]],
      [null, ["999"]],
    ]);
  });

  it("accepts only well-formed phone changes", () => {
    const id = "6f1c1f7e-6d7a-4c51-9a55-0c1f0f8f3a11";
    const room = "0b9c8d7e-1111-4222-8333-944455566677";
    expect(parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "task", taskId: room, step: "done", seen: 3 })).toMatchObject({ kind: "task", step: "done", seen: 3 });
    expect(parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "minibar", roomId: room, items: [{ serviceId: room, quantity: 2 }] })).toMatchObject({ kind: "minibar" });
    expect(parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "problem", roomId: room, pick: "plumbing", urgency: "now", note: "" })).toMatchObject({ kind: "problem" });
    expect(() => parsePhoneOp({ id, at: "x", kind: "task", taskId: room, step: "done", seen: 1 })).toThrow();
    expect(() => parsePhoneOp({ id: "nope", at: "2026-10-04T08:00:00Z", kind: "task", taskId: room, step: "done", seen: 1 })).toThrow();
    expect(() => parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "task", taskId: room, step: "explode", seen: 1 })).toThrow();
    expect(() => parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "minibar", roomId: room, items: [{ serviceId: room, quantity: 0 }] })).toThrow();
    expect(() => parsePhoneOp({ id, at: "2026-10-04T08:00:00Z", kind: "problem", roomId: room, pick: "plumbing", urgency: "whenever", note: "" })).toThrow();
  });
});
