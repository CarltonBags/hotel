import { notFound } from "next/navigation";
import Link from "next/link";
import { can, canAtAnyProperty, formatCurrency, formatDate } from "@hoteloftware/domain";
import { findProperty, findReservation, listRatePlans, listRoomTypes, listRooms, listTenantUsers, reservationHistory } from "@hoteloftware/db";
import { RecordTab } from "@/shell/RecordTab";
import { requireAllowed, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { loadShell } from "@/lib/shell";
import { fill } from "@/i18n/messages";
import { ReservationActions } from "./reservation-actions";

/** One Reservation as a record tab: stay, guests, stored nightly prices, folio placeholder. */
export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requirePrincipal();
  const { id } = await params;
  const r = await findReservation(pool(), tenant.schemaName, id);
  if (!r) notFound();
  const { actor } = await requireAllowed("view_reservations", r.propertyId);
  const { messages: m, language } = await loadShell();
  const property = (await findProperty(pool(), tenant.schemaName, r.propertyId))!;
  const money = (v: number) => formatCurrency(v, property.currency, language, property.country);
  // calendar dates: format at noon UTC so no zone shifts the day
  const date = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), language, property.country, "UTC");
  const guestLinks = canAtAnyProperty(actor, "view_guests");
  const folio = can(actor, "view_folio", r.propertyId);
  // notes may carry contact details; Revenue sees reservations without them (matrix)
  const notes = can(actor, "view_guest_contacts", r.propertyId);
  const guestName = `${r.primaryGuest.firstName} ${r.primaryGuest.lastName}`.trim();
  const others = r.booking.reservationIds.filter((x) => x !== r.id);
  const manage = can(actor, "manage_reservations", r.propertyId);
  const [allHistory, users, roomTypes, plans, rooms] = await Promise.all([
    reservationHistory(pool(), tenant.schemaName, r.id),
    listTenantUsers(pool(), tenant.id),
    listRoomTypes(pool(), tenant.schemaName, r.propertyId),
    manage ? listRatePlans(pool(), tenant.schemaName, r.propertyId, { includeInactive: true }) : Promise.resolve([]),
    listRooms(pool(), tenant.schemaName, r.propertyId),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  // cancellation fees are folio matters: without folio rights the history shows neither fee entries nor amounts
  const history = folio
    ? allHistory
    : allHistory
        .filter((h) => h.action !== "fee_confirmed" && h.action !== "fee_waived")
        .map((h) => ({ ...h, before: Object.fromEntries(Object.entries(h.before).filter(([k]) => k !== "fee")), after: Object.fromEntries(Object.entries(h.after).filter(([k]) => k !== "fee")) }));
  const plan = plans.find((p) => p.id === r.ratePlan.id);
  const fmt = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: property.timeZone });
  const typeCode = new Map(roomTypes.map((t) => [t.id, t.code]));
  const roomNumber = new Map(rooms.map((x) => [x.id, x.number]));
  const FIELDS: [string, (v: unknown) => string][] = [
    ["arrival", (v) => date(String(v))],
    ["departure", (v) => date(String(v))],
    ["adults", (v) => String(v)],
    ["childAges", (v) => (Array.isArray(v) && v.length ? v.join(", ") : "–")],
    ["roomTypeId", (v) => typeCode.get(String(v)) ?? "?"],
    ["total", (v) => money(Number(v))],
    ["rooms", (v) => (Array.isArray(v) && v.length ? (v as { roomId: string; from: string; to: string }[]).map((x) => `${roomNumber.get(x.roomId) ?? "?"} ${date(x.from)}–${date(x.to)}`).join(", ") : "–")],
    ["status", (v) => String(v)],
    ["fee", (v) => money(Number(v))],
    ["overbooked", () => m["res.overbooked"]],
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
          {r.booking.bookerCompanyId && canAtAnyProperty(actor, "view_companies") ? (
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
        <ReservationActions
          reservation={{
            id: r.id,
            status: r.status,
            arrival: r.arrival,
            departure: r.departure,
            adults: r.adults,
            childAges: r.childAges,
            roomTypeId: r.roomType.id,
            nights: r.nights.map((n) => n.date),
            assignments: r.assignments,
            cancellationFee: r.cancellationFee,
            cancellationFeeStatus: r.cancellationFeeStatus,
            openInBooking: r.booking.openReservations,
          }}
          roomTypes={roomTypes.filter((t) => plan?.roomTypeIds.includes(t.id) ?? t.id === r.roomType.id).map((t) => ({ id: t.id, label: `${t.code} · ${t.name}` }))}
          currency={{ code: property.currency, language, country: property.country }}
          m={m}
        />
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
        <section aria-label={m["res.folio"]} className="rounded-2xl border border-dashed border-ink-10 p-5 text-sm text-ink-60">
          <h2 className="mb-1 font-medium text-ink">{m["res.folio"]}</h2>
          {m["res.folioSoon"]}
        </section>
      ) : null}
    </div>
  );
}
