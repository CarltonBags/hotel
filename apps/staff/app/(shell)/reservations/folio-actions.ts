"use server";

import { revalidatePath } from "next/cache";
import { ROUTING_CATEGORIES, isOneOf } from "@hoteloftware/domain";
import { addFixedCharge, addFolio, checkIn, moveCharge, postFreeTextCharge, postServiceCharge, removeFixedCharge, setRouting, voidCharge } from "@hoteloftware/db";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";

/**
 * Check-in and folio work on one reservation (ticket 26). The reservation's
 * own property decides each right; ids from the browser are re-read.
 */

const optionalDate = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export async function checkInAction(reservationId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "check_in");
    await checkIn(pool(), schema, reservation.id, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Checked in." };
  });
}

export async function postServiceAction(reservationId: string, input: { serviceId: string; quantity: number; serviceDate?: string }): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "post_charges");
    await postServiceCharge(pool(), schema, reservation.id, { serviceId: String(input?.serviceId), quantity: Number(input?.quantity), serviceDate: optionalDate(input?.serviceDate) }, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Posted." };
  });
}

export async function postFreeTextAction(reservationId: string, input: { description: string; amount: number; taxCodeId: string; serviceDate?: string }): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "post_free_text_charges");
    await postFreeTextCharge(
      pool(),
      schema,
      reservation.id,
      { description: String(input?.description ?? ""), amount: Number(input?.amount), taxCodeId: String(input?.taxCodeId), serviceDate: optionalDate(input?.serviceDate) },
      userId,
    );
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Posted." };
  });
}

export async function voidChargeAction(reservationId: string, chargeId: string, reason: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "manage_folios");
    await voidCharge(pool(), schema, reservation.id, String(chargeId), String(reason ?? ""), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Voided." };
  });
}

export async function moveChargeAction(reservationId: string, chargeId: string, folioId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "manage_folios");
    await moveCharge(pool(), schema, reservation.id, String(chargeId), String(folioId), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Moved." };
  });
}

export async function addFolioAction(reservationId: string, billTo: { guestId?: string; companyId?: string }): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation, userId } = await reservationScope(reservationId, "manage_folios");
    const target = typeof billTo?.companyId === "string" && billTo.companyId ? { companyId: billTo.companyId } : { guestId: String(billTo?.guestId ?? "") };
    await addFolio(pool(), schema, reservation.id, target, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "Saved." };
  });
}

export async function routingAction(reservationId: string, category: string, folioId: string | null): Promise<FormState> {
  return formAction(async () => {
    const { schema, reservation } = await reservationScope(reservationId, "manage_folios");
    if (!isOneOf(ROUTING_CATEGORIES, String(category))) throw new Error("Unknown routing category");
    await setRouting(pool(), schema, reservation.id, String(category), folioId ? String(folioId) : null);
    revalidatePath(`/reservations/${reservation.id}`);
    return { ok: true, message: "Saved." };
  });
}

export async function addFixedChargeAction(reservationId: string, input: { serviceId: string; from: string; to: string; quantity: number; unitPrice?: number | null }): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "post_charges");
    await addFixedCharge(
      pool(),
      schema,
      reservation.id,
      {
        serviceId: String(input?.serviceId),
        from: String(input?.from),
        to: String(input?.to),
        quantity: Number(input?.quantity),
        unitPrice: typeof input?.unitPrice === "number" ? input.unitPrice : undefined,
      },
      userId,
    );
    revalidatePath(`/reservations/${reservation.id}`);
    revalidatePath("/");
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
}

export async function removeFixedChargeAction(reservationId: string, fixedChargeId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId, "manage_folios");
    await removeFixedCharge(pool(), schema, reservation.id, String(fixedChargeId), userId);
    revalidatePath(`/reservations/${reservation.id}`);
    revalidatePath("/");
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Removed." };
  });
}
