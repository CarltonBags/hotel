"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a guest is on the tablet the desk sees their progress live: the page refreshes every 2 seconds. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
