"use server";

import { revalidatePath } from "next/cache";
import { createProperty, updateProperty, type PropertyInput } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

function read(formData: FormData): PropertyInput {
  return {
    name: field(formData, "name"),
    legalEntityId: field(formData, "legalEntityId"),
    country: field(formData, "country"),
    timeZone: field(formData, "timeZone"),
    currency: field(formData, "currency"),
  };
}

export async function saveProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("manage_properties");
    const id = field(formData, "id");
    if (id) await updateProperty(pool(), tenant.schemaName, id, read(formData));
    else await createProperty(pool(), tenant.schemaName, read(formData));
    revalidatePath("/settings/properties");
    revalidatePath("/");
    return { ok: true, message: "Saved." };
  });
}
