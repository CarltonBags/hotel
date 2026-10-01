"use server";

import { revalidatePath } from "next/cache";
import { createLegalEntity, updateLegalEntity, type LegalEntityInput } from "@hoteloftware/db";
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
