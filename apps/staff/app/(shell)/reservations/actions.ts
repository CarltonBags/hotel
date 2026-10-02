"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canAtAnyProperty } from "@hoteloftware/domain";
import {
  assignRoom,
  cancelBooking,
  cancelReservation,
  createBooking,
  createGuest,
  listRoomChoices,
  moveRoom,
  moveRoomInHouse,
  previewBookingCancellation,
  previewCancellation,
  findGuest,
  searchCompanies,
  searchGuests,
  setCancellationFeeStatus,
  unassignRooms,
  updateBookingNotes,
  updateReservation,
  OverbookingNeeded,
  ShorteningNeedsConfirmation,
  type Guest,
  type NewBooking,
  type RoomChoice,
} from "@hoteloftware/db";
import { authorize, authorizeAnywhere } from "@/lib/authorize";
import { announceReservations } from "@/lib/live";
import { reservationScope } from "@/lib/reservation-scope";
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
      force: r?.force === true,
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
    await announceReservations(tenant.id, String(propertyId));
  });
  if (firstId) redirect(`/reservations/${firstId}`);
  return state;
}

// ── changes on an existing reservation (ticket 22) ──

export interface EditState extends FormState {
  /** The change needs rooms the room type no longer has; the user may confirm to overbook. */
  needsOverbooking?: boolean;
  /** A checked-in stay gives up nights: the Charges that would be voided and the early-departure fee, to confirm. */
  shortening?: { voids: { serviceDate: string; description: string; amount: number }[]; fee: number };
}

export async function editReservationAction(
  reservationId: string,
  patch: { arrival: string; departure: string; adults: number; childAges: number[]; roomTypeId: string },
  force: boolean,
  confirmShortening = false,
): Promise<EditState> {
  let needsOverbooking = false;
  let shortening: EditState["shortening"];
  const state = await formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    try {
      await updateReservation(
        pool(),
        schema,
        reservation.id,
        userId,
        {
          arrival: String(patch?.arrival),
          departure: String(patch?.departure),
          adults: Number(patch?.adults),
          childAges: Array.isArray(patch?.childAges) ? patch.childAges.map(Number) : [],
          roomTypeId: String(patch?.roomTypeId),
        },
        { force: force === true, confirmShortening: confirmShortening === true },
      );
    } catch (err) {
      if (err instanceof OverbookingNeeded) needsOverbooking = true;
      if (err instanceof ShorteningNeedsConfirmation) shortening = { voids: err.voids.map((v) => ({ serviceDate: v.serviceDate, description: v.description, amount: v.amount })), fee: err.fee };
      throw err;
    }
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
  return { ...state, ...(needsOverbooking ? { needsOverbooking } : {}), ...(shortening ? { shortening } : {}) };
}

export async function previewCancelAction(reservationId: string, whole: boolean): Promise<{ amount: number; deadline: string | null } | { error: string }> {
  let preview: { amount: number; deadline: string | null } | undefined;
  const state = await formAction(async () => {
    const { schema, reservation } = await reservationScope(reservationId);
    preview = whole ? { amount: (await previewBookingCancellation(pool(), schema, reservation.booking.id)).amount, deadline: null } : await previewCancellation(pool(), schema, reservation.id);
  });
  return preview ?? { error: state.error ?? "Something went wrong." };
}

export async function cancelAction(reservationId: string, whole: boolean): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    if (whole) await cancelBooking(pool(), schema, reservation.booking.id, userId);
    else await cancelReservation(pool(), schema, reservation.id, userId);
    for (const id of reservation.booking.reservationIds) revalidatePath(`/reservations/${id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Cancelled." };
  });
}

export async function feeAction(reservationId: string, status: "confirmed" | "waived"): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    await setCancellationFeeStatus(pool(), schema, reservation.id, userId, status === "confirmed" ? "confirmed" : "waived");
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
}

/** Rooms to choose from, with features; a guest in house may move into another room type, so every type is listed for them. */
export async function roomChoicesAction(reservationId: string, from?: string): Promise<RoomChoice[]> {
  const { schema, reservation } = await reservationScope(reservationId);
  return listRoomChoices(pool(), schema, reservation.id, { from: from ? String(from) : undefined });
}

export async function assignRoomAction(reservationId: string, roomId: string, from: string | null): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    // in house: the move may change the room type, repricing those nights and their Charges
    if (from && reservation.status === "checked_in") await moveRoomInHouse(pool(), schema, reservation.id, userId, String(roomId), String(from));
    else if (from && reservation.assignments.length) await moveRoom(pool(), schema, reservation.id, userId, String(roomId), String(from));
    else await assignRoom(pool(), schema, reservation.id, userId, String(roomId));
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
}

export async function unassignAction(reservationId: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    await unassignRooms(pool(), schema, reservation.id, userId);
    revalidatePath(`/reservations/${reservation.id}`);
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
}

export async function notesAction(reservationId: string, notes: string): Promise<FormState> {
  return formAction(async () => {
    const { schema, tenantId, reservation, userId } = await reservationScope(reservationId);
    await updateBookingNotes(pool(), schema, reservation.id, userId, String(notes ?? "").slice(0, 2000));
    for (const id of reservation.booking.reservationIds) revalidatePath(`/reservations/${id}`);
    revalidatePath("/");
    await announceReservations(tenantId, reservation.propertyId);
    return { ok: true, message: "Saved." };
  });
}

/** One guest's full profile for the side drawer, with what the user may see and change. */
export async function guestForDrawer(guestId: string): Promise<{ guest: Guest; contacts: boolean; canEdit: boolean } | { error: string }> {
  let out: { guest: Guest; contacts: boolean; canEdit: boolean } | undefined;
  const state = await formAction(async () => {
    const { tenant, actor } = await authorizeAnywhere("view_guests");
    const guest = await findGuest(pool(), tenant.schemaName, String(guestId));
    if (!guest) throw new Error("Guest not found");
    out = { guest, contacts: canAtAnyProperty(actor, "view_guest_contacts"), canEdit: canAtAnyProperty(actor, "edit_guests") };
  });
  return out ?? { error: state.error ?? "Something went wrong." };
}
