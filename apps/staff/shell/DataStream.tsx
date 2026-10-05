"use client";

import { useEffect } from "react";
import { isDataChange } from "@hoteloftware/domain";
import { announceData, openEventStream } from "./event-stream";

/** Live data changes for a screen outside the shell (the outlet app, ticket 64): no toasts, only LiveRefresh. */
export function DataStream() {
  useEffect(() => openEventStream({ onNotification: (n) => (isDataChange(n.kind) ? announceData(n) : undefined) }), []);
  return null;
}
