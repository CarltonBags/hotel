"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SelfCheckinLine as Line } from "@hoteloftware/db";
import type { Messages } from "@/i18n/messages";

/**
 * The desk's live line of Self Check-in (ticket 49): who is checking in on a
 * kiosk or a phone and at which step, then how it ended — completed with the
 * room, waiting for the room, or needing help and why. Hidden while empty.
 */
export function SelfCheckinLine({ propertyId, m }: { propertyId: string; m: Messages }) {
  const [line, setLine] = useState<Line[]>([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await fetch(`/api/self-checkin?property=${encodeURIComponent(propertyId)}`, { cache: "no-store" }).catch(() => null);
      if (live && r?.ok) setLine(((await r.json()) as { line: Line[] }).line);
    };
    void load();
    const i = setInterval(() => void load(), 5000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [propertyId]);
  if (!line.length) return null;
  return (
    <section aria-label={m["sci.title"]} className="mb-3 rounded-2xl bg-surface-2 p-3" data-self-checkin-line>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-60">{m["sci.title"]}</h2>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {line.map((l) => (
          <li key={l.id} data-line={l.outcome ?? l.step} className={`rounded-xl px-3 py-2 ${l.outcome === "help" ? "bg-danger/10" : l.outcome === "waiting" ? "bg-warning/15" : l.outcome === "checked_in" ? "bg-success/10" : "bg-surface"}`}>
            <Link href={`/?r=${l.reservationId}`} className="font-medium hover:underline">
              {l.guestName}
            </Link>{" "}
            <span className="text-ink-60">
              · {m[`sci.channel.${l.channel}`]} ·{" "}
              {l.outcome === "checked_in"
                ? `${m["sci.done"]} · ${m["sci.room"]} ${l.roomNumber ?? "?"}`
                : l.outcome === "waiting"
                  ? m["sci.waiting"]
                  : l.outcome === "help"
                    ? `${m["sci.help"]}: ${l.reason.map((c) => m[`sci.reason.${c}`]).join(", ") || m["sci.reason.other"]}`
                    : m[`sci.step.${l.step}`]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
