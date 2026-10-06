import { publishDataChange } from "@hoteloftware/events";
import { pool } from "./db";

/**
 * Tell open screens that reservations of a property changed (lists, Today,
 * Calendar refresh). Runs after the change committed; a failure to announce
 * never fails the change itself.
 */
export async function announceReservations(tenantId: string, propertyId: string): Promise<void> {
  await announce(tenantId, "reservations", propertyId);
}

/** Tell open spa books of the property that Appointments changed (ticket 64: also those a guest takes in the Portal). */
export async function announceSpa(tenantId: string, propertyId: string): Promise<void> {
  await announce(tenantId, "spa", propertyId);
}

async function announce(tenantId: string, kind: "reservations" | "spa", propertyId: string): Promise<void> {
  try {
    await publishDataChange(pool(), { tenantId, kind, propertyId });
  } catch (err) {
    console.error("live update not sent", err);
  }
}
