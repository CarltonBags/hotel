"use client";

import { useEffect } from "react";
import { lockDeviceAction } from "./actions";

/** On an enrolled Device: after this many idle minutes the session ends and the lock screen shows. */
export function IdleLock({ minutes }: { minutes: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void lockDeviceAction(), minutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [minutes]);
  return null;
}
