"use server";

import { revalidatePath } from "next/cache";
import { setPaymentDetails } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** The Owner changes how the subscription is paid (ticket 88): SEPA mandate, card at the provider, or transfer by arrangement. */
export async function paymentDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorize("manage_subscription");
    if (session.support) throw new Error("Payment details are the Owner's");
    // a card is added with the payment provider, not typed in here
    const method = field(formData, "method") === "transfer" ? "transfer" : "sepa";
    const last4 = field(formData, "last4");
    await setPaymentDetails(pool(), tenant.id, { method, accountHolder: field(formData, "accountHolder"), mandateReference: field(formData, "mandateReference"), ...(last4 ? { last4 } : {}), yearly: formData.get("yearly") === "on" }, session.user.id);
    revalidatePath("/settings/subscription");
    return { ok: true, message: "Saved." };
  });
}
