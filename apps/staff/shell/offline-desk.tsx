"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EmergencyReport } from "@hoteloftware/db";
import { DOWNTIME_LISTS, EMERGENCY_REFRESH_MINUTES, ageMinutes, downtimeReminderDue } from "@hoteloftware/domain";
import { DowntimeLists, type DowntimeText } from "@/components/downtime-lists";

/**
 * The desk without connection (ticket 86). While online the browser keeps
 * the latest lists and the emergency report, encrypted with a key it gets
 * only signed in and holds in memory; one copy, replaced each time. When
 * the service stops answering, a banner with the time lost and the lists'
 * age covers the app: read only, no changes until back online. Also shows
 * the shift reminder to print the Downtime Reports.
 */
const DB = "hs-downtime";
const SLOT = "latest";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("data");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function put(value: unknown): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(value, SLOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function get<T>(): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("data", "readonly").objectStore("data").get(SLOT);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
/** Signed out or no longer allowed: the copy goes. */
export async function wipeDowntimeCopy(): Promise<void> {
  try {
    await put(null);
  } catch {
    // nothing kept
  }
}

type Kept = { userId: string; savedAt: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };
type Snapshot = { key: string; userId: string; report: EmergencyReport };

export function OfflineDesk({ text, labels, propertyId, reminderAt, timeZone }: { text: DowntimeText; labels: Record<"banner" | "since" | "age" | "disabled" | "none" | "reminder" | "print", string>; propertyId: string; reminderAt: string | null; timeZone: string }) {
  const key = useRef<CryptoKey | null>(null);
  const userId = useRef<string | null>(null);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);
  const [copy, setCopy] = useState<{ report: EmergencyReport; savedAt: string } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [reminder, setReminder] = useState(false);

  // refresh the kept copy: on load, every 2 hours, and when the tab comes back after that
  const refresh = useCallback(async () => {
    const res = await fetch("/api/downtime/snapshot", { cache: "no-store" });
    if (res.status === 204 || res.status === 401) return wipeDowntimeCopy();
    if (!res.ok) return;
    const snap = (await res.json()) as Snapshot;
    const raw = Uint8Array.from(atob(snap.key), (c) => c.charCodeAt(0));
    key.current = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    userId.current = snap.userId;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const savedAt = new Date().toISOString();
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key.current, new TextEncoder().encode(JSON.stringify(snap.report)));
    await put({ userId: snap.userId, savedAt, iv, data } satisfies Kept);
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
    const t = setInterval(() => refresh().catch(() => undefined), EMERGENCY_REFRESH_MINUTES * 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  // the heartbeat: the browser's own offline signal, and a ping every 20 seconds
  useEffect(() => {
    const down = () => setOfflineSince((s) => s ?? new Date());
    const up = () => setOfflineSince(null);
    const beat = async () => {
      try {
        const r = await fetch("/api/downtime/ping", { cache: "no-store" });
        if (r.ok) up();
        else down();
      } catch {
        down();
      }
    };
    window.addEventListener("offline", down);
    window.addEventListener("online", beat);
    const t = setInterval(beat, 20_000);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", beat);
      clearInterval(t);
    };
  }, []);

  // offline: open the kept copy with the key held since sign-in
  useEffect(() => {
    if (!offlineSince) return;
    (async () => {
      const kept = await get<Kept | null>();
      if (!kept || !key.current || kept.userId !== userId.current) return;
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: kept.iv }, key.current, kept.data);
      setCopy({ report: JSON.parse(new TextDecoder().decode(plain)) as EmergencyReport, savedAt: kept.savedAt });
    })().catch(() => setCopy(null));
  }, [offlineSince]);

  // the clock for the age, and the shift reminder
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d);
      const local = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
      let printed = false;
      try {
        printed = localStorage.getItem(`hs-downtime-printed:${propertyId}`) === today;
      } catch {
        // without storage the reminder simply shows
      }
      setReminder(downtimeReminderDue(reminderAt, local, printed));
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [propertyId, reminderAt, timeZone]);

  const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (offlineSince) {
    return (
      <div role="alertdialog" aria-modal="true" data-offline className="fixed inset-0 z-50 overflow-auto bg-canvas p-4">
        <div className="sticky top-0 mb-4 rounded-2xl bg-danger px-4 py-3 text-sm text-white" data-offline-banner>
          <strong>{labels.banner}</strong> · {labels.since.replace("{time}", time(offlineSince))}
          {copy ? ` · ${labels.age.replace("{time}", time(new Date(copy.savedAt))).replace("{n}", String(ageMinutes(copy.savedAt, now)))}` : ""}
          <div className="mt-1 opacity-90">{labels.disabled}</div>
        </div>
        {copy ? <DowntimeLists set={copy.report} lists={DOWNTIME_LISTS.filter((l) => l !== "registration_forms")} m={text} emergency /> : <p className="text-ink-60">{labels.none}</p>}
      </div>
    );
  }
  return reminder ? (
    <div role="status" data-downtime-reminder className="fixed bottom-4 right-4 z-40 rounded-2xl bg-surface px-4 py-3 text-sm shadow-card print:hidden">
      {labels.reminder}{" "}
      <a href="/downtime" className="font-medium text-accent underline">
        {labels.print}
      </a>
    </div>
  ) : null;
}
