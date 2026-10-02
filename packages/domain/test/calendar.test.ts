import { describe, expect, it } from "vitest";
import { dropOutcome, packLanes, type CalendarBar } from "../src/calendar";

/** Seam: what dropping a reservation bar on the Rooms view means (prototype "Dragging" rules) and lane packing. */
describe("calendar drops", () => {
  const bar: CalendarBar = { reservationId: "r1", status: "confirmed", roomTypeId: "dbl", arrival: "2026-12-07", departure: "2026-12-10", segment: { roomId: "101", from: "2026-12-07", to: "2026-12-10" } };
  const free = () => true;

  it("same room type, same dates, another room: applied at once (undoable)", () => {
    expect(dropOutcome(bar, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-07" }, free)).toEqual({ kind: "move_room", roomId: "102", from: "2026-12-07" });
  });

  it("dropping an unassigned reservation on a room assigns it", () => {
    expect(dropOutcome({ ...bar, segment: null }, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-07" }, free)).toEqual({ kind: "assign", roomId: "102" });
  });

  it("other dates or another room type need a confirmation with old and new dates", () => {
    expect(dropOutcome(bar, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-09" }, free)).toEqual({ kind: "confirm_change", roomId: "102", roomTypeId: "dbl", arrival: "2026-12-09", departure: "2026-12-12" });
    expect(dropOutcome(bar, { roomId: "201", roomTypeId: "sgl", arrival: "2026-12-07" }, free)).toEqual({ kind: "confirm_change", roomId: "201", roomTypeId: "sgl", arrival: "2026-12-07", departure: "2026-12-10" });
  });

  it("refuses with a reason: taken room, checked-out stay, moving a checked-in arrival, the same place", () => {
    expect(dropOutcome(bar, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-07" }, () => false)).toEqual({ kind: "refuse", reason: "room_taken" });
    expect(dropOutcome({ ...bar, status: "checked_out" }, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-07" }, free)).toEqual({ kind: "refuse", reason: "checked_out" });
    expect(dropOutcome({ ...bar, status: "checked_in" }, { roomId: "102", roomTypeId: "dbl", arrival: "2026-12-08" }, free)).toEqual({ kind: "refuse", reason: "checked_in_arrival" });
    expect(dropOutcome({ ...bar, status: "checked_in" }, { roomId: "201", roomTypeId: "sgl", arrival: "2026-12-07" }, free)).toEqual({ kind: "refuse", reason: "checked_in_type" });
    expect(dropOutcome(bar, { roomId: "101", roomTypeId: "dbl", arrival: "2026-12-07" }, free)).toEqual({ kind: "refuse", reason: "nothing_changes" });
  });

  it("a later segment of a moved stay keeps its own nights when dropped on another room", () => {
    const later: CalendarBar = { ...bar, segment: { roomId: "102", from: "2026-12-09", to: "2026-12-10" } };
    expect(dropOutcome(later, { roomId: "103", roomTypeId: "dbl", arrival: "2026-12-09" }, free)).toEqual({ kind: "move_room", roomId: "103", from: "2026-12-09" });
    expect(dropOutcome(later, { roomId: "103", roomTypeId: "dbl", arrival: "2026-12-10" }, free)).toEqual({ kind: "refuse", reason: "segment_dates" });
    expect(dropOutcome(later, { roomId: "201", roomTypeId: "sgl", arrival: "2026-12-09" }, free)).toEqual({ kind: "refuse", reason: "segment_type" });
  });
});

describe("lanes", () => {
  it("packs bars into the fewest lanes without overlaps; same-day turnover shares a lane", () => {
    const lanes = packLanes([
      { id: "a", arrival: "2026-12-07", departure: "2026-12-09" },
      { id: "b", arrival: "2026-12-08", departure: "2026-12-10" },
      { id: "c", arrival: "2026-12-09", departure: "2026-12-11" },
    ]);
    expect(lanes.map((l) => l.map((x) => x.id))).toEqual([["a", "c"], ["b"]]);
  });
});
