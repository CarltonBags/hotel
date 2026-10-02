import { publishDataChange } from "@hoteloftware/events";
import { pool } from "./db";

/**
 * Tell open screens that reservations of a property changed (lists, Today,
 * Calendar refresh). Runs after the change committed; a failure to announce
 * never fails the change itself.
 */
export async function announceReservations(tenantId: string, propertyId: string): Promise<void> {
  try {
    await publishDataChange(pool(), { tenantId, kind: "reservations", propertyId });
  } catch (err) {
    console.error("live update not sent", err);
  }
}
