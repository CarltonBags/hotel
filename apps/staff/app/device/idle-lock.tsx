"use client";

import { useEffect } from "react";
import { lockDeviceAction, stillHereAction } from "./actions";

/** On an enrolled Device: after this many idle minutes the session ends and the lock screen shows. */
export function IdleLock({ minutes }: { minutes: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let told = Date.now();
    const reset = () => {
      clearTimeout(timer);
      // the server ends an idle session on its own; tell it about use at most every 30 seconds
      if (Date.now() - told > 30_000) {
        told = Date.now();
        void stillHereAction();
      }
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
