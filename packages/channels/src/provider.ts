/**
 * The channel manager (ticket 37): Channex holds the property, its room types
 * and one external rate plan per (rate plan, room type) pair; we push
 * availability per room type and prices and restrictions per external rate
 * plan. Swappable; tests and development use the fake.
 */
export interface ChannelProperty {
  title: string;
  currency: string;
  timezone: string;
  email: string;
}

export interface ChannelRoomType {
  propertyId: string;
  title: string;
  rooms: number;
  maxAdults: number;
  maxChildren: number;
  defaultOccupancy: number;
}

export interface ChannelRatePlan {
  propertyId: string;
  roomTypeId: string;
  title: string;
  currency: string;
  /** The occupancy the price is for; the others follow from the supplements. */
  primaryOccupancy: number;
  maxAdults: number;
}

/** Rooms for sale of a room type over dates [from, to] (inclusive). */
export interface AvailabilityValue {
  propertyId: string;
  roomTypeId: string;
  dateFrom: string;
  dateTo: string;
  availability: number;
}

/** Prices per occupancy and restrictions of an external rate plan over dates [from, to] (inclusive). */
export interface RestrictionValue {
  propertyId: string;
  ratePlanId: string;
  dateFrom: string;
  dateTo: string;
  rates: { occupancy: number; rate: number }[];
  stopSell: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minStayArrival: number;
  minStayThrough: number;
  maxStay: number;
}

export interface ChannelManager {
  readonly name: string;
  createProperty(p: ChannelProperty): Promise<string>;
  createRoomType(r: ChannelRoomType): Promise<string>;
  updateRoomType(id: string, r: ChannelRoomType): Promise<void>;
  createRatePlan(r: ChannelRatePlan): Promise<string>;
  pushAvailability(values: AvailabilityValue[]): Promise<void>;
  pushRestrictions(values: RestrictionValue[]): Promise<void>;
}

export class ChannelError extends Error {
  constructor(
    message: string,
    /** Worth trying again later (rate limit, timeout, 5xx). */
    readonly retry: boolean,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

/** Channex's limit: 10 availability and 10 restriction calls per minute per property; we send one of each per run. */
export const CALLS_PER_MINUTE = 10;
