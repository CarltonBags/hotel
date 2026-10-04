"use server";

import { revalidatePath } from "next/cache";
import { goLive, markGoLiveChecked } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { flag, formAction, type FormState } from "@/lib/form";

/** Our support staff, inside the tenant through a Support Access, confirm or take back the checklist check (ticket 87). */
export async function markCheckedAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session } = await authorize("manage_tenant_settings");
    if (!session.support) throw new Error("Only our support staff check the checklist");
    await markGoLiveChecked(pool(), tenant.id, flag(formData, "checked") ? session.user.id : null);
    revalidatePath("/settings/go-live");
  });
}

/** The Owner takes the tenant live: test records are cleared, numbering and the Business Date start. */
export async function goLiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant } = await authorize("go_live");
    if (!flag(formData, "confirm")) throw new Error("Confirm that the test records are deleted");
    await goLive(pool(), tenant);
    revalidatePath("/", "layout");
    return { ok: true, message: "You are live." };
  });
}
