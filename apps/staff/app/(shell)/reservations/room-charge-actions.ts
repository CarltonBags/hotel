"use server";

import { revalidatePath } from "next/cache";
import { setRoomChargeBlocked } from "@hoteloftware/db";
import { flag, field, formAction, type FormState } from "@/lib/form";
import { pool } from "@/lib/db";
import { reservationScope } from "@/lib/reservation-scope";

/** Block a stay from Room Charges at the outlets ("cash only"), or open it again (ticket 61): the desk, on the reservation's own property. */
export async function roomChargeBlockedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation } = await reservationScope(field(formData, "reservationId"), "manage_folios");
    await setRoomChargeBlocked(pool(), schema, reservation.id, flag(formData, "blocked"));
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "Saved." };
  });
}
