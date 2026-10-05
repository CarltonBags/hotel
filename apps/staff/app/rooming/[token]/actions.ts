"use server";

import { fillRoomingByToken } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

/** The organiser's names, sent through the link (ticket 59); the link is the only key, so only the group's open reservations are named. */
export async function fillRoomingAction(token: string, entries: { reservationId: string; firstName: string; lastName: string }[]): Promise<{ ok?: boolean; error?: string; saved?: number }> {
  const tenant = await currentTenant();
  if (!tenant) return { error: "Not found" };
  try {
    return { ok: true, saved: await fillRoomingByToken(pool(), tenant.schemaName, token, entries.map((e) => ({ reservationId: String(e.reservationId), firstName: String(e.firstName ?? ""), lastName: String(e.lastName ?? "") }))) };
  } catch (err) {
    return { error: err instanceof Error && !("code" in err) ? err.message : "Something went wrong. Please try again." };
  }
}
