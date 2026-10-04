"use server";

import { revalidatePath } from "next/cache";
import { catchUp, endOutage, findProperty, logOutage, type CatchUpInput } from "@hoteloftware/db";
import { CATCH_UP_KINDS, zonedInstant, type CatchUpKind } from "@hoteloftware/domain";
import { paymentProvider } from "@hoteloftware/payments";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { decimalOrNull, field, formAction, type FormState } from "@/lib/form";

/** A local date and time at the property, as entered. */
async function localInstant(schema: string, propertyId: string, value: string): Promise<Date> {
  const p = await findProperty(pool(), schema, propertyId);
  if (!p) throw new Error("Property not found");
  const [date, time] = value.split("T");
  if (!date || !time) throw new Error("Give date and time");
  return zonedInstant(date, time.slice(0, 5), p.timeZone);
}

/** Log an outage of the property: start, and end once over (ticket 86). */
export async function logOutageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("use_downtime", propertyId);
    const startedAt = await localInstant(tenant.schemaName, propertyId, field(formData, "startedAt"));
    const endedAt = field(formData, "endedAt") ? await localInstant(tenant.schemaName, propertyId, field(formData, "endedAt")) : null;
    const cause = field(formData, "cause");
    await logOutage(pool(), tenant.schemaName, propertyId, { startedAt, endedAt, cause: cause === "hotel" || cause === "ours" ? cause : "unknown", note: field(formData, "note") }, session.user.id);
    revalidatePath("/catch-up");
    return { ok: true, message: "Outage logged." };
  });
}

export async function endOutageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("use_downtime", propertyId);
    await endOutage(pool(), tenant.schemaName, propertyId, field(formData, "outageId"), await localInstant(tenant.schemaName, propertyId, field(formData, "endedAt")));
    revalidatePath("/catch-up");
  });
}

/** The desk saw the service unreachable from one time to another: logged as an outage of unknown cause, unless one is logged already. */
export async function logOutageFromDeskAction(propertyId: string, from: string, to: string): Promise<void> {
  const { tenant, session } = await authorize("use_downtime", propertyId);
  const startedAt = new Date(from);
  const endedAt = new Date(to);
  // a blip under a minute is no outage
  if (!(endedAt.getTime() - startedAt.getTime() >= 60_000)) return;
  try {
    await logOutage(pool(), tenant.schemaName, propertyId, { startedAt, endedAt, cause: "unknown", note: "Seen by the desk" }, session.user.id);
  } catch {
    // overlapping one logged already: that one stands
  }
}

/** A Catch-up Entry: what happened during the outage, with the time it really happened. */
export async function catchUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant, session } = await authorize("use_downtime", propertyId);
    const kind = field(formData, "kind") as CatchUpKind;
    if (!CATCH_UP_KINDS.includes(kind)) throw new Error("Choose what happened");
    const reservationId = field(formData, "reservationId");
    const realAt = await localInstant(tenant.schemaName, propertyId, field(formData, "realAt"));
    const input: CatchUpInput =
      kind === "payment"
        ? { kind, reservationId, realAt, tender: field(formData, "tender"), amount: decimalOrNull(formData, "amount") ?? 0, reference: field(formData, "reference") }
        : kind === "room_move"
          ? { kind, reservationId, realAt, roomId: field(formData, "roomId") }
          : { kind, reservationId, realAt };
    // the right the same action needs at the desk: taking payments, or checking in and out (moves included)
    await authorize(kind === "payment" ? "take_payments" : "check_in", propertyId);
    await catchUp(pool(), tenant.schemaName, paymentProvider(), propertyId, input, session.user.id);
    revalidatePath("/catch-up");
    return { ok: true, message: "Entered after the outage." };
  });
}
