"use client";

import { useEffect, useState } from "react";

/** The line above the rates grid: what waits for the channels, refreshed every 20 seconds while the grid is open (ticket 37). */
export function ChannelStatusLine({ propertyId, language, timeZone, initial }: { propertyId: string; language: string; timeZone: string; initial: { text: string; failing: boolean; pending: number; error: string | null } }) {
  const [s, setS] = useState(initial);
  useEffect(() => {
    const load = () =>
      fetch(`/api/channels/status?property=${encodeURIComponent(propertyId)}&lang=${language}&tz=${encodeURIComponent(timeZone)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((x) => x?.text && setS(x))
        .catch(() => undefined);
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [propertyId, language, timeZone]);
  return (
    <p className={`px-6 pt-3 text-xs ${s.failing ? "text-red-700" : "text-ink-60"}`} data-channel-status={s.failing ? "failing" : s.pending ? "sending" : "up_to_date"} title={s.error ?? undefined}>
      {s.text}
    </p>
  );
}
