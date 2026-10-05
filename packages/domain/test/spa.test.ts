import { describe, expect, it } from "vitest";
import { appointmentProblem, openSpaSlots } from "../src";

const t = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00Z`);
const iv = (a: string, b: string) => ({ start: t(a), end: t(b) });

describe("spa appointments", () => {
  const hours = [iv("09:00", "13:00"), iv("14:00", "18:00")];

  it("an appointment fits inside the therapist's hours, beside the therapist's and the room's other appointments", () => {
    expect(appointmentProblem(iv("10:00", "11:00"), { hours, therapistBusy: [iv("11:00", "12:00")], roomBusy: [] })).toBeNull();
    expect(appointmentProblem(iv("10:30", "11:30"), { hours, therapistBusy: [iv("11:00", "12:00")], roomBusy: [] })).toBe("therapist_busy");
    expect(appointmentProblem(iv("12:30", "13:30"), { hours, therapistBusy: [], roomBusy: [] })).toBe("outside_hours");
    expect(appointmentProblem(iv("15:00", "16:00"), { hours, therapistBusy: [], roomBusy: [iv("15:30", "16:30")] })).toBe("room_busy");
  });

  it("open slots: released hours, in steps, where the therapist and some room are free", () => {
    const slots = openSpaSlots({ hours: [iv("09:00", "11:00")], therapistBusy: [iv("09:30", "10:00")], rooms: [{ id: "r1", busy: [iv("10:00", "10:30")] }, { id: "r2", busy: [iv("10:00", "11:00")] }] }, 30, 30);
    expect(slots.map((s) => [s.start.toISOString().slice(11, 16), s.roomId])).toEqual([
      ["09:00", "r1"],
      ["10:30", "r1"],
    ]);
    // a treatment without a room needs only the therapist
    expect(openSpaSlots({ hours: [iv("09:00", "10:00")], therapistBusy: [], rooms: null }, 60, 15).map((s) => s.start.toISOString().slice(11, 16))).toEqual(["09:00"]);
  });
});

describe("spa times", () => {
  it("a wall-clock time at the property is the right instant, summer and winter", async () => {
    const { instantAt } = await import("../src");
    expect(instantAt("2026-07-01", "10:00", "Europe/Berlin").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(instantAt("2026-12-01", "10:00", "Europe/Berlin").toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(instantAt("2026-12-01", "10:00", "Europe/Zurich").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});
