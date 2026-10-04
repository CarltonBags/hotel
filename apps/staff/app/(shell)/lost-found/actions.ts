"use server";

import { revalidatePath } from "next/cache";
import { setLostItemStatus, type LostItem } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { field, formAction, type FormState } from "@/lib/form";

export async function lostItemStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const { tenant, session, actor } = await authorize("view_lost_items", field(formData, "propertyId"));
    await setLostItemStatus(pool(), tenant.schemaName, field(formData, "id"), field(formData, "status") as LostItem["status"], { userId: session.user.id, actor });
    revalidatePath("/lost-found");
  });
}
