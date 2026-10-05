"use server";

import { revalidatePath } from "next/cache";
import { sendGuestMessage } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

const MANUAL = ["card_request", "balance_request", "confirmation"] as const;

/** Send a card or balance request, or the confirmation again; it goes out with the next dispatch (within a minute). */
export async function sendGuestMessageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(field(formData, "reservationId"), "manage_reservations");
    const type = field(formData, "type");
    if (!(MANUAL as readonly string[]).includes(type)) throw new Error("This message cannot be sent by hand");
    await sendGuestMessage(pool(), schema, { reservationId: reservation.id, type: type as (typeof MANUAL)[number] }, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "Queued; it goes out within a minute." };
  });
}
