"use server";

import { revalidatePath } from "next/cache";
import { PORTAL_USER, guestMayWrite, postGuestMessage } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { portalBaseUrl } from "@/lib/env";
import { formAction, type FormState } from "@/lib/form";
import { announceConversations, storeConversationFile, toastGuestMessage } from "@/lib/inbox";
import { currentTenant } from "@/lib/tenant";

/** A guest writes in the Guest Portal (ticket 42): the Portal Link is the only authority; an image or PDF up to 10 MB. */
export async function guestMessageAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await currentTenant();
    if (!t) throw new Error("Not found");
    const body = String(formData.get("body") ?? "");
    // the link first: nothing is stored for a link that opens nothing, or past the hourly limit
    const file = formData.get("file");
    const { propertyId } = await guestMayWrite(pool(), t.schemaName, key, file instanceof File && file.size > 0);
    const fileId = await storeConversationFile(t, formData, propertyId, PORTAL_USER);
    const post = await postGuestMessage(pool(), t.schemaName, key, { body, fileId }, { base: portalBaseUrl(t.slug) });
    await announceConversations(t.id, post.propertyId);
    await toastGuestMessage(t, { propertyId: post.propertyId, conversationId: post.conversationId, guestName: post.guestName, text: body });
    revalidatePath(`/g/${key}`);
    return { ok: true };
  });
}
