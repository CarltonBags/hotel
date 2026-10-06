"use server";

import { revalidatePath } from "next/cache";
import { reconcileTillPosting } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

/** A refused till posting settled by hand (ticket 65): who posts Charges at the property. */
export async function reconcileTillAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const p = await authorize("post_charges", field(formData, "propertyId"));
    await reconcileTillPosting(pool(), p.tenant.schemaName, field(formData, "id"), field(formData, "note"), { userId: p.session.user.id, actor: p.actor });
    revalidatePath("/till-postings");
    return { ok: true, message: "Reconciled." };
  });
}
