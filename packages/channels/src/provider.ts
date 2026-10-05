import type { ChannelBookingRevision } from "./bookings";

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
  /** The occupancy options follow the room type's adult count. */
  updateRatePlan(id: string, r: ChannelRatePlan): Promise<void>;
  pushAvailability(values: AvailabilityValue[]): Promise<void>;
  pushRestrictions(values: RestrictionValue[]): Promise<void>;
  /** Booking revisions not yet acknowledged for a property (ticket 38). */
  bookingFeed(propertyId: string): Promise<ChannelBookingRevision[]>;
  /** Acknowledge a revision once it is applied (or set aside for staff). */
  ackRevision(revisionId: string): Promise<void>;
  /** Ask the channel manager to tell us of new booking revisions of a property (a trigger only: we pull the feed). */
  registerBookingWebhook(propertyId: string, url: string, headers: Record<string, string>): Promise<void>;
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

/** Values per call: a full push of a large property stays well under Channex's 10 MB request limit. */
export const VALUES_PER_CALL = 2000;
