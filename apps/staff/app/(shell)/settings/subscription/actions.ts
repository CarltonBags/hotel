"use server";

import { revalidatePath } from "next/cache";
import { setDirectDebit, setYearly } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

async function owner() {
  const { tenant, session } = await authorize("manage_subscription");
  if (session.support) throw new Error("Payment details are the Owner's");
  return { tenant, userId: session.user.id };
}

/** The Owner's SEPA direct debit (ticket 88): the mandate reference and the last digits; the account stays with the provider. */
export async function directDebitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, userId } = await owner();
    const last4 = field(formData, "last4");
    await setDirectDebit(pool(), tenant.id, { accountHolder: field(formData, "accountHolder"), mandateReference: field(formData, "mandateReference"), ...(last4 ? { last4 } : {}) }, userId);
    revalidatePath("/settings/subscription");
    return { ok: true, message: "Saved." };
  });
}

/** Yearly prepayment from next month, or back to monthly at the end of a prepaid year. */
export async function yearlyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, userId } = await owner();
    await setYearly(pool(), tenant.id, formData.get("yearly") === "on", todayIn("Europe/Berlin"), userId);
    revalidatePath("/settings/subscription");
    return { ok: true, message: "Saved." };
  });
}
