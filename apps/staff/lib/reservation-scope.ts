import type { PropertyAction } from "@hoteloftware/domain";
import { findReservation } from "@hoteloftware/db";
import { authorize, requirePrincipal } from "./authorize";
import { pool } from "./db";

/**
 * For server actions on one reservation: the reservation's own property
 * decides the right (manage_reservations unless another is named); ids from
 * the browser are re-read on the server. Not a server action itself.
 */
export async function reservationScope(reservationId: string, action: PropertyAction = "manage_reservations") {
  const { tenant } = await requirePrincipal();
  const r = await findReservation(pool(), tenant.schemaName, String(reservationId));
  if (!r) throw new Error("Reservation not found");
  const { session } = await authorize(action, r.propertyId);
  return { schema: tenant.schemaName, tenantId: tenant.id, reservation: r, userId: session.user.id };
}
