"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { GuestData } from "@hoteloftware/domain";
import { createGuest, findGuestDuplicates, mergeGuests, updateGuest, type GuestDuplicate } from "@hoteloftware/db";
import { authorizeAnywhere } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";
import { loadShell } from "@/lib/shell";

export interface NewGuestState extends FormState {
  duplicates?: GuestDuplicate[];
  /** What was submitted: React resets the form after an action, so the form is re-seeded from this. */
  values?: Partial<GuestData>;
}

const opt = (formData: FormData, name: string) => field(formData, name) || null;

/** The profile fields of a guest form; checkboxes come with a hidden "off" so unticking saves. */
function guestData(formData: FormData): Partial<GuestData> & { lastName: string } {
  const consent = flag(formData, "marketingConsent");
  return {
    firstName: field(formData, "firstName"),
    lastName: field(formData, "lastName"),
    dateOfBirth: opt(formData, "dateOfBirth"),
    nationality: opt(formData, "nationality"),
    countryOfResidence: opt(formData, "countryOfResidence"),
    postalCode: opt(formData, "postalCode"),
    addressLine1: field(formData, "addressLine1"),
    city: field(formData, "city"),
    email: opt(formData, "email"),
    phone: opt(formData, "phone"),
    language: opt(formData, "language"),
    preferences: field(formData, "preferences"),
    vip: flag(formData, "vip"),
    marketingConsent: consent,
    // proof: when it was given (kept from the form, or now when ticked first) and how
    marketingConsentAt: consent ? opt(formData, "marketingConsentAt") ?? new Date().toISOString() : null,
    marketingConsentSource: consent ? opt(formData, "marketingConsentSource") : null,
    documentType: (opt(formData, "documentType") as GuestData["documentType"]) ?? null,
    documentNumber: opt(formData, "documentNumber"),
    documentCountry: opt(formData, "documentCountry"),
    documentExpiry: opt(formData, "documentExpiry"),
  };
}

/** Create a profile; first shows possible duplicates unless the user chose to create anyway. */
export async function createGuestAction(_prev: NewGuestState, formData: FormData): Promise<NewGuestState> {
  let id: string | undefined;
  const values = guestData(formData);
  const state: NewGuestState = await formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("edit_guests");
    const data = values;
    if (!flag(formData, "createAnyway")) {
      const duplicates = await findGuestDuplicates(pool(), tenant.schemaName, data);
      if (duplicates.length) return { duplicates } as NewGuestState;
    }
    // the property in the navbar, validated against the user's properties
    const { scope } = await loadShell();
    const g = await createGuest(pool(), tenant.schemaName, data, { userId: session.user.id, propertyId: scope !== "all" ? scope : null });
    id = g.id;
  });
  if (id) redirect(`/guests/${id}`);
  return { ...state, values };
}

export async function saveGuestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("edit_guests");
    const id = field(formData, "id");
    await updateGuest(pool(), tenant.schemaName, id, guestData(formData), { userId: session.user.id });
    revalidatePath(`/guests/${id}`);
    return { ok: true, message: "Saved." };
  });
}

/** Merge another profile into this one; irreversible, so the form asks for a confirmation. */
export async function mergeGuestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorizeAnywhere("merge_guests");
    if (!flag(formData, "confirm")) throw new Error("Confirm that both profiles are the same person.");
    const keepId = field(formData, "keepId");
    await mergeGuests(pool(), tenant.schemaName, { keepId, mergeId: field(formData, "mergeId") }, { userId: session.user.id });
    revalidatePath(`/guests/${keepId}`);
    return { ok: true, message: "Merged." };
  });
}
