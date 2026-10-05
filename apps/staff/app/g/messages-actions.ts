"use server";

import { revalidatePath } from "next/cache";
import { PORTAL_USER, postGuestMessage, storeFile } from "@hoteloftware/db";
import { fileServices } from "@hoteloftware/storage";
import { pool } from "@/lib/db";
import { portalBaseUrl } from "@/lib/env";
import { formAction, type FormState } from "@/lib/form";
import { announceConversations, toastGuestMessage } from "@/lib/inbox";
import { currentTenant } from "@/lib/tenant";

/** A guest writes in the Guest Portal (ticket 42): the Portal Link is the only authority; an image or PDF up to 10 MB. */
export async function guestMessageAction(key: string, _prev: FormState, formData: FormData): Promise<FormState> {
  return formAction(async () => {
    const t = await currentTenant();
    if (!t) throw new Error("Not found");
    const body = String(formData.get("body") ?? "");
    const file = formData.get("file");
    const fileId =
      file instanceof File && file.size > 0
        ? await storeFile(pool(), t.schemaName, fileServices(), { tenantId: t.id, kind: "conversation_file", bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, propertyId: null, userId: PORTAL_USER })
        : null;
    const post = await postGuestMessage(pool(), t.schemaName, key, { body, fileId }, { base: portalBaseUrl(t.slug) });
    await announceConversations(t.id, post.propertyId);
    await toastGuestMessage(t, { propertyId: post.propertyId, conversationId: post.conversationId, guestName: post.guestName, text: body });
    revalidatePath(`/g/${key}`);
    return { ok: true };
  });
}
