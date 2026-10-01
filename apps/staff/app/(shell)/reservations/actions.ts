"use server";

import { redirect } from "next/navigation";
import { canAtAnyProperty } from "@hoteloftware/domain";
import { createBooking, createGuest, searchCompanies, searchGuests, type NewBooking } from "@hoteloftware/db";
import { authorize, authorizeAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { formAction, type FormState } from "@/lib/form";
import { loadShell } from "@/lib/shell";

export interface Picked {
  id: string;
  label: string;
}

/** Guest search for the booking form (tenant-wide profiles); contact data only for users who may see it. */
export async function findGuests(query: string): Promise<Picked[]> {
  const { tenant, actor } = await authorizeAnywhere("view_guests");
  const contacts = canAtAnyProperty(actor, "view_guest_contacts");
  const found = await searchGuests(pool(), tenant.schemaName, String(query).slice(0, 100), { limit: 8 });
  return found.map((g) => ({ id: g.id, label: [`${g.lastName}, ${g.firstName}`, contacts ? g.dateOfBirth : null, contacts ? g.email : null].filter(Boolean).join(" · ") }));
}

/**
 * A profile with just a name, for a walk-in or a phone booking; details and
 * the duplicate check come on the profile (a name alone matches no duplicate
 * key: email, phone, name plus birth date).
 */
export async function quickGuest(input: { firstName: string; lastName: string }): Promise<Picked | { error: string }> {
  let picked: Picked | undefined;
  const state = await formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("edit_guests");
    const { scope } = await loadShell();
    const g = await createGuest(pool(), tenant.schemaName, { firstName: String(input?.firstName ?? "").slice(0, 100), lastName: String(input?.lastName ?? "").slice(0, 100) }, { userId: session.user.id, propertyId: scope !== "all" ? scope : null });
    picked = { id: g.id, label: `${g.lastName}, ${g.firstName}` };
  });
  return picked ?? { error: state.error ?? "Something went wrong." };
}

export async function findCompanies(query: string): Promise<Picked[]> {
  const { tenant } = await authorizeAnywhere("view_companies");
  return (await searchCompanies(pool(), tenant.schemaName, String(query).slice(0, 100), 8)).map((c) => ({ id: c.id, label: c.name }));
}

/** Input from the browser, checked for shape before it reaches the repository. */
function readBooking(input: unknown): NewBooking {
  const i = (input ?? {}) as Record<string, unknown>;
  const booker = (i.booker ?? {}) as Record<string, unknown>;
  if (!Array.isArray(i.reservations)) throw new Error("A booking needs at least one reservation");
  const bookerValue = typeof booker.companyId === "string" ? { companyId: booker.companyId } : typeof booker.guestId === "string" ? { guestId: booker.guestId } : null;
  if (!bookerValue) throw new Error("Choose the Booker");
  return {
    booker: bookerValue,
    walkIn: i.walkIn === true,
    notes: String(i.notes ?? "").slice(0, 2000),
    rateCode: typeof i.rateCode === "string" && i.rateCode ? i.rateCode.slice(0, 50) : undefined,
    reservations: (i.reservations as Record<string, unknown>[]).map((r) => ({
      arrival: String(r?.arrival),
      departure: String(r?.departure),
      adults: Number(r?.adults),
      childAges: Array.isArray(r?.childAges) ? (r.childAges as unknown[]).map(Number) : [],
      roomTypeId: String(r?.roomTypeId),
      ratePlanId: String(r?.ratePlanId),
      primaryGuestId: String(r?.primaryGuestId),
      expectedTotal: typeof r?.expectedTotal === "number" ? r.expectedTotal : undefined,
    })),
  };
}

/** Create the Booking; quotes and availability are checked again on the server, against the totals the user saw. */
export async function createBookingAction(propertyId: string, input: NewBooking): Promise<FormState> {
  let firstId: string | undefined;
  const state = await formAction(async () => {
    const { tenant, session } = await authorize("manage_reservations", String(propertyId));
    const booking = await createBooking(pool(), tenant.schemaName, String(propertyId), session.user.id, readBooking(input));
    firstId = booking.reservations[0]!.id;
  });
  if (firstId) redirect(`/reservations/${firstId}`);
  return state;
}
