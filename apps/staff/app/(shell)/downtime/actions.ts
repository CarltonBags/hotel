"use server";

import { revalidatePath } from "next/cache";
import { setDowntimeOptions } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/** What the Downtime Reports show and in which order; the shift reminder (Property Manager). */
export async function downtimeOptionsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const propertyId = field(formData, "propertyId");
    const { tenant } = await authorize("manage_downtime", propertyId);
    await setDowntimeOptions(pool(), tenant.schemaName, propertyId, {
      show: { balance: flag(formData, "balance"), notes: flag(formData, "notes"), hkNotes: flag(formData, "hkNotes") },
      sort: field(formData, "sort") === "name" ? "name" : "room",
      reminderAt: field(formData, "reminderAt") || null,
      blankForms: Number(field(formData, "blankForms")),
    });
    revalidatePath("/downtime");
    return { ok: true, message: "Saved." };
  });
}
