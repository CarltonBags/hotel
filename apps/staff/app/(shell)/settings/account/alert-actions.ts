"use server";

import { revalidatePath } from "next/cache";
import { setAlertSettings } from "@hoteloftware/db";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/** The user's own alert settings (ticket 39): email, and SMS for urgent alerts. */
export async function alertSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { session } = await requirePrincipal();
    if (session.support) throw new Error("Support accesses keep no settings in the customer's tenant");
    await setAlertSettings(pool(), session.user.id, { email: flag(formData, "email"), sms: flag(formData, "sms"), phone: field(formData, "phone") || null });
    revalidatePath("/settings/account");
  });
}
