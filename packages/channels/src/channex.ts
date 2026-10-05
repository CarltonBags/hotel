import { ChannelError, type AvailabilityValue, type ChannelManager, type ChannelProperty, type ChannelRatePlan, type ChannelRoomType, type RestrictionValue } from "./provider";

/** Channex.io over its REST API (staging or production), authenticated with the platform's API key. */
export class ChannexManager implements ChannelManager {
  readonly name = "channex";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://staging.channex.io/api/v1",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: { "user-api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ChannelError(`Channex not reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const text = await res.text();
    if (!res.ok) throw new ChannelError(`Channex refused ${method} ${path} (${res.status}): ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async create(path: string, key: string, attributes: object): Promise<string> {
    const r = await this.call<{ data?: { id?: string } }>("POST", path, { [key]: attributes });
    if (!r.data?.id) throw new ChannelError(`Channex gave no id for ${path}`, false);
    return r.data.id;
  }

  createProperty(p: ChannelProperty): Promise<string> {
    return this.create("/properties", "property", { title: p.title, currency: p.currency, timezone: p.timezone, email: p.email, property_type: "hotel" });
  }

  private roomType(r: ChannelRoomType) {
    return { property_id: r.propertyId, title: r.title, count_of_rooms: r.rooms, occ_adults: r.maxAdults, occ_children: r.maxChildren, occ_infants: 0, default_occupancy: r.defaultOccupancy, room_kind: "room" };
  }

  createRoomType(r: ChannelRoomType): Promise<string> {
    return this.create("/room_types", "room_type", this.roomType(r));
  }

  async updateRoomType(id: string, r: ChannelRoomType): Promise<void> {
    await this.call("PUT", `/room_types/${encodeURIComponent(id)}`, { room_type: this.roomType(r) });
  }

  createRatePlan(r: ChannelRatePlan): Promise<string> {
    // priced per person: one option per adult count, the primary one at the plan's base occupancy
    const options = Array.from({ length: r.maxAdults }, (_, i) => ({ occupancy: i + 1, is_primary: i + 1 === Math.min(r.primaryOccupancy, r.maxAdults), rate: 0 }));
    return this.create("/rate_plans", "rate_plan", { property_id: r.propertyId, room_type_id: r.roomTypeId, title: r.title, currency: r.currency, sell_mode: "per_person", rate_mode: "manual", options });
  }

  async pushAvailability(values: AvailabilityValue[]): Promise<void> {
    if (!values.length) return;
    await this.call("POST", "/availability", { values: values.map((v) => ({ property_id: v.propertyId, room_type_id: v.roomTypeId, date_from: v.dateFrom, date_to: v.dateTo, availability: v.availability })) });
  }

  async pushRestrictions(values: RestrictionValue[]): Promise<void> {
    if (!values.length) return;
    await this.call("POST", "/restrictions", {
      values: values.map((v) => ({
        property_id: v.propertyId,
        rate_plan_id: v.ratePlanId,
        date_from: v.dateFrom,
        date_to: v.dateTo,
        rates: v.rates.map((r) => ({ occupancy: r.occupancy, rate: r.rate.toFixed(2) })),
        stop_sell: v.stopSell,
        closed_to_arrival: v.closedToArrival,
        closed_to_departure: v.closedToDeparture,
        min_stay_arrival: v.minStayArrival,
        min_stay_through: v.minStayThrough,
        max_stay: v.maxStay,
      })),
    });
  }
}
