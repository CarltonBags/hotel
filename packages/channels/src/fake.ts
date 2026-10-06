import { randomUUID } from "node:crypto";
import { ChannelError, type AvailabilityValue, type ChannelManager, type ChannelProperty, type ChannelRatePlan, type ChannelRoomType, type RestrictionValue } from "./provider";

/** In-memory channel manager for tests and development without a Channex key: keeps what it was told. */
export class FakeChannelManager implements ChannelManager {
  readonly name = "fake-channels";
  readonly properties = new Map<string, ChannelProperty>();
  readonly roomTypes = new Map<string, ChannelRoomType>();
  readonly ratePlans = new Map<string, ChannelRatePlan>();
  readonly calls: ({ kind: "availability"; values: AvailabilityValue[] } | { kind: "restrictions"; values: RestrictionValue[] })[] = [];
  /** The next push fails (to see the alert and the retry). */
  failNext: ChannelError | null = null;

  async createProperty(p: ChannelProperty): Promise<string> {
    const id = randomUUID();
    this.properties.set(id, p);
    return id;
  }
  async createRoomType(r: ChannelRoomType): Promise<string> {
    const id = randomUUID();
    this.roomTypes.set(id, r);
    return id;
  }
  async updateRoomType(id: string, r: ChannelRoomType): Promise<void> {
    this.roomTypes.set(id, r);
  }
  async createRatePlan(r: ChannelRatePlan): Promise<string> {
    const id = randomUUID();
    this.ratePlans.set(id, r);
    return id;
  }
  async updateRatePlan(id: string, r: ChannelRatePlan): Promise<void> {
    this.ratePlans.set(id, r);
  }
  private fail() {
    const f = this.failNext;
    this.failNext = null;
    if (f) throw f;
  }
  async pushAvailability(values: AvailabilityValue[]): Promise<void> {
    this.fail();
    if (values.length) this.calls.push({ kind: "availability", values });
  }
  async pushRestrictions(values: RestrictionValue[]): Promise<void> {
    this.fail();
    if (values.length) this.calls.push({ kind: "restrictions", values });
  }
  /** The value last pushed for a room type on a date. */
  availabilityOn(roomTypeId: string, date: string): number | undefined {
    let found: number | undefined;
    for (const c of this.calls) if (c.kind === "availability") for (const v of c.values) if (v.roomTypeId === roomTypeId && v.dateFrom <= date && v.dateTo >= date) found = v.availability;
    return found;
  }
  restrictionOn(ratePlanId: string, date: string): RestrictionValue | undefined {
    let found: RestrictionValue | undefined;
    for (const c of this.calls) if (c.kind === "restrictions") for (const v of c.values) if (v.ratePlanId === ratePlanId && v.dateFrom <= date && v.dateTo >= date) found = v;
    return found;
  }
}
