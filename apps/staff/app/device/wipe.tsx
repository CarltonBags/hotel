"use client";

import { useEffect } from "react";

/** A revoked Device wipes what this app stored in the browser. It keeps the revoked token, so it keeps showing the notice. */
export function Wipe() {
  useEffect(() => {
    void (async () => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
        if (indexedDB.databases) for (const db of await indexedDB.databases()) if (db.name) indexedDB.deleteDatabase(db.name);
      } catch {
        // storage may be blocked; nothing else to wipe then
      }
    })();
  }, []);
  return null;
}
