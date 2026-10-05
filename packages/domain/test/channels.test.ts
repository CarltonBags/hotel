import { describe, expect, it } from "vitest";
import { OPEN_RESTRICTION } from "../src/rates";
import { channelRestriction, compressDays, channelStatusText } from "../src/channels";

describe("channel pushes", () => {
  it("days with the same value become one range", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"];
    const value: Record<string, number> = { "2026-11-01": 3, "2026-11-02": 3, "2026-11-03": 2, "2026-11-05": 2, "2026-11-06": 2 };
    // a gap in the dates starts a new range even with the same value
    expect(compressDays(days, (d) => value[d]!)).toEqual([
      { from: "2026-11-01", to: "2026-11-02", value: 3 },
      { from: "2026-11-03", to: "2026-11-03", value: 2 },
      { from: "2026-11-05", to: "2026-11-06", value: 2 },
    ]);
  });

  it("prices per occupancy from the Supplements; no price closes the date", () => {
    const plan = { baseOccupancy: 2, supplements: [{ kind: "single" as const, amount: -20 }, { kind: "extra_adult" as const, amount: 30 }] };
    expect(channelRestriction(100, { ...OPEN_RESTRICTION, minStayThrough: 2 }, plan, 3)).toEqual({
      rates: [{ occupancy: 1, rate: 80 }, { occupancy: 2, rate: 100 }, { occupancy: 3, rate: 130 }],
      stopSell: false,
      closedToArrival: false,
      closedToDeparture: false,
      minStayArrival: 1,
      minStayThrough: 2,
      maxStay: 0,
    });
    expect(channelRestriction(null, OPEN_RESTRICTION, plan, 2)).toMatchObject({ rates: [], stopSell: true });
  });

  it("the grid header says what is waiting", () => {
    expect(channelStatusText({ connected: true, pending: 3, failing: false }, "en")).toBe("Sending 3 changes");
    expect(channelStatusText({ connected: true, pending: 1, failing: false }, "en")).toBe("Sending 1 change");
    expect(channelStatusText({ connected: true, pending: 0, failing: false }, "en")).toBe("Channels up to date");
    expect(channelStatusText({ connected: true, pending: 2, failing: true }, "de")).toBe("Kanäle: Übertragung gestört, 2 Änderungen warten");
    expect(channelStatusText({ connected: false, pending: 0, failing: false }, "en")).toBeNull();
  });
});
