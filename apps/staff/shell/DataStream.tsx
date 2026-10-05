"use client";

import { useEffect, useRef, useState } from "react";
import { isDataChange } from "@hoteloftware/domain";
import { WORKER_URL, announceData, openEventStream } from "./event-stream";

/** Live data changes for a screen outside the shell (the outlet app, ticket 64): no toasts, only LiveRefresh; says so while live updates are off. */
export function DataStream({ offlineText }: { offlineText: string }) {
  const [offline, setOffline] = useState(false);
  const lastId = useRef<string | null>(null);
  useEffect(() => openEventStream({ onNotification: (n) => (isDataChange(n.kind) ? announceData(n) : undefined), onState: (online) => setOffline(!online), lastId }), []);
  return offline && WORKER_URL ? (
    <p className="text-xs text-ink-60" role="status" data-live-off>
      {offlineText}
    </p>
  ) : null;
}
