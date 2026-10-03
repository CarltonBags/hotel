"use server";

import { revalidatePath } from "next/cache";
import { can } from "@hoteloftware/domain";
import { overrideNightPrices } from "@hoteloftware/db";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
import { pool } from "@/lib/db";
import { formAction } from "@/lib/form";
import { withApproval, type ApprovalMode, type ApprovalState } from "@/lib/approval";

/** Price Override on one reservation (ticket 31): Front Desk and Property Manager; below the floor or complimentary with an Approval. */
export async function priceOverrideAction(reservationId: string, nights: { date: string; price: number }[], reason: string, approval?: ApprovalMode): Promise<ApprovalState> {
  let state: ApprovalState = {};
  const outer = await formAction(async () => {
    const { schema, tenantId, reservation, userId, userName, actor } = await reservationScope(reservationId, "override_prices");
    const input = { nights: (Array.isArray(nights) ? nights : []).map((n) => ({ date: String(n.date), price: Number(n.price) })), reason: String(reason ?? "") };
    state = await withApproval({ tenantId, schema, propertyId: reservation.propertyId, userId, userName }, approval, async (approverId) => {
      await overrideNightPrices(pool(), schema, reservation.id, input, { userId, canApprove: can(actor, "approve_requests", reservation.propertyId), approverId });
      revalidatePath(`/reservations/${reservation.id}`);
      await announceReservations(tenantId, reservation.propertyId);
      return { ok: true, message: "Prices saved." };
    });
    return state;
  });
  return outer.error ? outer : state;
}
