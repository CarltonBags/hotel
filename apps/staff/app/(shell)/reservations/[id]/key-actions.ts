"use server";

import { revalidatePath } from "next/cache";
import { issueCardKey, readKeyCard, revokeRoomKey, setLateCheckout } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { lockDeps } from "@/lib/locks";

/** Keys at the desk (ticket 67): who checks guests in; the db layer checks the reservation's property again. */
export async function issueCardAction(propertyId: string, reservationId: string, encoderId: string): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("check_in", propertyId);
    await issueCardKey(pool(), p.tenant.schemaName, reservationId, String(encoderId), { userId: p.session.user.id, actor: p.actor }, lockDeps());
    revalidatePath(`/reservations/${reservationId}`);
    return { ok: true, message: "Key card written." };
  });
}

export async function revokeKeyAction(propertyId: string, reservationId: string, keyId: string): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("check_in", propertyId);
    await revokeRoomKey(pool(), p.tenant.schemaName, keyId, { userId: p.session.user.id, actor: p.actor }, lockDeps());
    revalidatePath(`/reservations/${reservationId}`);
    return { ok: true, message: "Key revoked." };
  });
}

export async function lateCheckoutAction(propertyId: string, reservationId: string, time: string): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("check_in", propertyId);
    await setLateCheckout(pool(), p.tenant.schemaName, reservationId, String(time) || null, { userId: p.session.user.id, actor: p.actor });
    revalidatePath(`/reservations/${reservationId}`);
    return { ok: true, message: "Saved." };
  });
}

export async function readCardAction(propertyId: string, encoderId: string): Promise<FormState & { card?: { room: string | null; guest: string | null; validUntil: string; status: string | null } | null }> {
  let card: { room: string | null; guest: string | null; validUntil: string; status: string | null } | null = null;
  const r = await formAction(async () => {
    const p = await authorize("check_in", propertyId);
    card = await readKeyCard(pool(), p.tenant.schemaName, propertyId, String(encoderId), { userId: p.session.user.id, actor: p.actor }, lockDeps());
  });
  return { ...r, card };
}
