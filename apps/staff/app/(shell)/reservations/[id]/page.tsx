import { notFound } from "next/navigation";
import Link from "next/link";
import { formatDate } from "@hoteloftware/domain";
import { listRooms, reservationHistory } from "@hoteloftware/db";
import { RecordTab } from "@/shell/RecordTab";
import { pool } from "@/lib/db";
import { paymentProps, reservationView } from "@/lib/reservation-view";
import { requirePrincipal } from "@/lib/authorize";
import { fill } from "@/i18n/messages";
import { CheckInButton } from "../check-in-button";
import { FixedCharges } from "./fixed-charges";
import { CardHoldsPanel, PaymentsPanel } from "./payments-panel";
import { CheckOutPanel, InvoicesPanel } from "./invoices-panel";
import { FolioPanel } from "./folio-panel";
import { RegistrationStatus } from "./guest-details";
import { GuestDrawerButton } from "./guest-drawer-button";
import { ReservationActions } from "./reservation-actions";

/** One Reservation as a record tab: stay, guests, stored nightly prices, check-in and its folios. */
export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requirePrincipal();
  const { id } = await params;
  const v = await reservationView(id);
  if (!v) notFound();
  const { r, property, m, language, rights, today, names, fmt, money, guestName } = v;
  // calendar dates: format at noon UTC so no zone shifts the day
  const date = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), language, property.country, "UTC");
  const guestLinks = rights.guests;
  const folio = rights.folio;
  // notes may carry contact details; Revenue sees reservations without them (matrix)
  const notes = rights.contacts;
  const others = r.booking.reservationIds.filter((x) => x !== r.id);
  const manage = rights.manage;
  const [allHistory, rooms] = await Promise.all([reservationHistory(pool(), tenant.schemaName, r.id), listRooms(pool(), tenant.schemaName, r.propertyId)]);
  // cancellation fees are folio matters: without folio rights the history shows neither fee entries nor amounts
  const history = folio
    ? allHistory
    : allHistory
        .filter((h) => h.action !== "fee_confirmed" && h.action !== "fee_waived")
        .map((h) => ({ ...h, before: Object.fromEntries(Object.entries(h.before).filter(([k]) => k !== "fee")), after: Object.fromEntries(Object.entries(h.after).filter(([k]) => k !== "fee")) }));
  const typeCode = new Map(v.roomTypes.map((t) => [t.id, t.code]));
  const roomNumber = new Map(rooms.map((x) => [x.id, x.number]));
  const FIELDS: [string, (v: unknown) => string][] = [
    ["arrival", (v) => date(String(v))],
    ["departure", (v) => date(String(v))],
    ["adults", (v) => String(v)],
    ["childAges", (v) => (Array.isArray(v) && v.length ? v.join(", ") : "–")],
    ["roomTypeId", (v) => typeCode.get(String(v)) ?? "?"],
    ["total", (v) => money(Number(v))],
    ["rooms", (v) => (Array.isArray(v) && v.length ? (v as { roomId: string; from: string; to: string }[]).map((x) => `${roomNumber.get(x.roomId) ?? "?"} ${date(x.from)}–${date(x.to)}`).join(", ") : "–")],
    ["status", (v) => m[`res.status.${String(v)}` as keyof typeof m] ?? String(v)],
    ["fee", (v) => money(Number(v))],
    ["overbooked", () => m["res.overbooked"]],
    ["notes", (v) => (String(v) ? `“${String(v)}”` : "–")],
  ];
  // one readable line per side of a change: known fields in a fixed order
  const describe = (v: Record<string, unknown>) =>
    FIELDS.filter(([k]) => k in v)
      .map(([k, show]) => `${m[`res.field.${k}` as keyof typeof m] ?? k}: ${show(v[k])}`)
      .join(" · ");
  return (
    <div className="mx-auto grid max-w-5xl gap-6 p-6">
      <RecordTab module="reservations" recordId={r.id} title={`${r.booking.confirmationNumber} · ${guestName}`} href={`/reservations/${r.id}`} />
      <div>
        <h1 className="text-xl font-medium">
          {guestName} <span className="text-ink-60">· {r.booking.confirmationNumber}</span>
        </h1>
        <p className="text-sm text-ink-60">
          {m[`res.status.${r.status}`]} · {property.name}
          {r.overbooked ? <span className="ml-2 rounded-full bg-danger/15 px-2 text-xs text-danger">{m["res.overbooked"]}</span> : null}
        </p>
      </div>

      <section aria-label={m["res.stay"]} className="grid gap-1 rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="mb-1 font-medium">{m["res.stay"]}</h2>
        <p>
          {date(r.arrival)} – {date(r.departure)} · {fill(m["res.nights"], { n: String(r.nights.length) })}
        </p>
        <p>
          {r.roomType.code} · {r.roomType.name} · {r.ratePlan.name} ({m[`rates.mealPlan.${r.ratePlan.mealPlan}`]})
        </p>
        {r.status === "confirmed" && rights.checkIn && r.arrival <= today && today < r.departure ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CheckInButton reservationId={r.id} needsRoom={!r.assignments.some((a) => a.from <= today && a.to > today)} m={m} />
            <span className="text-xs text-ink-60">{m["res.checkInHelp"]}</span>
          </div>
        ) : null}
        {r.assignments.length ? <p>{r.assignments.map((a) => fill(m["res.roomSegment"], { room: a.roomName, from: date(a.from), to: date(a.to) })).join(" · ")}</p> : null}
        <p>
          {fill(m["res.occupancy"], { adults: String(r.adults) })}
          {r.childAges.length ? ` · ${fill(m["res.children"], { ages: r.childAges.join(", ") })}` : ""}
        </p>
      </section>

      <section aria-label={m["res.guests"]} className="grid gap-1 rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="mb-1 font-medium">{m["res.guests"]}</h2>
        <p>
          {m["res.primaryGuest"]}:{" "}
          {guestLinks ? (
            <Link href={`/guests/${r.primaryGuest.id}`} className="underline">
              {guestName}
            </Link>
          ) : (
            guestName
          )}
        </p>
        <p>
          {m["res.booker"]}:{" "}
          {r.booking.bookerCompanyId && rights.companies ? (
            <Link href={`/companies/${r.booking.bookerCompanyId}`} className="underline">
              {r.booking.bookerName}
            </Link>
          ) : (
            r.booking.bookerName
          )}
        </p>
        <p>
          {m["res.source"]}: {m[`res.source.${r.booking.source}`]}
          {r.booking.walkIn ? ` · ${m["res.walkIn"]}` : ""}
          {r.booking.rateCode ? ` · ${m["rates.rateCode"]} ${r.booking.rateCode}${r.booking.rateCodeCompanyName ? ` (${r.booking.rateCodeCompanyName})` : ""}` : ""}
        </p>
        {notes && r.booking.notes ? <p className="text-ink-80">{r.booking.notes}</p> : null}
        {others.length ? (
          <p>
            {m["res.otherRooms"]}:{" "}
            {others.map((o) => (
              <Link key={o} href={`/reservations/${o}`} className="mr-2 underline">
                {fill(m["res.room"], { n: String(r.booking.reservationIds.indexOf(o) + 1) })}
              </Link>
            ))}
          </p>
        ) : null}
      </section>

      {v.guest ? (
        <section aria-label={m["res.guestDetails"]} className="grid gap-2 rounded-2xl bg-surface-2 p-5 text-sm">
          <h2 className="font-medium">
            {m["res.guestDetails"]} · {guestName}
          </h2>
          <RegistrationStatus gaps={v.registration.gaps} m={m} />
          <GuestDrawerButton guest={{ id: v.guest.id, label: `${v.guest.lastName}, ${v.guest.firstName}` }} propertyCountry={property.country} m={m} />
        </section>
      ) : null}

      <section aria-label={m["res.prices"]} className="rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="mb-2 font-medium">{m["res.prices"]}</h2>
        <table className="w-full">
          <thead className="text-left text-ink-60">
            <tr>
              <th className="py-1 font-normal">{m["res.night"]}</th>
              <th className="py-1 font-normal">{m["res.components"]}</th>
              <th className="py-1 text-right font-normal">{m["grid.price"]}</th>
            </tr>
          </thead>
          <tbody>
            {r.nights.map((n) => (
              <tr key={n.date} className="border-t border-ink-5">
                <td className="py-1">{date(n.date)}</td>
                <td className="py-1 text-ink-80">
                  {n.components.map((c) => (c.kind === "room" ? `${m["res.roomShare"]} ${money(c.amount)}` : `${c.serviceCode} ${c.persons} × ${money(c.unitPrice)}`)).join(" · ")}
                </td>
                <td className="py-1 text-right">{money(n.total)}</td>
              </tr>
            ))}
            <tr className="border-t border-ink-10 font-medium">
              <td className="py-1" colSpan={2}>
                {m["res.total"]}
              </td>
              <td className="py-1 text-right">{money(r.total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-60">{m["res.pricesKept"]}</p>
      </section>

      {manage ? (
        <ReservationActions {...v.actionsProps} m={m} />
      ) : null}

      <section aria-label={m["res.history"]} className="rounded-2xl bg-surface-2 p-5 text-sm">
        <h2 className="mb-1 font-medium">{m["res.history"]}</h2>
        {history.length === 0 ? <p className="text-ink-60">{m["res.noHistory"]}</p> : null}
        <ul className="grid gap-2">
          {history.map((h, i) => (
            <li key={i}>
              <span className="text-ink-60">{fmt.format(h.at)}</span> · {names.get(h.userId) ?? h.userId} · <strong>{m[`res.action.${h.action}`]}</strong>
              <div className="text-ink-80">
                {m["res.before"]}: {describe(h.before)}
              </div>
              <div className="text-ink-80">
                {m["res.after"]}: {describe(h.after)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {folio ? (
        <FolioPanel {...v.folioProps} m={m} />
      ) : null}
      {folio ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <PaymentsPanel {...paymentProps(v)} folios={v.payments.folios} rights={{ take: rights.takePayments, refund: rights.refunds }} m={m} />
          <CardHoldsPanel {...paymentProps(v)} holds={v.payments.holds} balance={v.payments.guestBalance} canTake={rights.takePayments} m={m} />
        </div>
      ) : null}
      {folio ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <InvoicesPanel reservationId={r.id} invoices={v.invoices} openFolios={v.openFolios} canIssue={rights.issueInvoices} canCorrect={rights.correctInvoices} currency={v.currency} m={m} />
          {v.canCheckOut ? <CheckOutPanel reservationId={r.id} canOverride={rights.overrideCheckOut} currency={v.currency} m={m} /> : null}
        </div>
      ) : null}
      {folio ? (
        <details open={v.fixedCharges.length > 0} className="rounded-2xl bg-surface-2 p-5 text-sm">
          <summary className="cursor-pointer font-medium">{m["fixed.title"]}</summary>
          <div className="mt-3">
            <FixedCharges
              // new stay dates: the form's default range follows them
              key={`${r.arrival}|${r.departure}`}
              reservationId={r.id}
              arrival={r.arrival}
              departure={r.departure}
              items={v.fixedCharges}
              services={v.serviceOptions}
              rights={{ add: rights.post, remove: rights.manageFolios }}
              currency={v.currency}
              m={m}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
