"use server";

import { redirect } from "next/navigation";
import { deleteTenant, endTenant } from "@hoteloftware/db";
import { todayIn } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

async function owner() {
  const p = await authorize("delete_tenant");
  if (p.session.support) throw new Error("Ending the contract is the Owner's");
  return p;
}

/** The Owner ends the contract (ticket 89): the data stays 90 days for the export, then it is deleted. */
export async function endContractAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await owner();
    if (field(formData, "confirm") !== tenant.slug) throw new Error(`Type ${tenant.slug} to confirm`);
    const due = await endTenant(pool(), tenant.id, { reason: "cancelled", today: todayIn("Europe/Berlin") }, session.user.id);
    return { ok: true, message: `Ended. The data is deleted on ${due}; download the export before.` };
  });
}

/** After the end, the Owner may have everything deleted at once instead of after 90 days. */
export async function deleteNowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const r = await formAction(async () => {
    const { tenant, session } = await owner();
    if (field(formData, "confirm") !== `delete ${tenant.slug}`) throw new Error(`Type "delete ${tenant.slug}" to confirm`);
    await deleteTenant(pool(), tenant.id, `owner ${session.user.id}`);
  });
  if (r.error) return r;
  redirect("/no-tenant");
}
