import type { Pool } from "pg";
import { can } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { addBillItem, chargeBillToRoom, openOutletBill, outletFloor, outletSetup, payOutletBillCash, removeBillLine, sendOrderRound, type MenuItem, type OpenBill, type Outlet, type OutletPrinter } from "./outlets";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * Selling without a connection (ticket 62): the outlet's device keeps the
 * menu, tables, open bills and the in-house list of the last sync; orders,
 * bills, cash payments and Room Charges within that list's limits go on
 * offline, kept on the device as operations, each with its own id and the
 * time it happened. Back online the device sends them, in order; each is
 * applied once, the Receipts of cash payments carry the time they were
 * issued, and the TSE signs the orders and Receipts afterwards. A Room
 * Charge that no longer holds when checked (the guest left, the limit is
 * used) stays open with the problem for staff to settle.
 */

export interface OutletSnapshot {
  outlet: Outlet;
  menu: MenuItem[];
  tables: { id: string; name: string }[];
  printers: OutletPrinter[];
  openBills: OpenBill[];
  /** Guests the device may charge offline: on this list, within what was left tonight when it was taken. */
  inHouse: { reservationId: string; room: string | null; lastName: string; remaining: number }[];
  currency: string;
  country: string;
  syncedAt: string;
}

/** What the device keeps for selling offline, taken while it is online. */
export async function outletSnapshot(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<OutletSnapshot> {
  const [setup, floor] = await Promise.all([outletSetup(pool, schema, outletId, viewer), outletFloor(pool, schema, outletId, viewer)]);
  const inHouse = can(viewer.actor, "outlet_cash", setup.outlet.propertyId)
    ? await withTenant(pool, schema, async (tx) =>
        (await tx.query<{ id: string; room: string | null; last_name: string; remaining: string }>(
          `select r.id, g.last_name,
             (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= p.business_date and a.to_date > p.business_date limit 1) as room,
             greatest(0, p.spending_limit - (select coalesce(sum(ch.amount), 0) from charges ch where ch.reservation_id = r.id and ch.origin = 'outlet' and ch.voided_at is null and ch.service_date = p.business_date)) as remaining
           from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
           where r.property_id = $1 and r.status = 'checked_in' and not r.room_charge_blocked
             and (exists (select 1 from card_holds h where h.reservation_id = r.id and h.status = 'active')
                  or exists (select 1 from card_guarantees c where c.reservation_id = r.id and c.status = 'secured')
                  or exists (select 1 from folios f join companies co on co.id = f.bill_to_company_id where f.reservation_id = r.id and co.on_account))
           order by g.last_name limit 1000`,
          [setup.outlet.propertyId],
        )).rows.map((r) => ({ reservationId: r.id, room: r.room, lastName: r.last_name, remaining: Number(r.remaining) })),
      )
    : [];
  return {
    outlet: setup.outlet,
    menu: setup.menu.filter((i) => i.active),
    tables: setup.tables.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name })),
    printers: setup.printers.filter((p) => p.active),
    openBills: [...floor.tables.flatMap((t) => t.bills), ...floor.loose],
    inHouse,
    ...(await withTenant(pool, schema, async (tx) => {
      const p = (await tx.query<{ currency: string; country: string }>("select currency, country from properties where id = $1", [setup.outlet.propertyId])).rows[0]!;
      return { currency: p.currency.trim(), country: p.country.trim() };
    })),
    syncedAt: new Date().toISOString(),
  };
}

export type OutletOp =
  | { opId: string; at: string; kind: "open_bill"; billId: string; tableId: string | null; label: string }
  | { opId: string; at: string; kind: "add_item"; billId: string; lineId: string; menuItemId: string; quantity: number; modifiers: string[]; note: string }
  | { opId: string; at: string; kind: "remove_line"; billId: string; lineId: string }
  | { opId: string; at: string; kind: "send_round"; billId: string; roundId: string; lineIds: string[] }
  | { opId: string; at: string; kind: "pay_cash"; billId: string; customerName: string }
  | { opId: string; at: string; kind: "room_charge"; billId: string; reservationId: string; signature: string | null };

export interface OpResult {
  opId: string;
  ok: boolean;
  /** Applied before (sent twice): nothing done again. */
  repeated?: boolean;
  error?: string;
  receiptToken?: string;
}

/** How a failed offline operation is named on its bill for staff. */
const PROBLEM: Record<OutletOp["kind"], string> = {
  open_bill: "Bill opened offline not taken",
  add_item: "Item added offline not taken",
  remove_line: "Item taken back offline not taken",
  send_round: "Order sent offline not taken",
  pay_cash: "Cash taken offline not booked (count it into the Cash Book)",
  room_charge: "Room Charge offline refused when checked",
};

const KINDS: OutletOp["kind"][] = ["open_bill", "add_item", "remove_line", "send_round", "pay_cash", "room_charge"];
/** How far back a device's offline time is believed: older is taken as this long ago. */
const OFFLINE_DAYS = 7;

/**
 * Done before (the device sent it again after a lost answer, or its record
 * was lost): read from what exists, never from an error.
 */
async function doneBefore(pool: Pool, schema: string, outletId: string, op: OutletOp): Promise<boolean> {
  return withTenant(pool, schema, async (tx) => {
    const b = (await tx.query<{ outlet_id: string; status: string; reservation_id: string | null }>("select outlet_id, status, reservation_id from outlet_bills where id = $1", [op.billId])).rows[0];
    if (op.kind === "open_bill") {
      if (b && b.outlet_id !== outletId) throw new Error("The bill is not at this outlet");
      return !!b;
    }
    if (!b || b.outlet_id !== outletId) throw new Error("The bill is not at this outlet");
    switch (op.kind) {
      case "add_item":
        return (await tx.query("select 1 from outlet_bill_lines where id = $1 and bill_id = $2", [op.lineId, op.billId])).rows.length > 0;
      case "remove_line":
        return !(await tx.query("select 1 from outlet_bill_lines where id = $1", [op.lineId])).rows.length;
      case "send_round":
        return (await tx.query("select 1 from outlet_rounds where id = $1 and bill_id = $2", [op.roundId, op.billId])).rows.length > 0;
      case "pay_cash":
        return b.status === "paid";
      case "room_charge":
        return b.status === "charged" && b.reservation_id === op.reservationId;
    }
  });
}

/**
 * Apply what the device did offline, in its order, each operation once. One
 * sync per outlet at a time (a second waits), so nothing is applied twice.
 * The device's times are believed back to a week and kept in order. An
 * operation that fails does not stop the ones after it on other bills; on
 * its own bill the next ones fail too (and are reported).
 */
export async function applyOutletOps(pool: Pool, schema: string, outletId: string, device: string, ops: OutletOp[], viewer: Viewer & { name: string }): Promise<OpResult[]> {
  if (!isUuid(outletId)) throw new Error("Outlet not found");
  const c = await pool.connect();
  try {
    await c.query("select pg_advisory_lock(hashtext($1))", [`${schema}:outlet-sync:${outletId}`]);
    return await applyLocked(pool, schema, outletId, device, ops, viewer);
  } finally {
    await c.query("select pg_advisory_unlock(hashtext($1))", [`${schema}:outlet-sync:${outletId}`]).catch(() => undefined);
    c.release();
  }
}

async function applyLocked(pool: Pool, schema: string, outletId: string, device: string, ops: OutletOp[], viewer: Viewer & { name: string }): Promise<OpResult[]> {
  const out: OpResult[] = [];
  const broken = new Set<string>();
  const floor = Date.now() - OFFLINE_DAYS * 86_400_000;
  let last = floor;
  const named = (billId: string, text: string) => withTenant(pool, schema, (tx) => tx.query("update outlet_bills set offline_problem = coalesce(offline_problem || '; ', '') || $2 where id = $1 and outlet_id = $3", [billId, text.slice(0, 300), outletId]));
  for (const op of ops.slice(0, 500)) {
    if (!op || !isUuid(op.opId) || !isUuid(op.billId) || !KINDS.includes(op.kind)) {
      out.push({ opId: String(op?.opId), ok: false, error: "Not a valid operation" });
      continue;
    }
    const seen = await withTenant(pool, schema, async (tx) => (await tx.query<{ result: OpResult }>("select result from outlet_sync_ops where op_id = $1", [op.opId])).rows[0]?.result);
    if (seen) {
      out.push({ ...seen, repeated: true });
      continue;
    }
    if (broken.has(op.billId)) {
      out.push({ opId: op.opId, ok: false, error: "An earlier operation on this bill failed" });
      // cash or a Room Charge after the failure: still named on the bill, money was taken
      if (op.kind === "pay_cash" || op.kind === "room_charge") await named(op.billId, `${PROBLEM[op.kind]}: an earlier operation on this bill failed`);
      continue;
    }
    // the device's time, within the last week and never before the operation before it
    const t = new Date(op.at).getTime();
    last = Math.min(Date.now(), Math.max(last, Number.isNaN(t) ? Date.now() : t));
    let result: OpResult;
    try {
      result = (await doneBefore(pool, schema, outletId, op)) ? { opId: op.opId, ok: true, repeated: true } : { opId: op.opId, ok: true, ...(await applyOne(pool, schema, outletId, op, new Date(last), viewer)) };
    } catch (err) {
      const error = err instanceof Error && !("code" in err) ? err.message : "Could not be applied";
      result = { opId: op.opId, ok: false, error };
      broken.add(op.billId);
      // what failed (a Room Charge that no longer holds, cash taken with no Shift to book it to) stays with the bill for staff to settle
      if (op.kind !== "open_bill") await named(op.billId, `${PROBLEM[op.kind]}: ${error}`);
    }
    await withTenant(pool, schema, (tx) =>
      tx.query("insert into outlet_sync_ops (op_id, outlet_id, device, kind, result, applied_by) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [op.opId, outletId, device.slice(0, 100), op.kind, JSON.stringify(result), viewer.userId]),
    );
    out.push(result);
  }
  return out;
}

async function applyOne(pool: Pool, schema: string, outletId: string, op: OutletOp, at: Date, viewer: Viewer & { name: string }): Promise<Partial<OpResult>> {
  switch (op.kind) {
    case "open_bill":
      await openOutletBill(pool, schema, outletId, { tableId: op.tableId, label: op.label, id: op.billId }, viewer);
      return {};
    case "add_item":
      if (!isUuid(op.lineId)) throw new Error("Not a valid item");
      await addBillItem(pool, schema, op.billId, { menuItemId: op.menuItemId, quantity: op.quantity, modifiers: op.modifiers, note: op.note, id: op.lineId }, viewer);
      return {};
    case "remove_line":
      await removeBillLine(pool, schema, op.billId, op.lineId, viewer);
      return {};
    case "send_round":
      if (!isUuid(op.roundId) || !op.lineIds.every(isUuid)) throw new Error("Not a valid round");
      await sendOrderRound(pool, schema, op.billId, viewer, { id: op.roundId, orderedAt: at, lineIds: op.lineIds });
      return {};
    case "pay_cash": {
      const paid = await payOutletBillCash(pool, schema, op.billId, { customerName: op.customerName, offlineAt: at }, viewer);
      return { receiptToken: paid.receiptToken };
    }
    case "room_charge":
      await chargeBillToRoom(pool, schema, op.billId, { reservationId: op.reservationId, signature: op.signature }, viewer);
      return {};
    default:
      throw new Error("Not a valid operation");
  }
}
