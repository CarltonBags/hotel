import { parseChannexRevision, type ChannelBookingRevision } from "./bookings";
import { ChannelError, VALUES_PER_CALL, type AvailabilityValue, type ChannelManager, type ChannelProperty, type ChannelRatePlan, type ChannelRoomType, type RestrictionValue } from "./provider";

/** Channex.io over its REST API (staging or production), authenticated with the platform's API key. */
export class ChannexManager implements ChannelManager {
  readonly name = "channex";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://staging.channex.io/api/v1",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: { "user-api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

  private ratePlan(r: ChannelRatePlan) {
    // priced per person: one option per adult count, the primary one at the plan's base occupancy
    const options = Array.from({ length: r.maxAdults }, (_, i) => ({ occupancy: i + 1, is_primary: i + 1 === Math.min(r.primaryOccupancy, r.maxAdults), rate: 0 }));
    return { property_id: r.propertyId, room_type_id: r.roomTypeId, title: r.title, currency: r.currency, sell_mode: "per_person", rate_mode: "manual", options };
  }

  createRatePlan(r: ChannelRatePlan): Promise<string> {
    return this.create("/rate_plans", "rate_plan", this.ratePlan(r));
  }

  async updateRatePlan(id: string, r: ChannelRatePlan): Promise<void> {
    await this.call("PUT", `/rate_plans/${encodeURIComponent(id)}`, { rate_plan: this.ratePlan(r) });
  }

  async pushAvailability(values: AvailabilityValue[]): Promise<void> {
    for (let i = 0; i < values.length; i += VALUES_PER_CALL) await this.sendAvailability(values.slice(i, i + VALUES_PER_CALL));
  }

  private async sendAvailability(values: AvailabilityValue[]): Promise<void> {
    await this.call("POST", "/availability", { values: values.map((v) => ({ property_id: v.propertyId, room_type_id: v.roomTypeId, date_from: v.dateFrom, date_to: v.dateTo, availability: v.availability })) });
  }

  async pushRestrictions(values: RestrictionValue[]): Promise<void> {
    for (let i = 0; i < values.length; i += VALUES_PER_CALL) await this.sendRestrictions(values.slice(i, i + VALUES_PER_CALL));
  }

  private async sendRestrictions(values: RestrictionValue[]): Promise<void> {
    await this.call("POST", "/restrictions", {
      values: values.map((v) => ({
        property_id: v.propertyId,
        rate_plan_id: v.ratePlanId,
        date_from: v.dateFrom,
        date_to: v.dateTo,
        // a closed date carries no prices
        ...(v.rates.length ? { rates: v.rates.map((r) => ({ occupancy: r.occupancy, rate: r.rate.toFixed(2) })) } : {}),
        stop_sell: v.stopSell,
        closed_to_arrival: v.closedToArrival,
        closed_to_departure: v.closedToDeparture,
        min_stay_arrival: v.minStayArrival,
        min_stay_through: v.minStayThrough,
        max_stay: v.maxStay,
      })),
    });
  }

  async bookingFeed(propertyId: string): Promise<ChannelBookingRevision[]> {
    const out: ChannelBookingRevision[] = [];
    // the feed pages through unacknowledged revisions, oldest first
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<{ data?: unknown[]; meta?: { total?: number; limit?: number } }>("GET", `/booking_revisions/feed?filter[property_id]=${encodeURIComponent(propertyId)}&pagination[page]=${page}&pagination[limit]=50`);
      const data = r.data ?? [];
      for (const d of data) {
        const rev = parseChannexRevision(d);
        if (rev) out.push(rev);
        else console.error("[channex] a booking revision we cannot read", JSON.stringify(d).slice(0, 500));
      }
      if (data.length < 50) break;
    }
    return out;
  }

  async ackRevision(revisionId: string): Promise<void> {
    await this.call("POST", `/booking_revisions/${encodeURIComponent(revisionId)}/ack`, {});
  }

  async registerBookingWebhook(propertyId: string, url: string, headers: Record<string, string>): Promise<void> {
    await this.call("POST", "/webhooks", { webhook: { property_id: propertyId, callback_url: url, event_mask: "booking", headers, is_active: true, send_data: false } });
  }
}
