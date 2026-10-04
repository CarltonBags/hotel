import type { Pool } from "pg";
import { priceOverrideCheck, roundMoney } from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { useApproval } from "./approvals";
import { syncStayCharges } from "./folios";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

/**
 * Price Override (ticket 31): change the price of a reservation's nights
 * with a reason. The night's included Services keep their price and the room
 * part takes the rest; complimentary (price 0) makes the whole night free.
 * Below the room type's Price Floor, and complimentary, need a Property
 * Manager: their own right, or their Approval. A checked-in stay's Charges
 * follow at once; an invoiced night is not changed.
 */
export async function overrideNightPrices(
  pool: Pool,
  schema: string,
  reservationId: string,
  input: { nights: { date: string; price: number }[]; reason: string },
  actor: { userId: string; canApprove: boolean; approverId?: string | null },
): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("A Price Override needs a reason");
  if (input.nights.length === 0) throw new Error("Change at least one night");
  const nights = input.nights.map((n) => {
    checkDate(n.date);
    if (!Number.isFinite(n.price) || n.price < 0 || roundMoney(n.price) !== n.price) throw new Error("A price is an amount with at most two decimals, not negative");
    return n;
  });
  if (new Set(nights.map((n) => n.date)).size !== nights.length) throw new Error("Each night once");
  await withTenant(pool, schema, async (tx) => {
    const owner = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!owner) throw new Error("Reservation not found");
    await lockProperty(tx, owner.property_id);
    const r = (await tx.query<{ id: string; property_id: string; status: string; arrival: string; departure: string; confirmation_number: string; price_floor: string | null; currency: string; business_date: string }>(
      `select r.id, r.property_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, b.confirmation_number, t.price_floor, p.currency,
         to_char(p.business_date, 'YYYY-MM-DD') as business_date
       from reservations r join bookings b on b.id = r.booking_id join room_types t on t.id = r.room_type_id join properties p on p.id = r.property_id
       where r.id = $1 for update of r`,
      [reservationId],
    )).rows[0]!;
    if (r.status !== "confirmed" && r.status !== "checked_in") throw new Error(`The reservation is ${r.status.replace("_", " ")}; its prices cannot change`);
    if (nights.some((n) => n.date < r.arrival || n.date >= r.departure)) throw new Error("A night is not part of the stay");
    // a checked-in guest's slept nights keep their Charges (corrected by voiding or posting), so their price stays as posted
    if (r.status === "checked_in" && nights.some((n) => n.date < r.business_date)) throw new Error("A night already slept keeps its price; correct its Charges on the folio instead");
    const invoiced = (await tx.query<{ date: string }>(
      "select distinct to_char(service_date, 'YYYY-MM-DD') as date from charges where reservation_id = $1 and origin = 'stay' and invoice_id is not null and voided_at is null and service_date = any($2::date[])",
      [r.id, nights.map((n) => n.date)],
    )).rows;
    if (invoiced.length) throw new Error(`The night of ${invoiced[0]!.date} is invoiced; correct it with a Cancellation Invoice first`);
    const components = (await tx.query<{ id: string; date: string; kind: "room" | "service"; amount: string }>(
      "select id, to_char(date, 'YYYY-MM-DD') as date, kind, amount from reservation_night_components where reservation_id = $1 and date = any($2::date[])",
      [r.id, nights.map((n) => n.date)],
    )).rows;
    const before = (await tx.query<{ date: string; total: string }>("select to_char(date, 'YYYY-MM-DD') as date, total from reservation_nights where reservation_id = $1 and date = any($2::date[]) order by date", [r.id, nights.map((n) => n.date)])).rows;

    const floor = r.price_floor === null ? null : Number(r.price_floor);
    const check = priceOverrideCheck(nights, floor);
    let approvedBy: string | null = null;
    if (!actor.canApprove && (check.complimentary.length || check.belowFloor.length)) {
      const fmt = (ns: typeof nights) => ns.map((n) => `${n.date} ${n.price.toFixed(2)}`).join(", ");
      const sorted = [...nights].sort((a, b) => (a.date < b.date ? -1 : 1));
      approvedBy = await useApproval(
        tx,
        {
          kind: check.complimentary.length ? "complimentary" : "price_below_floor",
          propertyId: r.property_id,
          // the Approval is for these prices on these nights of this reservation
          key: `${r.id}:${sorted.map((n) => `${n.date}=${n.price.toFixed(2)}`).join(",")}`,
          summary: check.complimentary.length
            ? `Complimentary night for ${r.confirmation_number} (${fmt(sorted)})`
            : `Price below the floor of ${floor!.toFixed(2)} ${r.currency.trim()} for ${r.confirmation_number} (${fmt(sorted)})`,
          recordId: r.id,
        },
        actor,
      );
    }

    for (const n of nights) {
      const nightComponents = components.filter((c) => c.date === n.date);
      const services = roundMoney(nightComponents.filter((c) => c.kind === "service").reduce((s, c) => s + Number(c.amount), 0));
      if (n.price > 0 && !nightComponents.some((c) => c.kind === "room")) throw new Error(`The night of ${n.date} has no room price to change`);
      if (n.price > 0 && n.price < services) throw new Error(`The night of ${n.date} includes Services worth ${services.toFixed(2)}; its price cannot be lower (or make it complimentary)`);
      if (n.price === 0) {
        await tx.query("update reservation_night_components set amount = 0, unit_price = 0 where reservation_id = $1 and date = $2", [r.id, n.date]);
      } else {
        await tx.query("update reservation_night_components set amount = $3, unit_price = $3 where reservation_id = $1 and date = $2 and kind = 'room'", [r.id, n.date, roundMoney(n.price - services)]);
      }
      await tx.query("update reservation_nights set total = $3 where reservation_id = $1 and date = $2", [r.id, n.date, n.price]);
    }
    await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after, approved_by) values ($1, $2, 'price_override', $3, $4, $5)", [
      r.id,
      actor.userId,
      JSON.stringify({ nights: before.map((b) => ({ date: b.date, price: Number(b.total) })) }),
      JSON.stringify({ nights: nights.map((n) => ({ date: n.date, price: n.price })), reason, ...(check.complimentary.length ? { complimentary: check.complimentary } : {}) }),
      approvedBy,
    ]);
    // a stay in house: its Charges follow the new prices
    await syncStayCharges(tx, r.id, actor.userId, false);
  });
}
