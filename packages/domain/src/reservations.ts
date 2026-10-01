/** Reservation lifecycle ("Reservation and inventory domain model"): no Tentative in v1. */
export const RESERVATION_STATUSES = ["confirmed", "checked_in", "checked_out", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that take a room of the room type on their nights. */
export const OCCUPYING_STATUSES: readonly ReservationStatus[] = ["confirmed", "checked_in"];

export const BOOKING_SOURCES = ["direct", "channel"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
