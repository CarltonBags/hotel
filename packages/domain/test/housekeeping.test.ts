import { describe, expect, it } from "vitest";
import { proposeDistribution, tasksForDay, workload, type StayOnDay, type TaskRules } from "../src/housekeeping";

const daily: TaskRules = { stayover: "daily", linenEvery: 3 };

describe("housekeeping tasks", () => {
  it("a day calls for departures, arrivals, stayovers and linen by the rhythms", () => {
    const stays: StayOnDay[] = [
      { reservationId: "out", roomId: "101", roomTypeId: "DBL", status: "checked_in", arrival: "2026-10-01", departure: "2026-10-04" },
      { reservationId: "in", roomId: "102", roomTypeId: "DBL", status: "confirmed", arrival: "2026-10-04", departure: "2026-10-06" },
      // third night: stayover daily and linen every 3
      { reservationId: "stay3", roomId: "103", roomTypeId: "DBL", status: "checked_in", arrival: "2026-10-01", departure: "2026-10-08" },
      // second night in a room type cleaned every second day
      { reservationId: "stay2", roomId: "201", roomTypeId: "SUI", status: "checked_in", arrival: "2026-10-02", departure: "2026-10-08" },
      // first night after arrival in a room cleaned on request only
      { reservationId: "req", roomId: "301", roomTypeId: "APT", status: "checked_in", arrival: "2026-10-03", departure: "2026-10-08" },
      { reservationId: "noroom", roomId: null, roomTypeId: "DBL", status: "confirmed", arrival: "2026-10-04", departure: "2026-10-05" },
    ];
    const rules = (t: string): TaskRules => (t === "SUI" ? { stayover: "every_2", linenEvery: null } : t === "APT" ? { stayover: "on_request", linenEvery: null } : daily);
    expect(tasksForDay("2026-10-04", stays, rules).map((t) => `${t.roomId}:${t.kind}`)).toEqual(["101:departure", "102:arrival", "103:stayover", "103:linen", "201:stayover"]);
  });

  it("minutes per person sum against the shift", () => {
    const w = workload(
      [
        { minutes: 30, assigneeId: "anna" },
        { minutes: 20, assigneeId: "anna" },
        { minutes: 15, assigneeId: "bea" },
        { minutes: 10, assigneeId: null },
      ],
      ["anna", "bea"],
      480,
    );
    expect(w).toEqual([
      { assigneeId: "anna", minutes: 50, left: 430 },
      { assigneeId: "bea", minutes: 15, left: 465 },
      { assigneeId: "", minutes: 10, left: 0 },
    ]);
  });

  it("the proposal keeps Sections together and balances the minutes", () => {
    const t = (id: string, roomId: string, section: string, minutes: number) => ({ id, roomId, section, minutes, assigneeId: null });
    const tasks = [t("a", "101", "1st floor", 30), t("b", "102", "1st floor", 30), t("c", "201", "2nd floor", 30), t("d", "202", "2nd floor", 30), t("e", "202", "2nd floor", 15)];
    const p = proposeDistribution(tasks, ["anna", "bea"]);
    // one floor each; room 202's two tasks stay together
    expect(p.get("a")).toBe(p.get("b"));
    expect(p.get("c")).toBe(p.get("d"));
    expect(p.get("d")).toBe(p.get("e"));
    expect(p.get("a")).not.toBe(p.get("c"));
  });
});
