import { describe, expect, it } from "vitest";
import { ChannelError, ChannexManager } from "../src";

describe("Channex", () => {
  it("pushes restrictions with per-occupancy rates and the API key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ch = new ChannexManager("key-1", "https://staging.channex.io/api/v1", (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ id: "task", type: "task" }], meta: { message: "Success" } }), { status: 200 });
    }) as typeof fetch);
    await ch.pushRestrictions([{ propertyId: "p", ratePlanId: "r", dateFrom: "2026-11-01", dateTo: "2026-11-03", rates: [{ occupancy: 1, rate: 90 }, { occupancy: 2, rate: 110.5 }], stopSell: false, closedToArrival: true, closedToDeparture: false, minStayArrival: 2, minStayThrough: 1, maxStay: 0 }]);
    expect(calls[0]!.url).toBe("https://staging.channex.io/api/v1/restrictions");
    expect((calls[0]!.init.headers as Record<string, string>)["user-api-key"]).toBe("key-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      values: [{ property_id: "p", rate_plan_id: "r", date_from: "2026-11-01", date_to: "2026-11-03", rates: [{ occupancy: 1, rate: "90.00" }, { occupancy: 2, rate: "110.50" }], stop_sell: false, closed_to_arrival: true, closed_to_departure: false, min_stay_arrival: 2, min_stay_through: 1, max_stay: 0 }],
    });
  });

  it("a rate limit is worth retrying, a refusal is not", async () => {
    const answer = (status: number) => new ChannexManager("k", "https://x", (async () => new Response("{}", { status })) as unknown as typeof fetch);
    await expect(answer(429).pushAvailability([{ propertyId: "p", roomTypeId: "t", dateFrom: "2026-11-01", dateTo: "2026-11-01", availability: 3 }])).rejects.toMatchObject({ retry: true });
    const refused = await answer(422).pushAvailability([{ propertyId: "p", roomTypeId: "t", dateFrom: "2026-11-01", dateTo: "2026-11-01", availability: 3 }]).catch((e) => e);
    expect(refused).toBeInstanceOf(ChannelError);
    expect(refused.retry).toBe(false);
  });
});
