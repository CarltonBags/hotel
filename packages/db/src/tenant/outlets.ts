import type { Pool, PoolClient } from "pg";
import {
  OUTLET_KINDS,
  PRINTER_KINDS,
  billTotal,
  can,
  chargesPerTaxCode,
  decidesAtOutlet,
  discountNeedsApproval,
  roomChargeCheck,
  isOneOf,
  lineFor,
  mayManageOutlet,
  roundMoney,
  splitIsValid,
  ticketsFor,
  ticketText,
  type Modifier,
  type OutletKind,
  type PrintTicket,
  type PrinterKind,
  type PropertyAction,
} from "@hoteloftware/domain";
import { useApproval, type ApprovalSubject } from "./approvals";
import { bookCashPaymentIn, issueReceiptIn } from "./cash";
import { postRoomChargeIn } from "./folios";
import { recordRoundOrderIn, recordVoidOrderIn } from "./fiscal-orders";
import { accountFor, failureOf, PAYMENT_COLUMNS, toPayment, type Payment, type PaymentRow } from "./payments";
import { redeemableVoucherIn } from "./vouchers";
import { isUuid } from "./catalogue-common";
import { issueFolioInvoiceIn, type IssuedInvoice } from "./invoices";
import { lockProperty } from "./property-lock";
import type { Viewer } from "./room-state";
import type { PaymentProvider } from "@hoteloftware/payments";
import { rateOn } from "./tax-rate";
import { withTenant } from "./with-tenant";

/**
 * Outlets (ticket 60, "Own point of sale for bar, restaurant and spa"): a
 * property's bar, restaurant or spa with its menu from the Service
 * catalogue, kitchen and bar printers, a Cash Register and a table plan.
 * Service open bills per table or guest, add items with modifiers, send order
 * rounds to the printers, split and move bills. An Outlet Sale is paid on the
 * spot (cash here; other tenders with ticket 61) with a Receipt, or invoiced
 * on account to a Company. A closed bill's items become Charges on a folio of
 * its own, so outlet revenue counts like any other by Service Date.
 */

function need(viewer: Viewer, action: PropertyAction, propertyId: string): void {
  if (!can(viewer.actor, action, propertyId)) throw new Error("Not allowed at this outlet");
}

export interface Outlet {
  id: string;
  propertyId: string;
  name: string;
  kind: OutletKind;
  cashRegisterId: string | null;
  active: boolean;
  managers: string[];
  /** The discount Service and Spa Staff give without an Approval (ticket 61). */
  discountPercent: number;
}

interface OutletRow {
  id: string;
  property_id: string;
  name: string;
  kind: OutletKind;
  cash_register_id: string | null;
  active: boolean;
  managers: string[];
  discount_percent: string;
}

const OUTLET_SELECT = `select o.id, o.property_id, o.name, o.kind, o.cash_register_id, o.active, o.discount_percent,
    coalesce((select array_agg(m.user_id order by m.user_id) from outlet_managers m where m.outlet_id = o.id), '{}') as managers
  from outlets o`;

const toOutlet = (o: OutletRow): Outlet => ({ id: o.id, propertyId: o.property_id, name: o.name, kind: o.kind, cashRegisterId: o.cash_register_id, active: o.active, managers: o.managers, discountPercent: Number(o.discount_percent) });

async function outletIn(tx: PoolClient, outletId: string): Promise<Outlet> {
  if (!isUuid(outletId)) throw new Error("Outlet not found");
  const o = (await tx.query<OutletRow>(`${OUTLET_SELECT} where o.id = $1`, [outletId])).rows[0];
  if (!o) throw new Error("Outlet not found");
  return toOutlet(o);
}

/** Opens bills and takes orders at the outlet: Service (and the managers); at a spa its Spa Staff instead (matrix "Spa appointment book, spa sales"). */
export function servesAt(viewer: Viewer, o: { propertyId: string; kind: string }): boolean {
  return o.kind === "spa" ? can(viewer.actor, "spa_book", o.propertyId) : can(viewer.actor, "serve_outlet", o.propertyId);
}

/** Sees the outlet's tables and bills: serves them or takes their money. */
function needWork(viewer: Viewer, propertyId: string): void {
  if (!can(viewer.actor, "serve_outlet", propertyId) && !can(viewer.actor, "outlet_cash", propertyId)) throw new Error("Not allowed at this outlet");
}

function needManage(viewer: Viewer, o: Outlet): void {
  if (!mayManageOutlet(viewer.actor, viewer.userId, o)) throw new Error("Only the Property Manager or this outlet's Outlet Manager may change it");
}

// ── the outlets of a property (Property Manager) ──

export async function listOutlets(pool: Pool, schema: string, propertyId: string): Promise<Outlet[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => (await tx.query<OutletRow>(`${OUTLET_SELECT} where o.property_id = $1 order by o.active desc, o.name`, [propertyId])).rows.map(toOutlet));
}

export interface OutletInput {
  name: string;
  kind: string;
  cashRegisterId: string | null;
  active: boolean;
  discountPercent?: number | undefined;
}

async function checkOutletInput(tx: PoolClient, propertyId: string, input: OutletInput): Promise<{ name: string; kind: OutletKind; register: string | null }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new Error("An outlet needs a name of up to 60 characters");
  if (!isOneOf(OUTLET_KINDS, input.kind)) throw new Error("Choose bar, restaurant, spa or other");
  const register = input.cashRegisterId || null;
  if (register) {
    if (!isUuid(register) || !(await tx.query("select 1 from cash_registers where id = $1 and property_id = $2", [register, propertyId])).rows.length) throw new Error("Cash Register not found at this property");
  }
  return { name, kind: input.kind, register };
}

/** Define an outlet (Property Manager) with its Cash Register. */
export async function createOutlet(pool: Pool, schema: string, propertyId: string, input: OutletInput, viewer: Viewer): Promise<string> {
  need(viewer, "manage_outlets", propertyId);
  return withTenant(pool, schema, async (tx) => {
    const v = await checkOutletInput(tx, propertyId, input);
    const dup = await tx.query("select 1 from outlets where property_id = $1 and lower(name) = lower($2)", [propertyId, v.name]);
    if (dup.rows.length) throw new Error("An outlet of this name exists");
    return (await tx.query<{ id: string }>("insert into outlets (property_id, name, kind, cash_register_id, active) values ($1, $2, $3, $4, $5) returning id", [propertyId, v.name, v.kind, v.register, input.active])).rows[0]!.id;
  });
}

export async function updateOutlet(pool: Pool, schema: string, outletId: string, input: OutletInput, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    need(viewer, "manage_outlets", o.propertyId);
    const v = await checkOutletInput(tx, o.propertyId, input);
    const pct = input.discountPercent === undefined ? o.discountPercent : roundMoney(Number(input.discountPercent));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("The discount is a percentage from 0 to 100");
    await tx.query("update outlets set name = $2, kind = $3, cash_register_id = $4, active = $5, discount_percent = $6 where id = $1", [o.id, v.name, v.kind, v.register, input.active, pct]);
  });
}

/** Who manages the outlet's menu, prices, printers and tables; it counts for users holding the Outlet Manager role at its property (mayManageOutlet). */
export async function setOutletManagers(pool: Pool, schema: string, outletId: string, userIds: string[], viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    need(viewer, "manage_outlets", o.propertyId);
    const ids = [...new Set(userIds.filter(Boolean))].slice(0, 50);
    await tx.query("delete from outlet_managers where outlet_id = $1", [o.id]);
    if (ids.length) await tx.query("insert into outlet_managers (outlet_id, user_id) select $1, unnest($2::text[])", [o.id, ids]);
  });
}

// ── an outlet's menu, printers and tables (Property Manager, own Outlet Manager) ──

export interface OutletPrinter {
  id: string;
  name: string;
  kind: PrinterKind;
  address: string;
  active: boolean;
}

export interface OutletTable {
  id: string;
  name: string;
  seats: number;
  sortOrder: number;
  active: boolean;
}

export interface MenuItem {
  id: string;
  serviceId: string;
  name: string;
  category: string;
  price: number;
  printerId: string | null;
  modifiers: Modifier[];
  active: boolean;
  sortOrder: number;
}

export interface OutletSetup {
  outlet: Outlet;
  printers: OutletPrinter[];
  tables: OutletTable[];
  menu: MenuItem[];
  /** May change menu, prices, printers and tables. */
  canManage: boolean;
}

async function setupIn(tx: PoolClient, o: Outlet, viewer: Viewer): Promise<OutletSetup> {
  const printers = (await tx.query<OutletPrinter>("select id, name, kind, address, active from outlet_printers where outlet_id = $1 order by name", [o.id])).rows;
  const tables = (await tx.query<{ id: string; name: string; seats: number; sort_order: number; active: boolean }>("select id, name, seats, sort_order, active from outlet_tables where outlet_id = $1 order by sort_order, name", [o.id])).rows.map((t) => ({ id: t.id, name: t.name, seats: t.seats, sortOrder: t.sort_order, active: t.active }));
  const menu = (await tx.query<{ id: string; service_id: string; name: string; category: string; price: string; printer_id: string | null; modifiers: Modifier[]; active: boolean; sort_order: number }>(
    "select id, service_id, name, category, price, printer_id, modifiers, active, sort_order from outlet_menu_items where outlet_id = $1 order by category, sort_order, name",
    [o.id],
  )).rows.map((i) => ({ id: i.id, serviceId: i.service_id, name: i.name, category: i.category, price: Number(i.price), printerId: i.printer_id, modifiers: i.modifiers, active: i.active, sortOrder: i.sort_order }));
  return { outlet: o, printers, tables, menu, canManage: mayManageOutlet(viewer.actor, viewer.userId, o) };
}

/** The outlet's menu, printers and tables: for those who manage or serve it. */
export async function outletSetup(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<OutletSetup> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    if (!mayManageOutlet(viewer.actor, viewer.userId, o)) needWork(viewer, o.propertyId);
    return setupIn(tx, o, viewer);
  });
}

const cleanName = (s: string, max: number, what: string) => {
  const v = s.trim();
  if (!v || v.length > max) throw new Error(`${what} needs a name of up to ${max} characters`);
  return v;
};

export async function savePrinter(pool: Pool, schema: string, outletId: string, input: Omit<OutletPrinter, "id"> & { id?: string | undefined }, viewer: Viewer): Promise<string> {
  const name = cleanName(input.name, 60, "A printer");
  if (!isOneOf(PRINTER_KINDS, input.kind)) throw new Error("Choose kitchen, bar or other");
  const address = input.address.trim().slice(0, 200);
  if (address && !/^https?:\/\/[^\s]+$/.test(address)) throw new Error("The printer's address is its ePOS URL, such as http://192.168.1.50");
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needManage(viewer, o);
    if (input.id) {
      const n = (await tx.query("update outlet_printers set name = $3, kind = $4, address = $5, active = $6 where id = $1 and outlet_id = $2", [input.id, o.id, name, input.kind, address, input.active])).rowCount;
      if (!n) throw new Error("Printer not found");
      return input.id;
    }
    return (await tx.query<{ id: string }>("insert into outlet_printers (outlet_id, name, kind, address, active) values ($1, $2, $3, $4, $5) returning id", [o.id, name, input.kind, address, input.active])).rows[0]!.id;
  });
}

export async function saveTable(pool: Pool, schema: string, outletId: string, input: Omit<OutletTable, "id"> & { id?: string | undefined }, viewer: Viewer): Promise<string> {
  const name = cleanName(input.name, 30, "A table");
  const seats = Number(input.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 99) throw new Error("Seats: a whole number from 1 to 99");
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needManage(viewer, o);
    if (input.id) {
      const n = (await tx.query("update outlet_tables set name = $3, seats = $4, sort_order = $5, active = $6 where id = $1 and outlet_id = $2", [input.id, o.id, name, seats, input.sortOrder, input.active])).rowCount;
      if (!n) throw new Error("Table not found");
      return input.id;
    }
    return (await tx.query<{ id: string }>("insert into outlet_tables (outlet_id, name, seats, sort_order, active) values ($1, $2, $3, $4, $5) returning id", [o.id, name, seats, input.sortOrder, input.active])).rows[0]!.id;
  });
}

/** A menu item: a Service of the property's catalogue (its Tax Code and revenue account) at the outlet's price, its printer and modifiers. */
export async function saveMenuItem(pool: Pool, schema: string, outletId: string, input: Omit<MenuItem, "id"> & { id?: string | undefined }, viewer: Viewer): Promise<string> {
  const name = cleanName(input.name, 80, "A menu item");
  const price = roundMoney(Number(input.price));
  if (!Number.isFinite(price) || price < 0 || price > 100_000) throw new Error("The price is an amount from 0");
  const modifiers = input.modifiers
    .map((m) => ({ name: m.name.trim().slice(0, 40), price: roundMoney(Number(m.price) || 0) }))
    .filter((m) => m.name)
    .slice(0, 20);
  if (new Set(modifiers.map((m) => m.name)).size !== modifiers.length) throw new Error("Each modifier once");
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needManage(viewer, o);
    if (!isUuid(input.serviceId) || !(await tx.query("select 1 from services where id = $1 and property_id = $2", [input.serviceId, o.propertyId])).rows.length) throw new Error("Service not found at this property");
    if (input.printerId && !(isUuid(input.printerId) && (await tx.query("select 1 from outlet_printers where id = $1 and outlet_id = $2", [input.printerId, o.id])).rows.length)) throw new Error("Printer not found at this outlet");
    const values = [o.id, input.serviceId, name, input.category.trim().slice(0, 40), price, input.printerId || null, JSON.stringify(modifiers), input.active, input.sortOrder];
    if (input.id) {
      const n = (await tx.query("update outlet_menu_items set service_id = $2, name = $3, category = $4, price = $5, printer_id = $6, modifiers = $7, active = $8, sort_order = $9 where id = $10 and outlet_id = $1", [...values, input.id])).rowCount;
      if (!n) throw new Error("Menu item not found");
      return input.id;
    }
    return (await tx.query<{ id: string }>("insert into outlet_menu_items (outlet_id, service_id, name, category, price, printer_id, modifiers, active, sort_order) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id", values)).rows[0]!.id;
  });
}

// ── serving: bills, order rounds, splits ──

/** The outlets the user works at a property: serves, takes money at, or manages. */
export async function outletsToWork(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<Outlet[]> {
  const all = (await listOutlets(pool, schema, propertyId)).filter((o) => o.active);
  const works = can(viewer.actor, "serve_outlet", propertyId) || can(viewer.actor, "outlet_cash", propertyId);
  return all.filter((o) => works || mayManageOutlet(viewer.actor, viewer.userId, o));
}

export interface OpenBill {
  id: string;
  number: number;
  tableId: string | null;
  label: string;
  total: number;
  /** Items with a printer not sent yet. */
  unsent: number;
  openedAt: string;
  /** What a device sold offline that could not be taken when it synced (ticket 62): for staff to settle. */
  offlineProblem: string | null;
}

export interface OutletFloor {
  outlet: Outlet;
  tables: { id: string; name: string; seats: number; bills: OpenBill[] }[];
  /** Bills without a table (a guest at the bar, a walk-in sale). */
  loose: OpenBill[];
}

/** The table plan with every open bill and its total. */
export async function outletFloor(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<OutletFloor> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needWork(viewer, o.propertyId);
    const tables = (await tx.query<{ id: string; name: string; seats: number }>("select id, name, seats from outlet_tables where outlet_id = $1 and active order by sort_order, name", [o.id])).rows;
    const bills = (await tx.query<{ id: string; number: number; table_id: string | null; label: string; total: string; unsent: number; opened_at: Date; offline_problem: string | null }>(
      `select b.id, b.number, b.table_id, b.label, b.opened_at, b.offline_problem,
         coalesce((select sum(l.amount) from outlet_bill_lines l where l.bill_id = b.id), 0) as total,
         (select count(*)::int from outlet_bill_lines l where l.bill_id = b.id and l.round_id is null and l.printer_id is not null) as unsent
       from outlet_bills b where b.outlet_id = $1 and b.status = 'open' order by b.number`,
      [o.id],
    )).rows.map((b) => ({ id: b.id, number: b.number, tableId: b.table_id, label: b.label, total: Number(b.total), unsent: b.unsent, openedAt: b.opened_at.toISOString(), offlineProblem: b.offline_problem }));
    return { outlet: o, tables: tables.map((t) => ({ ...t, bills: bills.filter((b) => b.tableId === t.id) })), loose: bills.filter((b) => !b.tableId) };
  });
}

interface BillRow {
  id: string;
  outlet_id: string;
  property_id: string;
  number: number;
  table_id: string | null;
  status: string;
}

async function billIn(tx: PoolClient, billId: string, lock = false): Promise<BillRow & { outlet: Outlet }> {
  if (!isUuid(billId)) throw new Error("Bill not found");
  const b = (await tx.query<BillRow>(`select id, outlet_id, property_id, number, table_id, status from outlet_bills where id = $1${lock ? " for update" : ""}`, [billId])).rows[0];
  if (!b) throw new Error("Bill not found");
  return { ...b, outlet: await outletIn(tx, b.outlet_id) };
}

async function openBillIn(tx: PoolClient, billId: string, viewer: Viewer, action: PropertyAction = "serve_outlet"): Promise<BillRow & { outlet: Outlet }> {
  const b = await billIn(tx, billId, true);
  // at the spa, Spa Staff sell (ticket 63)
  if (action === "serve_outlet") {
    if (!servesAt(viewer, b.outlet)) throw new Error("Not allowed at this outlet");
  } else need(viewer, action, b.property_id);
  if (b.status !== "open") throw new Error("The bill is closed");
  return b;
}

async function tableOf(tx: PoolClient, outletId: string, tableId: string | null): Promise<string | null> {
  if (!tableId) return null;
  if (!isUuid(tableId) || !(await tx.query("select 1 from outlet_tables where id = $1 and outlet_id = $2 and active", [tableId, outletId])).rows.length) throw new Error("Table not found at this outlet");
  return tableId;
}

async function newBillIn(tx: PoolClient, o: Outlet, input: { tableId: string | null; label: string; splitFrom?: string; id?: string | undefined }, userId: string): Promise<string> {
  // numbers per outlet without gaps between parallel openings
  await tx.query("select 1 from outlets where id = $1 for update", [o.id]);
  const n = (await tx.query<{ n: number }>("select coalesce(max(number), 0)::int + 1 as n from outlet_bills where outlet_id = $1", [o.id])).rows[0]!.n;
  return (await tx.query<{ id: string }>(
    "insert into outlet_bills (id, outlet_id, property_id, number, table_id, label, split_from, opened_by) values (coalesce($8::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7) returning id",
    [o.id, o.propertyId, n, input.tableId, input.label.trim().slice(0, 60), input.splitFrom ?? null, userId, input.id ?? null],
  )).rows[0]!.id;
}

/** Open a bill at a table, or for a guest or walk-in without one. */
export async function openOutletBill(pool: Pool, schema: string, outletId: string, input: { tableId: string | null; label: string; id?: string | undefined }, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    if (!servesAt(viewer, o)) throw new Error("Not allowed at this outlet");
    if (!o.active) throw new Error("The outlet is closed");
    // a device that sold offline brings its own id (applied once, ticket 62)
    return newBillIn(tx, o, { tableId: await tableOf(tx, o.id, input.tableId), label: input.label, id: input.id }, viewer.userId);
  });
}

export interface BillLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  modifiers: Modifier[];
  note: string;
  printerId: string | null;
  /** The order round it was sent with; null while not sent. */
  round: number | null;
  /** A sent item voided (ticket 61): struck out, not paid. */
  voided: { reason: string } | null;
}

export interface OutletBillView {
  id: string;
  number: number;
  outlet: Outlet;
  tableId: string | null;
  table: string | null;
  label: string;
  status: "open" | "paying" | "paid" | "invoiced" | "charged";
  lines: BillLine[];
  /** The items not voided. */
  total: number;
  discountPercent: number;
  discount: number;
  /** What the guest pays: the items less the discount. */
  due: number;
  tip: number;
  /** A Room Charge: the room and surname it went to. */
  roomCharge: { room: string | null; guest: string } | null;
  /** The card payment waiting at a reader or phone while the bill is paying. */
  pendingPaymentId: string | null;
  /** What a device sold offline that could not be taken when it synced (ticket 62). */
  offlineProblem: string | null;
  /** Payments received on the bill, for a refund. */
  payments: { id: string; tender: string; amount: number; refunded: number; offlineRisk: boolean }[];
  /** The Receipt of a bill paid on the spot. */
  receiptToken: string | null;
  invoiceId: string | null;
  /** The stay to charge by default: the hotel guest of the spa appointment the bill is for (ticket 63). */
  suggestedGuest: RoomChargeGuest | null;
}

export async function outletBill(pool: Pool, schema: string, billId: string, viewer: Viewer): Promise<OutletBillView> {
  return withTenant(pool, schema, async (tx) => {
    const b = await billIn(tx, billId);
    needWork(viewer, b.property_id);
    const head = (await tx.query<{ table: string | null; label: string; receipt: string | null; invoice: string | null; tip: string; room: string | null; guest: string | null; pending: string | null; offline_problem: string | null }>(
      `select t.name as table, b.label, b.offline_problem,
         (select coalesce(sum(p.tip), 0) from folios f join payments p on p.folio_id = f.id where f.outlet_bill_id = b.id and p.status = 'succeeded') as tip,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = b.reservation_id order by a.to_date desc limit 1) as room,
         (select g.last_name from reservations r join guests g on g.id = r.primary_guest_id where r.id = b.reservation_id) as guest,
         (select p.id from folios f join payments p on p.folio_id = f.id where f.outlet_bill_id = b.id and p.status = 'pending' and p.refund_of is null limit 1) as pending,
         (select rc.token from folios f join payments p on p.folio_id = f.id join receipts rc on rc.payment_id = p.id where f.outlet_bill_id = b.id limit 1) as receipt,
         (select i.id from folios f join invoices i on i.folio_id = f.id where f.outlet_bill_id = b.id and i.cancelled_by is null limit 1) as invoice
       from outlet_bills b left join outlet_tables t on t.id = b.table_id where b.id = $1`,
      [b.id],
    )).rows[0]!;
    const lines = await linesOf(tx, b.id);
    const a = await amountsIn(tx, b);
    const payments = (await tx.query<{ id: string; tender: string; amount: string; refunded: string; risk: boolean }>(
      `select p.id, p.tender, p.amount, (p.collected_offline and p.forwarded_at is null) as risk, (select coalesce(-sum(r.amount), 0) from payments r where r.refund_of = p.id and r.status in ('succeeded', 'pending', 'refund_pending_balance')) as refunded
       from folios f join payments p on p.folio_id = f.id where f.outlet_bill_id = $1 and p.status = 'succeeded' and p.refund_of is null order by p.posted_at`,
      [b.id],
    )).rows.map((p) => ({ id: p.id, tender: p.tender, amount: Number(p.amount), refunded: Number(p.refunded), offlineRisk: p.risk }));
    return {
      id: b.id,
      number: b.number,
      outlet: b.outlet,
      tableId: b.table_id,
      table: head.table,
      label: head.label,
      status: b.status as OutletBillView["status"],
      lines,
      total: a.subtotal,
      discountPercent: a.discountPercent,
      discount: a.discount,
      due: a.due,
      tip: Number(head.tip),
      roomCharge: head.guest ? { room: head.room, guest: head.guest } : null,
      pendingPaymentId: head.pending,
      offlineProblem: head.offline_problem,
      payments,
      receiptToken: head.receipt,
      invoiceId: head.invoice,
      suggestedGuest: b.status === "open" ? await suggestedGuestIn(tx, b.id, b.property_id) : null,
    };
  });
}

async function linesOf(tx: PoolClient, billId: string): Promise<BillLine[]> {
  return (await tx.query<{ id: string; description: string; quantity: number; unit_price: string; amount: string; modifiers: Modifier[]; note: string; printer_id: string | null; round: number | null; void_reason: string | null }>(
    `select l.id, l.description, l.quantity, l.unit_price, l.amount, l.modifiers, l.note, l.printer_id, r.number as round, l.void_reason
     from outlet_bill_lines l left join outlet_rounds r on r.id = l.round_id where l.bill_id = $1 order by l.created_at, l.id`,
    [billId],
  )).rows.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: Number(l.unit_price), amount: Number(l.amount), modifiers: l.modifiers, note: l.note, printerId: l.printer_id, round: l.round, voided: l.void_reason ? { reason: l.void_reason } : null }));
}

interface ServedLine {
  id: string;
  serviceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxCodeId: string;
  taxCode: string;
  taxRate: number;
  revenueAccount: string;
  unsent: boolean;
}

/** What the bill comes to on the Business Date: its items not voided with their Tax Codes, per Tax Code with the discount taken off. */
async function amountsIn(tx: PoolClient, b: BillRow) {
  const date = (await tx.query<{ d: string; discount: string }>(
    "select to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as d, b.discount_percent as discount from properties p join outlet_bills b on b.property_id = p.id where b.id = $1",
    [b.id],
  )).rows[0]!;
  const rows = (await tx.query<{ id: string; service_id: string; description: string; quantity: number; unit_price: string; amount: string; modifiers: Modifier[]; printer_id: string | null; round_id: string | null; tax_code_id: string; code: string; revenue_account: string }>(
    `select l.id, l.service_id, l.description, l.quantity, l.unit_price, l.amount, l.modifiers, l.printer_id, l.round_id, s.tax_code_id, t.code, s.revenue_account
     from outlet_bill_lines l join services s on s.id = l.service_id join tax_codes t on t.id = s.tax_code_id
     where l.bill_id = $1 and l.voided_at is null order by l.created_at, l.id`,
    [b.id],
  )).rows;
  const lines: ServedLine[] = [];
  for (const l of rows) {
    lines.push({
      id: l.id,
      serviceId: l.service_id,
      // the modifiers named on the folio and Receipt
      description: (l.modifiers.length ? `${l.description} (${l.modifiers.map((m) => m.name).join(", ")})` : l.description).slice(0, 200),
      quantity: l.quantity,
      unitPrice: Number(l.unit_price),
      amount: Number(l.amount),
      taxCodeId: l.tax_code_id,
      taxCode: l.code,
      taxRate: await rateOn(tx, l.tax_code_id, date.d),
      revenueAccount: l.revenue_account,
      unsent: !!l.printer_id && !l.round_id,
    });
  }
  const discountPercent = Number(date.discount);
  const perTax = chargesPerTaxCode(lines.map((l) => ({ taxCode: l.taxCode, taxRate: l.taxRate, revenueAccount: l.revenueAccount, description: l.description, quantity: l.quantity, amount: l.amount })), discountPercent);
  const subtotal = billTotal(lines);
  const discount = roundMoney(perTax.reduce((s, x) => s + x.discount, 0));
  return { date: date.d, lines, perTax, subtotal, discountPercent, discount, due: roundMoney(subtotal - discount) };
}

/** Add an item of the outlet's menu with its modifiers; it waits for the next order round. */
export async function addBillItem(pool: Pool, schema: string, billId: string, input: { menuItemId: string; quantity: number; modifiers: string[]; note: string; id?: string | undefined }, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    // a closed outlet takes no more orders; its open bills are only paid
    if (!b.outlet.active) throw new Error("The outlet is closed");
    if (!isUuid(input.menuItemId)) throw new Error("Menu item not found");
    const item = (await tx.query<{ id: string; service_id: string; name: string; price: string; printer_id: string | null; modifiers: Modifier[] }>(
      "select id, service_id, name, price, printer_id, modifiers from outlet_menu_items where id = $1 and outlet_id = $2 and active",
      [input.menuItemId, b.outlet_id],
    )).rows[0];
    if (!item) throw new Error("Menu item not found at this outlet");
    const line = lineFor({ name: item.name, price: Number(item.price), modifiers: item.modifiers }, Number(input.quantity), input.modifiers, input.note);
    return (await tx.query<{ id: string }>(
      `insert into outlet_bill_lines (id, bill_id, menu_item_id, service_id, description, quantity, unit_price, amount, modifiers, note, printer_id, created_by)
       values (coalesce($12::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [b.id, item.id, item.service_id, line.description, line.quantity, line.unitPrice, line.amount, JSON.stringify(line.modifiers), line.note, item.printer_id, viewer.userId, input.id ?? null],
    )).rows[0]!.id;
  });
}

/** Take back an item not sent yet (a sent one is voided, ticket 61). */
export async function removeBillLine(pool: Pool, schema: string, billId: string, lineId: string, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    if (!isUuid(lineId)) throw new Error("Item not found");
    const n = (await tx.query("delete from outlet_bill_lines where id = $1 and bill_id = $2 and round_id is null", [lineId, b.id])).rowCount;
    if (!n) throw new Error("Only an item not sent yet can be taken back");
  });
}

/**
 * Send the order round: every item not sent yet goes with it; those with a
 * printer make one print job per printer with the table, the items and
 * their modifiers. Returns the round's number (null when nothing was open).
 */
export async function sendOrderRound(pool: Pool, schema: string, billId: string, viewer: Viewer & { name: string }, offline: { id?: string; orderedAt?: Date; lineIds?: string[] } = {}): Promise<{ round: number | null; jobs: number }> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    const open = (await tx.query<{ id: string; description: string; quantity: number; modifiers: Modifier[]; note: string; printer_id: string | null; printer_active: boolean | null }>(
      `select l.id, l.description, l.quantity, l.modifiers, l.note, l.printer_id, p.active as printer_active
       from outlet_bill_lines l left join outlet_printers p on p.id = l.printer_id where l.bill_id = $1 and l.round_id is null and ($2::uuid[] is null or l.id = any($2::uuid[])) order by l.created_at, l.id`,
      [b.id, offline.lineIds ?? null],
    )).rows;
    if (!open.length) return { round: null, jobs: 0 };
    const number = (await tx.query<{ n: number }>("select coalesce(max(number), 0)::int + 1 as n from outlet_rounds where bill_id = $1", [b.id])).rows[0]!.n;
    // offline: the round as ordered on the device (its tickets printed there already)
    const round = (await tx.query<{ id: string; sent_at: Date }>(
      "insert into outlet_rounds (id, bill_id, number, sent_by, ordered_at) values (coalesce($4::uuid, gen_random_uuid()), $1, $2, $3, $5) returning id, sent_at",
      [b.id, number, viewer.userId, offline.id ?? null, offline.orderedAt ?? null],
    )).rows[0]!;
    await tx.query("update outlet_bill_lines set round_id = $2 where id = any($1::uuid[])", [open.map((l) => l.id), round.id]);
    const table = b.table_id ? (await tx.query<{ name: string }>("select name from outlet_tables where id = $1", [b.table_id])).rows[0]!.name : null;
    const tickets = ticketsFor(
      { outlet: b.outlet.name, table, bill: b.number, round: number, waiter: viewer.name.slice(0, 40), at: round.sent_at.toISOString() },
      // a printer switched off prints nothing
      open.map((l) => ({ printerId: l.printer_active ? l.printer_id : null, description: l.description, quantity: l.quantity, modifiers: l.modifiers, note: l.note })),
    );
    if (!offline.orderedAt) for (const t of tickets) await tx.query("insert into print_jobs (outlet_id, printer_id, round_id, ticket) values ($1, $2, $3, $4)", [b.outlet_id, t.printerId, round.id, JSON.stringify(t)]);
    // Germany: the round is an order the TSE signs (ticket 62)
    await recordRoundOrderIn(tx, round.id);
    return { round: number, jobs: tickets.length };
  });
}

/** Split: the chosen items move to a new bill at the same table; both totals together stay what the bill was. */
export async function splitOutletBill(pool: Pool, schema: string, billId: string, lineIds: string[], viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    const own = (await tx.query<{ id: string }>("select id from outlet_bill_lines where bill_id = $1", [b.id])).rows.map((l) => l.id);
    const moving = [...new Set(lineIds)];
    if (!splitIsValid(own, moving)) throw new Error("Choose some, not all, of this bill's items to move");
    const label = (await tx.query<{ label: string }>("select label from outlet_bills where id = $1", [b.id])).rows[0]!.label;
    const id = await newBillIn(tx, b.outlet, { tableId: b.table_id, label, splitFrom: b.id }, viewer.userId);
    await tx.query("update outlet_bill_lines set bill_id = $2 where id = any($1::uuid[])", [moving, id]);
    return id;
  });
}

/** Move a bill to another table (or off any table). */
export async function moveOutletBill(pool: Pool, schema: string, billId: string, tableId: string | null, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    await tx.query("update outlet_bills set table_id = $2 where id = $1", [b.id, await tableOf(tx, b.outlet_id, tableId)]);
  });
}

// ── closing: the Outlet Sale ──

/** The bill's folio (made when it is first closed or paid at the reader), billed to a Company or to nobody. */
async function billFolioIn(tx: PoolClient, b: BillRow, billTo: { companyId: string } | null, userId: string): Promise<string> {
  const have = (await tx.query<{ id: string }>("select id from folios where outlet_bill_id = $1", [b.id])).rows[0];
  if (have) {
    if (billTo) await tx.query("update folios set bill_to_company_id = $2 where id = $1", [have.id, billTo.companyId]);
    return have.id;
  }
  return (await tx.query<{ id: string }>("insert into folios (outlet_bill_id, number, bill_to_company_id, created_by) values ($1, 1, $2, $3) returning id", [b.id, billTo?.companyId ?? null, userId])).rows[0]!.id;
}

/** What a bill ready to close comes to: items there, none waiting for its printer. */
async function closableIn(tx: PoolClient, b: BillRow) {
  const a = await amountsIn(tx, b);
  if (!a.lines.length) throw new Error("The bill has no items");
  if (a.lines.some((l) => l.unsent)) throw new Error("Send the open items to the printers first");
  return a;
}

/** The bill's items as Charges on its own folio, on the Business Date (revenue like any other), its discount per Tax Code. */
async function postBillIn(tx: PoolClient, b: BillRow, billTo: { companyId: string } | null, userId: string): Promise<{ folioId: string; total: number }> {
  const a = await closableIn(tx, b);
  const folioId = await billFolioIn(tx, b, billTo, userId);
  const post = async (c: { serviceId: string | null; description: string; quantity: number; unitPrice: number; amount: number; taxCodeId: string; taxRate: number; revenueAccount: string }) => {
    const id = (await tx.query<{ id: string }>(
      `insert into charges (folio_id, reservation_id, property_id, service_id, description, service_date, quantity, unit_price, amount, tax_code_id, tax_rate, revenue_account, category, origin, posted_by, outlet_bill_id)
       values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'extras', 'outlet', $12, $13) returning id`,
      [folioId, b.property_id, c.serviceId, c.description, a.date, c.quantity, c.unitPrice, c.amount, c.taxCodeId, c.taxRate, c.revenueAccount, userId, b.id],
    )).rows[0]!.id;
    await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'post', $3)", [id, userId, JSON.stringify({ folioId, outletBillId: b.id })]);
  };
  for (const l of a.lines) await post(l);
  // the discount as a line per Tax Code, so the VAT falls where the items are
  for (const t of a.perTax.filter((x) => x.discount > 0)) {
    const taxCodeId = a.lines.find((l) => l.taxCode === t.taxCode)!.taxCodeId;
    await post({ serviceId: null, description: `Rabatt / Discount ${a.discountPercent} %`, quantity: 1, unitPrice: -t.discount, amount: -t.discount, taxCodeId, taxRate: t.taxRate, revenueAccount: t.revenueAccount });
  }
  return { folioId, total: a.due };
}

/**
 * The Outlet Sale paid in cash: into the Cash Book of the user's open Shift
 * on the outlet's Cash Register, with a Receipt (signed in Germany and
 * Austria like any payment); an optional customer name.
 */
export async function payOutletBillCash(pool: Pool, schema: string, billId: string, input: { customerName: string; offlineAt?: Date }, viewer: Viewer): Promise<{ paymentId: string; receiptToken: string; total: number }> {
  return withTenant(pool, schema, async (tx) => {
    const pre = await billIn(tx, billId);
    await lockProperty(tx, pre.property_id);
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    if (!b.outlet.cashRegisterId) throw new Error("The outlet has no Cash Register (Settings → Outlets)");
    const { folioId, total } = await postBillIn(tx, b, null, viewer.userId);
    if (total <= 0) throw new Error("Nothing to pay");
    const currency = (await tx.query<{ currency: string }>("select currency from properties where id = $1", [b.property_id])).rows[0]!.currency.trim();
    const paymentId = (await tx.query<{ id: string }>(
      "insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, posted_by, settled_at) values ($1, null, $2, 'cash', $3, $4, 'succeeded', $5, now()) returning id",
      [folioId, b.property_id, total, currency, viewer.userId],
    )).rows[0]!.id;
    const registerId = await bookCashPaymentIn(tx, { id: paymentId, propertyId: b.property_id, amount: total }, viewer.userId);
    if (registerId !== b.outlet.cashRegisterId) throw new Error(`Open your Shift on ${b.outlet.name}'s Cash Register to take its cash`);
    await issueReceiptIn(tx, { id: paymentId, propertyId: b.property_id }, registerId, viewer.userId);
    // sold without a connection: the Receipt says when it was really issued (ticket 62)
    if (input.offlineAt) await tx.query("update receipts set issued_offline_at = $2 where payment_id = $1", [paymentId, input.offlineAt]);
    await tx.query("update outlet_bills set status = 'paid', customer_name = $2, closed_by = $3, closed_at = clock_timestamp() where id = $1", [b.id, input.customerName.trim().slice(0, 100), viewer.userId]);
    const token = (await tx.query<{ token: string }>("select token from receipts where payment_id = $1", [paymentId])).rows[0]!.token;
    return { paymentId, receiptToken: token, total };
  });
}

/** A Company event: the bill invoiced on account to the Company (a Receivable), no money taken now. */
export async function invoiceOutletBill(pool: Pool, schema: string, billId: string, input: { companyId: string }, viewer: Viewer): Promise<IssuedInvoice> {
  return withTenant(pool, schema, async (tx) => {
    const pre = await billIn(tx, billId);
    await lockProperty(tx, pre.property_id);
    // a Company event is the table service's (Service, Outlet Manager, Property Manager)
    const b = await openBillIn(tx, billId, viewer, "serve_outlet");
    if (!isUuid(input.companyId)) throw new Error("Company not found");
    const c = (await tx.query<{ on_account: boolean; active: boolean }>("select on_account, active from companies where id = $1", [input.companyId])).rows[0];
    if (!c?.active) throw new Error("Company not found");
    if (!c.on_account) throw new Error("The Company is not billed on account (Companies → payment terms)");
    const { folioId } = await postBillIn(tx, b, { companyId: input.companyId }, viewer.userId);
    const invoice = await issueFolioInvoiceIn(tx, folioId, viewer.userId);
    if (!invoice) throw new Error("The bill has no items");
    await tx.query("update outlet_bills set status = 'invoiced', company_id = $2, closed_by = $3, closed_at = clock_timestamp() where id = $1", [b.id, input.companyId, viewer.userId]);
    return invoice;
  });
}

// ── discounts and voids (ticket 61) ──

/** Service and Spa Staff give up to the outlet's percentage; more with an Outlet Manager's Approval. */
export async function setBillDiscount(pool: Pool, schema: string, billId: string, percent: number, viewer: Viewer & { approverId?: string | null }): Promise<void> {
  const pct = roundMoney(Number(percent));
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("A discount is a percentage from 0 to 100");
  await withTenant(pool, schema, async (tx) => {
    // Service and Spa Staff alike (matrix "Discount")
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    const approver = discountNeedsApproval(pct, b.outlet.discountPercent, decidesAtOutlet(viewer.actor, viewer.userId, b.outlet))
      ? await useApproval(tx, outletSubject(b, "outlet_discount", `${b.id}:${pct}`, `Discount of ${pct} % on bill ${b.outlet.name} ${b.number}`), viewer)
      : null;
    await tx.query("update outlet_bills set discount_percent = $2, discount_approved_by = $3 where id = $1", [b.id, pct, approver]);
  });
}

function outletSubject(b: BillRow & { outlet: Outlet }, kind: ApprovalSubject["kind"], key: string, summary: string): ApprovalSubject {
  return { kind, propertyId: b.property_id, key, summary, recordId: null };
}

/** Void an item already sent (signed in Germany with ticket 62): with a reason; Service and Spa Staff need an Outlet Manager's Approval. */
export async function voidBillLine(pool: Pool, schema: string, billId: string, lineId: string, reason: string, viewer: Viewer & { approverId?: string | null }): Promise<void> {
  const why = reason.trim().slice(0, 200);
  if (!why) throw new Error("A reason is required to void an item");
  if (!isUuid(lineId)) throw new Error("Item not found");
  await withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    const l = (await tx.query<{ description: string; round_id: string | null; voided_at: Date | null }>("select description, round_id, voided_at from outlet_bill_lines where id = $1 and bill_id = $2 for update", [lineId, b.id])).rows[0];
    if (!l) throw new Error("Item not found");
    if (l.voided_at) return;
    if (!l.round_id) throw new Error("An item not sent yet is taken back, not voided");
    const approver = decidesAtOutlet(viewer.actor, viewer.userId, b.outlet) ? null : await useApproval(tx, outletSubject(b, "outlet_void", lineId, `Void of ${l.description} on bill ${b.outlet.name} ${b.number}`), viewer);
    await tx.query("update outlet_bill_lines set voided_at = clock_timestamp(), voided_by = $2, void_reason = $3, void_approved_by = $4 where id = $1", [lineId, viewer.userId, why, approver]);
    // a signed order is cancelled by a new negative one (ticket 62)
    await recordVoidOrderIn(tx, lineId);
  });
}

// ── paying by Voucher, card on a reader, tap to pay (ticket 61) ──

/** Paid by Voucher, at a property of the Legal Entity that sold it; a Receipt as for cash. */
export async function payOutletBillVoucher(pool: Pool, schema: string, billId: string, input: { code: string; customerName: string }, viewer: Viewer): Promise<{ paymentId: string; receiptToken: string; total: number }> {
  return withTenant(pool, schema, async (tx) => {
    const pre = await billIn(tx, billId);
    await lockProperty(tx, pre.property_id);
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    const { folioId, total } = await postBillIn(tx, b, null, viewer.userId);
    if (total <= 0) throw new Error("Nothing to pay");
    const voucherId = await redeemableVoucherIn(tx, b.property_id, input.code, total);
    const currency = (await tx.query<{ currency: string }>("select currency from properties where id = $1", [b.property_id])).rows[0]!.currency.trim();
    const paymentId = (await tx.query<{ id: string }>(
      "insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, posted_by, settled_at, voucher_id) values ($1, null, $2, 'voucher', $3, $4, 'succeeded', $5, now(), $6) returning id",
      [folioId, b.property_id, total, currency, viewer.userId, voucherId],
    )).rows[0]!.id;
    await issueReceiptIn(tx, { id: paymentId, propertyId: b.property_id }, b.outlet.cashRegisterId, viewer.userId);
    await tx.query("update outlet_bills set status = 'paid', customer_name = $2, closed_by = $3, closed_at = clock_timestamp() where id = $1", [b.id, input.customerName.trim().slice(0, 100), viewer.userId]);
    const token = (await tx.query<{ token: string }>("select token from receipts where payment_id = $1", [paymentId])).rows[0]!.token;
    return { paymentId, receiptToken: token, total };
  });
}

/**
 * Pay by card: on a paired reader (girocard needs one; the guest may add a
 * tip on it) or by tap to pay on a staff phone (not girocard; a tip is part
 * of the amount typed). The payment waits at the device; its answer closes
 * the bill or opens it again (settleOutletBillIn).
 */
export async function startOutletCardPayment(pool: Pool, schema: string, provider: PaymentProvider, billId: string, input: { readerId: string; tip: number }, viewer: Viewer): Promise<Payment> {
  const tip = roundMoney(Number(input.tip) || 0);
  if (tip < 0 || tip > 10_000) throw new Error("The tip is an amount from 0");
  const prepared = await withTenant(pool, schema, async (tx) => {
    const pre = await billIn(tx, billId);
    await lockProperty(tx, pre.property_id);
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    const a = await closableIn(tx, b);
    if (a.due <= 0) throw new Error("Nothing to pay");
    const reader = (await tx.query<{ reader_id: string; kind: "reader" | "phone" }>("select reader_id, kind from terminal_readers where property_id = $1 and reader_id = $2", [b.property_id, String(input.readerId)])).rows[0];
    if (!reader) throw new Error("Choose a reader or phone of this property");
    // on a reader the guest adds the tip; on the phone it is typed with the amount
    if (reader.kind === "reader" && tip) throw new Error("On the reader the guest adds the tip");
    const ctx = await accountFor(tx, b.property_id, provider);
    const folioId = await billFolioIn(tx, b, null, viewer.userId);
    const row = (await tx.query<PaymentRow>(
      `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, provider, reader_id, posted_by, tip)
       values ($1, null, $2, 'card_terminal', $3, $4, 'pending', $5, $6, $7, $8) returning ${PAYMENT_COLUMNS}`,
      [folioId, b.property_id, a.due, ctx.currency, provider.name, reader.reader_id, viewer.userId, tip],
    )).rows[0]!;
    await tx.query("update outlet_bills set status = 'paying' where id = $1", [b.id]);
    return { row, ctx, reader, amount: roundMoney(a.due + tip) };
  });
  try {
    const { intentId } = await provider.startTerminalPayment(prepared.ctx.accountId, {
      readerId: prepared.reader.reader_id,
      amount: prepared.amount,
      currency: prepared.ctx.currency,
      hold: false,
      moto: false,
      tapToPay: prepared.reader.kind === "phone",
      description: "Outlet bill",
      metadata: { payment_id: prepared.row.id },
      idempotencyKey: `payment:${prepared.row.id}`,
    });
    return withTenant(pool, schema, async (tx) => toPayment((await tx.query<PaymentRow>(`update payments set provider_intent_id = $2 where id = $1 returning ${PAYMENT_COLUMNS}`, [prepared.row.id, intentId])).rows[0]!));
  } catch (err) {
    const f = failureOf(err);
    await withTenant(pool, schema, async (tx) => {
      await tx.query("update payments set status = 'failed', error = $2 where id = $1 and status = 'pending'", [prepared.row.id, f.message]);
      await tx.query("update outlet_bills set status = 'open' where id = $1 and status = 'paying'", [billId]);
    });
    throw new Error(f.message);
  }
}

/**
 * Inside the settling transaction of a payment on an outlet bill's folio:
 * the card went through, so the items become Charges, a tip the guest added
 * on the reader is kept apart, and the bill is paid; or it failed (a girocard
 * presented to a phone is refused), and the bill is open again.
 */
export async function settleOutletBillIn(tx: PoolClient, p: PaymentRow, state: { received: number; brand: string | null }): Promise<void> {
  const b = (await tx.query<BillRow>("select b.id, b.outlet_id, b.property_id, b.number, b.table_id, b.status from outlet_bills b join folios f on f.outlet_bill_id = b.id where f.id = $1 for update of b", [p.folio_id])).rows[0];
  if (!b || b.status !== "paying" || p.refund_of) return;
  // a girocard on a phone is declined by the provider (tap to pay takes none) and so arrives here as failed: money that came through is kept
  const phone = (await tx.query<{ kind: string }>("select kind from terminal_readers where reader_id = $1", [p.reader_id])).rows[0]?.kind === "phone";
  if (p.status !== "succeeded") {
    await tx.query("update outlet_bills set status = 'open' where id = $1", [b.id]);
    return;
  }
  const tip = phone ? Number(p.tip) : roundMoney(Math.max(0, state.received - Number(p.amount)));
  if (!phone && tip) await tx.query("update payments set tip = $2 where id = $1", [p.id, tip]);
  await postBillIn(tx, b, null, p.posted_by);
  await tx.query("update outlet_bills set status = 'paid', closed_by = $2, closed_at = clock_timestamp() where id = $1", [b.id, p.posted_by]);
  // the Receipt on the outlet's register (the desk's settle path finds it issued)
  const register = (await tx.query<{ r: string | null }>("select cash_register_id as r from outlets where id = $1", [b.outlet_id])).rows[0]!.r;
  await issueReceiptIn(tx, { id: p.id, propertyId: p.property_id }, register, p.posted_by);
}

/** A bill whose card payment ended without settling (cancelled before an intent, refused): open again. */
export async function reopenPayingBill(pool: Pool, schema: string, billId: string, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const b = await billIn(tx, billId, true);
    need(viewer, "outlet_cash", b.property_id);
    await tx.query(
      `update outlet_bills b set status = 'open' where b.id = $1 and b.status = 'paying'
         and not exists (select 1 from folios f join payments p on p.folio_id = f.id where f.outlet_bill_id = b.id and p.status = 'pending')`,
      [b.id],
    );
  });
}

// ── Room Charge (ticket 61) ──

export interface RoomChargeGuest {
  reservationId: string;
  room: string | null;
  lastName: string;
  /** Room Charge possible at all (in house, not blocked, covered). */
  allowed: boolean;
  /** What is left of tonight's Spending Limit. */
  remaining: number;
}

export async function roomChargeFactsIn(tx: PoolClient, propertyId: string, reservationId: string): Promise<{ status: string; blocked: boolean; covered: boolean; chargedTonight: number; limit: number; lastName: string; room: string | null }> {
  const r = (await tx.query<{ status: string; blocked: boolean; covered: boolean; charged: string; limit: string; last_name: string; room: string | null }>(
    `select r.status, r.room_charge_blocked as blocked, g.last_name, p.spending_limit as limit,
       (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= p.business_date and a.to_date > p.business_date limit 1) as room,
       -- a Card Hold, a Card Guarantee or a Company folio billed on account covers it
       (exists (select 1 from card_holds h where h.reservation_id = r.id and h.status = 'active')
        or exists (select 1 from card_guarantees c where c.reservation_id = r.id and c.status = 'secured')
        or exists (select 1 from folios f join companies co on co.id = f.bill_to_company_id where f.reservation_id = r.id and co.on_account)) as covered,
       (select coalesce(sum(ch.amount), 0) from charges ch where ch.reservation_id = r.id and ch.origin = 'outlet' and ch.voided_at is null and ch.service_date = p.business_date) as charged
     from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id where r.id = $1 and r.property_id = $2`,
    [reservationId, propertyId],
  )).rows[0];
  if (!r) throw new Error("Reservation not found at this property");
  return { status: r.status, blocked: r.blocked, covered: r.covered, chargedTonight: Number(r.charged), limit: Number(r.limit), lastName: r.last_name, room: r.room };
}

/** A spa bill's hotel guest, in house: offered first for the Room Charge. */
async function suggestedGuestIn(tx: PoolClient, billId: string, propertyId: string): Promise<RoomChargeGuest | null> {
  const r = (await tx.query<{ id: string }>("select r.id from spa_appointments a join reservations r on r.id = a.reservation_id where a.bill_id = $1 and r.status = 'checked_in' limit 1", [billId])).rows[0];
  if (!r) return null;
  const f = await roomChargeFactsIn(tx, propertyId, r.id);
  const c = roomChargeCheck({ ...f, amount: 0 });
  return { reservationId: r.id, room: f.room, lastName: f.lastName, allowed: c.allowed, remaining: c.remaining };
}

/** The guests in house to charge to: room, surname, yes or no and what is left of tonight's limit; never card data. */
export async function roomChargeGuests(pool: Pool, schema: string, outletId: string, query: string, viewer: Viewer): Promise<RoomChargeGuest[]> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    need(viewer, "outlet_cash", o.propertyId);
    const q = query.trim().slice(0, 40);
    if (q.length < 1) return [];
    const ids = (await tx.query<{ id: string }>(
      `select r.id from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
       where r.property_id = $1 and r.status = 'checked_in'
         and (g.last_name ilike $2 || '%' or exists (select 1 from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= p.business_date and a.to_date > p.business_date and m.number = $3))
       order by g.last_name limit 10`,
      [o.propertyId, q.replace(/[%_]/g, ""), q],
    )).rows;
    const out: RoomChargeGuest[] = [];
    for (const { id } of ids) {
      const f = await roomChargeFactsIn(tx, o.propertyId, id);
      const c = roomChargeCheck({ ...f, amount: 0 });
      out.push({ reservationId: id, room: f.room, lastName: f.lastName, allowed: c.allowed, remaining: c.remaining });
    }
    return out;
  });
}

/**
 * Close the bill by Room Charge: one Charge per Tax Code on the stay's folio
 * (by its Routing Rules) with the items as detail. Above tonight's Spending
 * Limit an Outlet Manager approves (or the guest pays directly). The guest's
 * signature on the device is kept with the bill (or they sign the printed
 * Receipt).
 */
export async function chargeBillToRoom(pool: Pool, schema: string, billId: string, input: { reservationId: string; signature: string | null }, viewer: Viewer & { approverId?: string | null }): Promise<{ charges: number; total: number }> {
  if (!isUuid(input.reservationId)) throw new Error("Reservation not found");
  const signature = input.signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.signature) && input.signature.length < 200_000 ? input.signature : null;
  return withTenant(pool, schema, async (tx) => {
    const pre = await billIn(tx, billId);
    await lockProperty(tx, pre.property_id);
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
    const a = await closableIn(tx, b);
    if (a.due <= 0) throw new Error("Nothing to charge");
    await tx.query("select 1 from reservations where id = $1 for update", [input.reservationId]);
    const f = await roomChargeFactsIn(tx, b.property_id, input.reservationId);
    const c = roomChargeCheck({ ...f, amount: a.due });
    if (!c.allowed) throw new Error(c.reason!);
    if (c.overLimit && !decidesAtOutlet(viewer.actor, viewer.userId, b.outlet)) {
      await useApproval(tx, { kind: "room_charge_over_limit", propertyId: b.property_id, key: `${b.id}:${input.reservationId}:${a.due}`, summary: `Room Charge of ${a.due.toFixed(2)} to room ${f.room ?? "?"} (${f.lastName}), ${c.remaining.toFixed(2)} left tonight`, recordId: input.reservationId }, viewer);
    }
    const label = `${b.outlet.name} ${b.number}`;
    const ids = await postRoomChargeIn(
      tx,
      input.reservationId,
      { outletBillId: b.id },
      a.perTax.map((t) => ({
        description: `${label}${t.discount ? ` (−${a.discountPercent} %)` : ""}`,
        taxCodeId: a.lines.find((l) => l.taxCode === t.taxCode)!.taxCodeId,
        revenueAccount: t.revenueAccount,
        amount: t.amount,
        detail: t.items,
      })),
      viewer.userId,
    );
    await tx.query("update outlet_bills set status = 'charged', reservation_id = $2, signature = $3, closed_by = $4, closed_at = clock_timestamp() where id = $1", [b.id, input.reservationId, signature, viewer.userId]);
    return { charges: ids.length, total: a.due };
  });
}

/** The property's Spending Limit per night for Room Charges (Property Manager). */
export async function setSpendingLimit(pool: Pool, schema: string, propertyId: string, amount: number, viewer: Viewer): Promise<void> {
  need(viewer, "manage_outlets", propertyId);
  const v = roundMoney(Number(amount));
  if (!Number.isFinite(v) || v < 0 || v > 100_000) throw new Error("The Spending Limit is an amount from 0");
  await withTenant(pool, schema, (tx) => tx.query("update properties set spending_limit = $2 where id = $1", [propertyId, v]));
}

export async function spendingLimitOf(pool: Pool, schema: string, propertyId: string): Promise<number> {
  if (!isUuid(propertyId)) return 0;
  return withTenant(pool, schema, async (tx) => Number((await tx.query<{ l: string }>("select spending_limit as l from properties where id = $1", [propertyId])).rows[0]?.l ?? 0));
}

/** A stay blocked from Room Charges ("cash only"), or open again; the desk decides on the reservation. */
export async function setRoomChargeBlocked(pool: Pool, schema: string, reservationId: string, blocked: boolean, viewer: Viewer): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!r) throw new Error("Reservation not found");
    need(viewer, "manage_folios", r.property_id);
    await tx.query("update reservations set room_charge_blocked = $2 where id = $1", [reservationId, blocked]);
  });
}

/** A Room Charge's slip: its items as charged to the stay, the total, when, and the guest's signature if given on the device. */
export async function roomChargeSlip(pool: Pool, schema: string, billId: string, viewer: Viewer): Promise<{ items: { description: string; quantity: number; amount: number }[]; total: number; closedAt: Date; signature: string | null }> {
  return withTenant(pool, schema, async (tx) => {
    const b = await billIn(tx, billId);
    needWork(viewer, b.property_id);
    const head = (await tx.query<{ closed_at: Date; signature: string | null }>("select closed_at, signature from outlet_bills where id = $1 and status = 'charged'", [b.id])).rows[0];
    if (!head) throw new Error("The bill is not charged to a room");
    const charges = (await tx.query<{ amount: string; detail: { description: string; quantity: number; amount: number }[] | null }>(
      "select amount, detail from charges where outlet_bill_id = $1 and reservation_id is not null and origin = 'outlet' order by posted_at, id",
      [b.id],
    )).rows;
    return { items: charges.flatMap((c) => c.detail ?? []), total: roundMoney(charges.reduce((s, c) => s + Number(c.amount), 0)), closedAt: head.closed_at, signature: head.signature };
  });
}

// ── outlet reports (ticket 61) ──

export interface OutletReportRow {
  outlet: string;
  outletId: string;
  date: string;
  userId: string;
  bills: number;
  /** Paid at the outlet (cash, card, Voucher). */
  paid: number;
  roomCharged: number;
  invoiced: number;
  discounts: number;
  tips: number;
  voids: number;
}

/** Per outlet, Business Date and user who closed the bill: what was paid, charged to rooms and invoiced, discounts, tips and voided items. */
export async function outletReport(pool: Pool, schema: string, propertyId: string, range: { from: string; to: string }, viewer: Viewer): Promise<OutletReportRow[]> {
  return withTenant(pool, schema, async (tx) => {
    const outlets = (await tx.query<OutletRow>(`${OUTLET_SELECT} where o.property_id = $1`, [propertyId])).rows.map(toOutlet);
    // the Property Manager and Accounting every outlet; an Outlet Manager own outlets
    if (!can(viewer.actor, "view_outlet_reports", propertyId)) return [];
    const all = can(viewer.actor, "view_financial_reports", propertyId);
    const shown = outlets.filter((o) => all || mayManageOutlet(viewer.actor, viewer.userId, o)).map((o) => o.id);
    if (!shown.length) return [];
    const rows = (await tx.query<{ outlet_id: string; name: string; d: string; user_id: string; bills: number; paid: string; charged: string; invoiced: string; discounts: string; tips: string; voids: number }>(
      `select o.id as outlet_id, o.name, to_char(b.day, 'YYYY-MM-DD') as d, b.closed_by as user_id, count(*)::int as bills,
         coalesce(sum((select sum(pa.amount) from folios f join payments pa on pa.folio_id = f.id where f.outlet_bill_id = b.id and pa.status = 'succeeded')), 0) as paid,
         coalesce(sum((select sum(ch.amount) from charges ch where ch.outlet_bill_id = b.id and ch.reservation_id is not null and ch.voided_at is null)), 0) as charged,
         coalesce(sum((select sum(i.gross) from folios f join invoices i on i.folio_id = f.id where f.outlet_bill_id = b.id and i.kind = 'final' and i.cancelled_by is null)), 0) as invoiced,
         -- the discount given, also where it was folded into a Room Charge
         coalesce(sum(round((select coalesce(sum(l.amount), 0) from outlet_bill_lines l where l.bill_id = b.id and l.voided_at is null) * b.discount_percent / 100, 2)), 0) as discounts,
         coalesce(sum((select sum(pa.tip) from folios f join payments pa on pa.folio_id = f.id where f.outlet_bill_id = b.id and pa.status = 'succeeded')), 0) as tips,
         coalesce(sum((select count(*) from outlet_bill_lines l where l.bill_id = b.id and l.voided_at is not null)), 0)::int as voids
       -- a bill counts on the Business Date its items were posted on (the calendar day of closing for one invoiced without them)
       from (select x.*, coalesce((select min(ch.service_date) from charges ch where ch.outlet_bill_id = x.id), (x.closed_at at time zone p.time_zone)::date) as day
             from outlet_bills x join properties p on p.id = x.property_id where x.outlet_id = any($1::uuid[]) and x.closed_at is not null) b
       join outlets o on o.id = b.outlet_id
       where b.day between $2 and $3
       group by o.id, o.name, b.day, b.closed_by order by b.day, o.name, b.closed_by`,
      [shown, range.from, range.to],
    )).rows;
    return rows.map((r) => ({ outlet: r.name, outletId: r.outlet_id, date: r.d, userId: r.user_id, bills: r.bills, paid: Number(r.paid), roomCharged: Number(r.charged), invoiced: Number(r.invoiced), discounts: Number(r.discounts), tips: Number(r.tips), voids: r.voids }));
  });
}

// ── printing ──

export interface PrintJob {
  id: string;
  printerId: string;
  printerName: string;
  /** The printer's ePOS address; empty: shown on screen only. */
  address: string;
  text: string;
  ticket: PrintTicket;
  attempts: number;
}

/**
 * The outlet's device takes the jobs to print: new ones, failed ones (up to
 * five tries) and ones another device took two minutes ago without
 * answering. Taken jobs are not handed out twice meanwhile.
 */
export async function takePrintJobs(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<PrintJob[]> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needWork(viewer, o.propertyId);
    const rows = (await tx.query<{ id: string; printer_id: string; name: string; address: string; ticket: PrintTicket; attempts: number }>(
      `update print_jobs j set status = 'printing', claimed_at = clock_timestamp(), attempts = j.attempts + 1
       from outlet_printers p
       where p.id = j.printer_id and j.id in (
         select id from print_jobs where outlet_id = $1
           and (status = 'pending' or (status = 'failed' and attempts < 5) or (status = 'printing' and claimed_at < clock_timestamp() - interval '2 minutes'))
         order by created_at limit 20 for update skip locked)
       returning j.id, j.printer_id, p.name, p.address, j.ticket, j.attempts`,
      [o.id],
    )).rows;
    return rows.map(toPrintJob);
  });
}

const toPrintJob = (r: { id: string; printer_id: string; name: string; address: string; ticket: PrintTicket; attempts: number }): PrintJob => ({ id: r.id, printerId: r.printer_id, printerName: r.name, address: r.address, text: ticketText(r.ticket), ticket: r.ticket, attempts: r.attempts });

/** The device's answer for a job: printed, or failed with the printer's error (tried again). */
export async function reportPrintJob(pool: Pool, schema: string, jobId: string, result: { ok: boolean; error?: string | undefined }, viewer: Viewer): Promise<void> {
  if (!isUuid(jobId)) throw new Error("Print job not found");
  await withTenant(pool, schema, async (tx) => {
    const j = (await tx.query<{ outlet_id: string; property_id: string }>("select j.outlet_id, o.property_id from print_jobs j join outlets o on o.id = j.outlet_id where j.id = $1", [jobId])).rows[0];
    if (!j) throw new Error("Print job not found");
    needWork(viewer, j.property_id);
    await tx.query(result.ok ? "update print_jobs set status = 'printed', printed_at = clock_timestamp(), error = null where id = $1" : "update print_jobs set status = 'failed', error = $2 where id = $1", result.ok ? [jobId] : [jobId, (result.error ?? "").slice(0, 300)]);
  });
}

/** Jobs that failed five times: shown to staff to print again by hand. */
export async function failedPrintJobs(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<PrintJob[]> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    needWork(viewer, o.propertyId);
    const rows = (await tx.query<{ id: string; printer_id: string; name: string; address: string; ticket: PrintTicket; attempts: number }>(
      "select j.id, j.printer_id, p.name, p.address, j.ticket, j.attempts from print_jobs j join outlet_printers p on p.id = j.printer_id where j.outlet_id = $1 and j.status = 'failed' and j.attempts >= 5 order by j.created_at desc limit 20",
      [o.id],
    )).rows;
    return rows.map(toPrintJob);
  });
}

/** The property of an outlet or of one of its bills (for the caller's rights check). */
export async function outletProperty(pool: Pool, schema: string, ref: { outletId?: string; billId?: string }): Promise<string | null> {
  const id = ref.outletId ?? ref.billId;
  if (!id || !isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ property_id: string }>(ref.outletId ? "select property_id from outlets where id = $1" : "select property_id from outlet_bills where id = $1", [id])).rows[0]?.property_id ?? null,
  );
}
