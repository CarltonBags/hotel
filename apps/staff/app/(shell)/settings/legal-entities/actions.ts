"use server";

import { revalidatePath } from "next/cache";
import { createLegalEntity, setInvoiceNumberRange, updateLegalEntity, type LegalEntityInput } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

function read(formData: FormData): LegalEntityInput {
  return {
    name: field(formData, "name"),
    addressLine1: field(formData, "addressLine1"),
    addressLine2: field(formData, "addressLine2"),
    postalCode: field(formData, "postalCode"),
    city: field(formData, "city"),
    country: field(formData, "country"),
    vatId: field(formData, "vatId"),
    iban: field(formData, "iban"),
    bic: field(formData, "bic"),
    accountHolder: field(formData, "accountHolder"),
    taxNumber: field(formData, "taxNumber"),
    invoiceEmail: field(formData, "invoiceEmail"),
    invoicePhone: field(formData, "invoicePhone"),
  };
}

export async function saveLegalEntity(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("manage_legal_entities");
    const id = field(formData, "id");
    if (id) await updateLegalEntity(pool(), tenant.schemaName, id, read(formData));
    else await createLegalEntity(pool(), tenant.schemaName, read(formData));
    revalidatePath("/settings/legal-entities");
    return { ok: true, message: "Saved." };
  });
}

/** A number range's format (and, for a new range, its first number). An empty deposit or cancellation format keeps those on the final range. */
export async function saveNumberRange(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("manage_legal_entities");
    const kind = field(formData, "kind");
    if (kind !== "final" && kind !== "deposit" && kind !== "cancellation") throw new Error("Unknown range");
    const format = field(formData, "format");
    if (!format) return { ok: true, message: "Unchanged." };
    const start = field(formData, "startAt");
    await setInvoiceNumberRange(pool(), tenant.schemaName, field(formData, "legalEntityId"), kind, format, start ? Number(start) : undefined);
    revalidatePath("/settings/legal-entities");
    return { ok: true, message: "Saved." };
  });
}
