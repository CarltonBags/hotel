import { describe, expect, it } from "vitest";
import { ChannelError, ChannexManager } from "../src";
import { parseChannexRevision } from "../src/bookings";

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


describe("Channex booking revisions", () => {
  it("reads a revision: rooms with nightly prices, the guest, who collects, the virtual card", () => {
    const rev = parseChannexRevision({
      id: "rev-1",
      type: "booking_revision",
      attributes: {
        booking_id: "bk-1",
        property_id: "prop-1",
        status: "new",
        ota_name: "Booking.com",
        ota_reservation_code: "4021778899",
        currency: "EUR",
        arrival_date: "2026-11-01",
        departure_date: "2026-11-03",
        customer: { name: "Aiko", surname: "Tanaka", mail: "aiko@guest.booking.com", phone: "+81 3 1234", country: "JP", language: "en" },
        rooms: [{ booking_room_id: "r-1", room_type_id: "rt-1", rate_plan_id: "rp-1", checkin_date: "2026-11-01", checkout_date: "2026-11-03", occupancy: { adults: 2, children: 1, ages: [6] }, days: { "2026-11-02": "110.00", "2026-11-01": "100.00" } }],
        notes: "Late arrival",
        payment_collect: "ota",
        meta: { virtual_card_effective_date: "2026-11-02", virtual_card_current_balance: "210.00" },
        inserted_at: "2026-10-05T10:00:00.000Z",
      },
    });
    expect(rev).toMatchObject({
      id: "rev-1",
      bookingId: "bk-1",
      status: "new",
      channel: "Booking.com",
      channelCode: "4021778899",
      customer: { firstName: "Aiko", lastName: "Tanaka", email: "aiko@guest.booking.com", country: "JP", language: "en" },
      collect: "channel",
      virtualCard: { activationDate: "2026-11-02", expiryDate: null, amount: 210 },
      cardToken: null,
      rooms: [{ key: "r-1", roomTypeId: "rt-1", ratePlanId: "rp-1", adults: 2, childAges: [6], childrenWithoutAge: 0, nights: [{ date: "2026-11-01", price: 100 }, { date: "2026-11-02", price: 110 }] }],
    });
    // children without an age count as adults (taxable); a card comes as a token and last digits only
    const noAges = parseChannexRevision({ id: "r3", attributes: { booking_id: "b", property_id: "p", status: "new", rooms: [{ room_type_id: "t", rate_plan_id: "r", checkin_date: "2026-11-01", checkout_date: "2026-11-02", occupancy: { adults: 2, children: 1 }, days: {}, taxes: [{ type: "city_tax", is_inclusive: true }] }], guarantee: { token: "pm_123", card_type: "visa", card_number: "411111******1111" } } });
    expect(noAges?.rooms[0]).toMatchObject({ adults: 3, childAges: [], childrenWithoutAge: 1, includesCityTax: true, includesVat: null });
    expect(noAges?.cardToken).toEqual({ token: "pm_123", brand: "visa", last4: "1111" });
    // a cancellation may come without rooms; something without ids is not a revision
    expect(parseChannexRevision({ id: "rev-2", attributes: { booking_id: "bk-1", property_id: "prop-1", status: "cancelled" } })?.status).toBe("cancelled");
    expect(parseChannexRevision({ id: "x", attributes: { status: "new" } })).toBeNull();
  });
});
