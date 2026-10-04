"use client";

import Link from "next/link";
import { useState } from "react";
import type { ArrivalDecision } from "@hoteloftware/domain";
import type { MissingArrival } from "@hoteloftware/db";
import { fill, type Messages } from "@/i18n/messages";
import { useFormAction } from "../reservations/use-form-action";
import { closeAuditAction, saveDecisionAction } from "./actions";

const button = "h-9 rounded-full px-4 text-sm font-medium";
const choice = (on: boolean) => `${button} border ${on ? "border-accent bg-accent/15" : "border-ink-10 bg-surface hover:bg-ink-5"}`;

/** Step 1 (decide each missing arrival, saved at once) and the close. */
export function AuditSteps({
  propertyId,
  businessDate,
  businessDateLabel,
  open,
  arrivals,
  decisions,
  blockedByDepartures,
  m,
}: {
  propertyId: string;
  businessDate: string;
  businessDateLabel: string;
  open: boolean;
  arrivals: (MissingArrival & { feeLabel: string })[];
  decisions: Record<string, ArrivalDecision>;
  blockedByDepartures: boolean;
  m: Messages;
}) {
  const { pending, run, note } = useFormAction(m);
  const [reasons, setReasons] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(decisions).map(([id, d]) => [id, d.kind === "no_show" && d.fee === "waive" ? (d.waiveReason ?? "") : ""])),
  );
  const decide = (id: string, d: ArrivalDecision | null) => run(() => saveDecisionAction(propertyId, id, d));
  const undecided = arrivals.filter((a) => {
    const d = decisions[a.reservationId];
    return !d || (d.kind === "no_show" && d.fee === "waive" && !d.waiveReason?.trim());
  });
  return (
    <>
      <section aria-label={m["na.step1"]} className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="font-medium">{m["na.step1"]}</h2>
        <p className="text-xs text-ink-60">{m["na.step1Help"]}</p>
        {note}
        {arrivals.length === 0 ? <p className="text-ink-60">{m["na.none"]}</p> : null}
        <ul className="grid gap-2">
          {arrivals.map((a) => {
            const d = decisions[a.reservationId];
            const noShow = d?.kind === "no_show";
            return (
              <li key={a.reservationId} data-arrival={a.reservationId} className="grid gap-2 rounded-xl bg-surface p-3">
                <div>
                  <Link href={`/reservations/${a.reservationId}`} className="font-medium underline">
                    {[a.confirmationNumber, a.roomNumber, a.guestName].filter(Boolean).join(" · ")}
                  </Link>
                  <span className="text-ink-60">
                    {" "}
                    · {a.arrival} – {a.departure}
                    {a.lateArrival ? ` · ${m["na.wasLate"]}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={pending} onClick={() => decide(a.reservationId, { kind: "no_show", fee: "confirm" })} className={choice(noShow && d.fee === "confirm")}>
                    {m["na.noShow"]} · {a.feeLabel}
                  </button>
                  {a.noShowFee > 0 ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide(a.reservationId, { kind: "no_show", fee: "waive", waiveReason: reasons[a.reservationId] ?? "" })}
                      className={choice(noShow && d.fee === "waive")}
                    >
                      {m["na.noShow"]} · {m["na.waive"]}
                    </button>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => decide(a.reservationId, { kind: "late_arrival" })} className={choice(d?.kind === "late_arrival")}>
                    {m["na.late"]}
                  </button>
                  {d ? (
                    <button type="button" disabled={pending} onClick={() => decide(a.reservationId, null)} className="text-xs text-ink-60 underline">
                      {m["na.undecided"]}
                    </button>
                  ) : null}
                </div>
                {noShow && d.fee === "waive" ? (
                  <label className="grid gap-1 text-xs text-ink-60">
                    {m["na.waiveReason"]}
                    <input
                      value={reasons[a.reservationId] ?? ""}
                      onChange={(e) => setReasons({ ...reasons, [a.reservationId]: e.target.value })}
                      onBlur={() => decide(a.reservationId, { kind: "no_show", fee: "waive", waiveReason: reasons[a.reservationId] ?? "" })}
                      maxLength={300}
                      className="h-9 rounded-xl border border-ink-10 bg-surface-2 px-3 text-sm text-ink"
                    />
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !open || undecided.length > 0 || blockedByDepartures}
          onClick={() => {
            if (window.confirm(fill(m["na.closeConfirm"], { date: businessDateLabel }))) run(() => closeAuditAction(propertyId));
          }}
          data-close={businessDate}
          className={`${button} bg-accent text-white disabled:opacity-50`}
        >
          {fill(m["na.close"], { date: businessDateLabel })}
        </button>
      </div>
    </>
  );
}
