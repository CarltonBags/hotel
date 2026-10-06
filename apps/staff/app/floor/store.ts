import { offlineStore } from "@/lib/offline-store";

/** What the phone keeps (ticket 35): the last user's day and the changes waiting to send. Client only. */
export const { save, load, update } = offlineStore("hs-floor");
