"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { DataKind } from "@hoteloftware/domain";

/** Event the notification stream dispatches for data changes (kind "data.<what>", detail.propertyId). */
export const DATA_EVENT = "hs:data";

/**
 * Re-renders the page from the server when data of a kind changes at one of
 * the given properties; changes close together refresh once.
 */
export function LiveRefresh({ kind, propertyIds }: { kind: DataKind; propertyIds: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watched = propertyIds.join("|");
  useEffect(() => {
    const ids = new Set(watched.split("|"));
    const onData = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: string; propertyId: string }>).detail;
      if (detail.kind !== kind || !ids.has(detail.propertyId)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    window.addEventListener(DATA_EVENT, onData);
    return () => {
      window.removeEventListener(DATA_EVENT, onData);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [kind, watched, router]);
  return null;
}
