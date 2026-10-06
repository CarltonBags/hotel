"use server";

import { revalidatePath } from "next/cache";
import { chargeStoredCard } from "@hoteloftware/db";
import { paymentProvider } from "@hoteloftware/payments";
import { pool } from "@/lib/db";
import { decimal, field, formAction, type FormState } from "@/lib/form";
import { reservationScope } from "@/lib/reservation-scope";

/** A merchant-initiated charge on the stored card; a decline is told as it is. */
export async function chargeStoredCardAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(field(formData, "reservationId"), "take_payments");
    const p = await chargeStoredCard(pool(), schema, paymentProvider(), { reservationId: reservation.id, amount: decimal(formData, "amount") }, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    if (p.status === "failed") return { error: `Declined: ${p.error ?? "the card was not accepted"}` };
    return { ok: true, message: p.status === "succeeded" ? "Charged." : "Waiting for the card's answer." };
  });
}
