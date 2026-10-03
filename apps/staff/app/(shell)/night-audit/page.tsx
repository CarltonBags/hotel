import Link from "next/link";
import { can, formatCurrency } from "@hoteloftware/domain";
import { nightAuditView } from "@hoteloftware/db";
import { requireAllowed } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { AuditSteps } from "./audit-steps";

/** The Night Audit of the property selected in the navbar (ticket 32): decide, review, close. */
export default async function NightAuditPage() {
  const shell = await loadShell();
  const { messages: m, language } = shell;
  const property = shell.properties.find((p) => p.id === shell.scope);
  if (!property) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-medium">{m["module.night_audit"]}</h1>
        <p className="mt-2 text-ink-60">{m["lists.pickProperty"]}</p>
      </div>
    );
  }
  const { tenant, actor } = await requireAllowed("run_night_audit", property.id);
  const view = await nightAuditView(pool(), tenant.schemaName, property.id);
  const day = (d: string) => new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  const when = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: property.timeZone });
  const section = "grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm";
  const stayLink = (s: { reservationId: string; confirmationNumber: string; guestName: string; roomNumber?: string | null }) => (
    <Link href={`/reservations/${s.reservationId}`} className="underline">
      {[s.confirmationNumber, s.roomNumber, s.guestName].filter(Boolean).join(" · ")}
    </Link>
  );
  const w = view.warnings;
  return (
    <div className="mx-auto grid max-w-4xl gap-4 p-6">
      <div>
        <h1 className="text-xl font-medium">
          {m["module.night_audit"]} <span className="text-ink-60">· {property.name}</span>
        </h1>
        <p className="text-lg">{fill(m["na.businessDate"], { date: day(view.businessDate) })}</p>
        <p className="text-sm text-ink-60">{m["na.help"]}</p>
        {view.behind > 0 ? <p className="mt-2 rounded-xl bg-warning/10 p-3 text-sm">{fill(m["na.behind"], { n: String(view.behind) })}</p> : null}
        {view.overdue ? <p className="mt-2 rounded-xl bg-danger/10 p-3 text-sm">{fill(m["na.overdue"], { date: day(view.businessDate) })}</p> : null}
        {!view.open ? <p className="mt-2 text-sm text-ink-60">{fill(m["na.notOpen"], { time: view.windowFrom })}</p> : null}
        {can(actor, "view_night_audit_reports", property.id) ? (
          <Link href="/night-audit/reports" className="mt-1 inline-block text-sm underline">
            {m["na.reports"]}
          </Link>
        ) : null}
      </div>

      <AuditSteps
        propertyId={property.id}
        businessDate={view.businessDate}
        businessDateLabel={day(view.businessDate)}
        open={view.open}
        arrivals={view.missingArrivals.map((a) => ({ ...a, feeLabel: a.noShowFee > 0 ? fill(m["na.confirmFee"], { amount: money(a.noShowFee) }) : m["na.noFee"] }))}
        decisions={view.decisions}
        blockedByDepartures={view.overdueDepartures.length > 0}
        m={m}
      />

      <section aria-label={m["na.step2"]} className={section}>
        <h2 className="font-medium">{m["na.step2"]}</h2>
        <p className="text-xs text-ink-60">{m["na.step2Help"]}</p>
        {view.overdueDepartures.length === 0 ? <p className="text-ink-60">{m["na.none"]}</p> : null}
        <ul className="grid gap-1">
          {view.overdueDepartures.map((d) => (
            <li key={d.reservationId} data-departure={d.reservationId} className="rounded-xl bg-surface px-3 py-2">
              {stayLink(d)} · {d.departure}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={m["na.step3"]} className={section}>
        <h2 className="font-medium">{m["na.step3"]}</h2>
        <p className="text-xs text-ink-60">{m["na.step3Help"]}</p>
        {(
          [
            ["na.openBalances", w.openBalances.map((x) => ({ ...x, extra: money(x.balance) }))],
            ["na.expiringHolds", w.expiringHolds.map((x) => ({ ...x, extra: `${money(x.amount)} · ${when.format(new Date(x.expiresAt))}` }))],
            ["na.registrations", w.incompleteRegistrations.map((x) => ({ ...x, extra: x.missing.join(", ") }))],
            ["na.withoutRoom", w.arrivalsWithoutRoom.map((x) => ({ ...x, extra: "" }))],
          ] as const
        ).map(([key, rows]) => (
          <div key={key} data-warning={key}>
            <h3 className="text-ink-80">
              {m[key]} ({rows.length})
            </h3>
            <ul className="grid gap-0.5">
              {rows.map((x) => (
                <li key={x.reservationId} className="flex gap-2">
                  {stayLink(x)}
                  {x.extra ? <span className="text-ink-60">· {x.extra}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
