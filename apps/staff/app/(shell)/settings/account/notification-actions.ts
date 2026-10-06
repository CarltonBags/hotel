"use server";

import { revalidatePath } from "next/cache";
import { setNotificationChannels } from "@hoteloftware/db";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, flag, formAction, type FormState } from "@/lib/form";

/**
 * The user's own Notification channels (ticket 39): email, and SMS for the
 * urgent kinds. Their own settings only: no right to check beyond signing in.
 */
export async function notificationChannelsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { session } = await requirePrincipal();
    if (session.support) throw new Error("Support accesses keep no settings in the customer's tenant");
    await setNotificationChannels(pool(), session.user.id, { email: flag(formData, "email"), sms: flag(formData, "sms"), phone: field(formData, "phone") || null });
    revalidatePath("/settings/account");
  });
}
