import type { Pool, PoolClient } from "pg";
import {
  OUTLET_KINDS,
  PRINTER_KINDS,
  billTotal,
  can,
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
import { bookCashPaymentIn, issueReceiptIn } from "./cash";
import { isUuid } from "./catalogue-common";
import { issueFolioInvoiceIn, type IssuedInvoice } from "./invoices";
import { lockProperty } from "./property-lock";
import type { Viewer } from "./room-state";
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
}

interface OutletRow {
  id: string;
  property_id: string;
  name: string;
  kind: OutletKind;
  cash_register_id: string | null;
  active: boolean;
  managers: string[];
}

const OUTLET_SELECT = `select o.id, o.property_id, o.name, o.kind, o.cash_register_id, o.active,
    coalesce((select array_agg(m.user_id order by m.user_id) from outlet_managers m where m.outlet_id = o.id), '{}') as managers
  from outlets o`;

const toOutlet = (o: OutletRow): Outlet => ({ id: o.id, propertyId: o.property_id, name: o.name, kind: o.kind, cashRegisterId: o.cash_register_id, active: o.active, managers: o.managers });

async function outletIn(tx: PoolClient, outletId: string): Promise<Outlet> {
  if (!isUuid(outletId)) throw new Error("Outlet not found");
  const o = (await tx.query<OutletRow>(`${OUTLET_SELECT} where o.id = $1`, [outletId])).rows[0];
  if (!o) throw new Error("Outlet not found");
  return toOutlet(o);
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
    await tx.query("update outlets set name = $2, kind = $3, cash_register_id = $4, active = $5 where id = $1", [o.id, v.name, v.kind, v.register, input.active]);
  });
}

/** Who manages the outlet's menu, prices, printers and tables: users holding the Outlet Manager role at its property. */
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
    if (!mayManageOutlet(viewer.actor, viewer.userId, o) && !can(viewer.actor, "serve_outlet", o.propertyId) && !can(viewer.actor, "outlet_cash", o.propertyId)) throw new Error("Not allowed at this outlet");
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
  return all.filter((o) => can(viewer.actor, "serve_outlet", propertyId) || can(viewer.actor, "outlet_cash", propertyId) || mayManageOutlet(viewer.actor, viewer.userId, o));
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
    if (!can(viewer.actor, "serve_outlet", o.propertyId) && !can(viewer.actor, "outlet_cash", o.propertyId)) throw new Error("Not allowed at this outlet");
    const tables = (await tx.query<{ id: string; name: string; seats: number }>("select id, name, seats from outlet_tables where outlet_id = $1 and active order by sort_order, name", [o.id])).rows;
    const bills = (await tx.query<{ id: string; number: number; table_id: string | null; label: string; total: string; unsent: number; opened_at: Date }>(
      `select b.id, b.number, b.table_id, b.label, b.opened_at,
         coalesce((select sum(l.amount) from outlet_bill_lines l where l.bill_id = b.id), 0) as total,
         (select count(*)::int from outlet_bill_lines l where l.bill_id = b.id and l.round_id is null and l.printer_id is not null) as unsent
       from outlet_bills b where b.outlet_id = $1 and b.status = 'open' order by b.number`,
      [o.id],
    )).rows.map((b) => ({ id: b.id, number: b.number, tableId: b.table_id, label: b.label, total: Number(b.total), unsent: b.unsent, openedAt: b.opened_at.toISOString() }));
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
  need(viewer, action, b.property_id);
  if (b.status !== "open") throw new Error("The bill is closed");
  return b;
}

async function tableOf(tx: PoolClient, outletId: string, tableId: string | null): Promise<string | null> {
  if (!tableId) return null;
  if (!isUuid(tableId) || !(await tx.query("select 1 from outlet_tables where id = $1 and outlet_id = $2 and active", [tableId, outletId])).rows.length) throw new Error("Table not found at this outlet");
  return tableId;
}

async function newBillIn(tx: PoolClient, o: Outlet, input: { tableId: string | null; label: string; splitFrom?: string }, userId: string): Promise<string> {
  // numbers per outlet without gaps between parallel openings
  await tx.query("select 1 from outlets where id = $1 for update", [o.id]);
  const n = (await tx.query<{ n: number }>("select coalesce(max(number), 0)::int + 1 as n from outlet_bills where outlet_id = $1", [o.id])).rows[0]!.n;
  return (await tx.query<{ id: string }>(
    "insert into outlet_bills (outlet_id, property_id, number, table_id, label, split_from, opened_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [o.id, o.propertyId, n, input.tableId, input.label.trim().slice(0, 60), input.splitFrom ?? null, userId],
  )).rows[0]!.id;
}

/** Open a bill at a table, or for a guest or walk-in without one. */
export async function openOutletBill(pool: Pool, schema: string, outletId: string, input: { tableId: string | null; label: string }, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    need(viewer, "serve_outlet", o.propertyId);
    if (!o.active) throw new Error("The outlet is closed");
    return newBillIn(tx, o, { tableId: await tableOf(tx, o.id, input.tableId), label: input.label }, viewer.userId);
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
}

export interface OutletBillView {
  id: string;
  number: number;
  outlet: Outlet;
  tableId: string | null;
  table: string | null;
  label: string;
  status: "open" | "paid" | "invoiced";
  lines: BillLine[];
  total: number;
  /** The Receipt of a bill paid on the spot. */
  receiptToken: string | null;
  invoiceId: string | null;
}

export async function outletBill(pool: Pool, schema: string, billId: string, viewer: Viewer): Promise<OutletBillView> {
  return withTenant(pool, schema, async (tx) => {
    const b = await billIn(tx, billId);
    if (!can(viewer.actor, "serve_outlet", b.property_id) && !can(viewer.actor, "outlet_cash", b.property_id)) throw new Error("Not allowed at this outlet");
    const head = (await tx.query<{ table: string | null; label: string; receipt: string | null; invoice: string | null }>(
      `select t.name as table, b.label,
         (select rc.token from folios f join payments p on p.folio_id = f.id join receipts rc on rc.payment_id = p.id where f.outlet_bill_id = b.id limit 1) as receipt,
         (select i.id from folios f join invoices i on i.folio_id = f.id where f.outlet_bill_id = b.id and i.cancelled_by is null limit 1) as invoice
       from outlet_bills b left join outlet_tables t on t.id = b.table_id where b.id = $1`,
      [b.id],
    )).rows[0]!;
    const lines = await linesOf(tx, b.id);
    return { id: b.id, number: b.number, outlet: b.outlet, tableId: b.table_id, table: head.table, label: head.label, status: b.status as OutletBillView["status"], lines, total: billTotal(lines), receiptToken: head.receipt, invoiceId: head.invoice };
  });
}

async function linesOf(tx: PoolClient, billId: string): Promise<BillLine[]> {
  return (await tx.query<{ id: string; description: string; quantity: number; unit_price: string; amount: string; modifiers: Modifier[]; note: string; printer_id: string | null; round: number | null }>(
    `select l.id, l.description, l.quantity, l.unit_price, l.amount, l.modifiers, l.note, l.printer_id, r.number as round
     from outlet_bill_lines l left join outlet_rounds r on r.id = l.round_id where l.bill_id = $1 order by l.created_at, l.id`,
    [billId],
  )).rows.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: Number(l.unit_price), amount: Number(l.amount), modifiers: l.modifiers, note: l.note, printerId: l.printer_id, round: l.round }));
}

/** Add an item of the outlet's menu with its modifiers; it waits for the next order round. */
export async function addBillItem(pool: Pool, schema: string, billId: string, input: { menuItemId: string; quantity: number; modifiers: string[]; note: string }, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    if (!isUuid(input.menuItemId)) throw new Error("Menu item not found");
    const item = (await tx.query<{ id: string; service_id: string; name: string; price: string; printer_id: string | null; modifiers: Modifier[] }>(
      "select id, service_id, name, price, printer_id, modifiers from outlet_menu_items where id = $1 and outlet_id = $2 and active",
      [input.menuItemId, b.outlet_id],
    )).rows[0];
    if (!item) throw new Error("Menu item not found at this outlet");
    const line = lineFor({ name: item.name, price: Number(item.price), modifiers: item.modifiers }, Number(input.quantity), input.modifiers, input.note);
    return (await tx.query<{ id: string }>(
      `insert into outlet_bill_lines (bill_id, menu_item_id, service_id, description, quantity, unit_price, amount, modifiers, note, printer_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [b.id, item.id, item.service_id, line.description, line.quantity, line.unitPrice, line.amount, JSON.stringify(line.modifiers), line.note, item.printer_id, viewer.userId],
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
export async function sendOrderRound(pool: Pool, schema: string, billId: string, viewer: Viewer & { name: string }): Promise<{ round: number | null; jobs: number }> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    const open = (await tx.query<{ id: string; description: string; quantity: number; modifiers: Modifier[]; note: string; printer_id: string | null; printer_active: boolean | null }>(
      `select l.id, l.description, l.quantity, l.modifiers, l.note, l.printer_id, p.active as printer_active
       from outlet_bill_lines l left join outlet_printers p on p.id = l.printer_id where l.bill_id = $1 and l.round_id is null order by l.created_at, l.id`,
      [b.id],
    )).rows;
    if (!open.length) return { round: null, jobs: 0 };
    const number = (await tx.query<{ n: number }>("select coalesce(max(number), 0)::int + 1 as n from outlet_rounds where bill_id = $1", [b.id])).rows[0]!.n;
    const round = (await tx.query<{ id: string; sent_at: Date }>("insert into outlet_rounds (bill_id, number, sent_by) values ($1, $2, $3) returning id, sent_at", [b.id, number, viewer.userId])).rows[0]!;
    await tx.query("update outlet_bill_lines set round_id = $2 where id = any($1::uuid[])", [open.map((l) => l.id), round.id]);
    const table = b.table_id ? (await tx.query<{ name: string }>("select name from outlet_tables where id = $1", [b.table_id])).rows[0]!.name : null;
    const tickets = ticketsFor(
      { outlet: b.outlet.name, table, bill: b.number, round: number, waiter: viewer.name.slice(0, 40), at: round.sent_at.toISOString() },
      // a printer switched off prints nothing
      open.map((l) => ({ printerId: l.printer_active ? l.printer_id : null, description: l.description, quantity: l.quantity, modifiers: l.modifiers, note: l.note })),
    );
    for (const t of tickets) await tx.query("insert into print_jobs (outlet_id, printer_id, round_id, ticket) values ($1, $2, $3, $4)", [b.outlet_id, t.printerId, round.id, JSON.stringify(t)]);
    return { round: number, jobs: tickets.length };
  });
}

/** Split: the chosen items move to a new bill at the same table; both totals together stay what the bill was. */
export async function splitOutletBill(pool: Pool, schema: string, billId: string, lineIds: string[], viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const b = await openBillIn(tx, billId, viewer);
    const own = (await tx.query<{ id: string }>("select id from outlet_bill_lines where bill_id = $1", [b.id])).rows.map((l) => l.id);
    const moving = [...new Set(lineIds)];
    if (!splitIsValid(own, moving)) throw new Error("Choose items of this bill to move");
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

/** The bill's items as Charges on its own folio, on the Business Date (revenue like any other). */
async function postBillIn(tx: PoolClient, b: BillRow, billTo: { companyId: string } | null, userId: string): Promise<{ folioId: string; total: number }> {
  const lines = (await tx.query<{ id: string; service_id: string; description: string; quantity: number; unit_price: string; amount: string; modifiers: Modifier[]; printer_id: string | null; round_id: string | null }>(
    "select id, service_id, description, quantity, unit_price, amount, modifiers, printer_id, round_id from outlet_bill_lines where bill_id = $1 order by created_at, id",
    [b.id],
  )).rows;
  if (!lines.length) throw new Error("The bill has no items");
  if (lines.some((l) => l.printer_id && !l.round_id)) throw new Error("Send the open items to the printers first");
  const date = (await tx.query<{ d: string }>("select to_char(coalesce(business_date, (now() at time zone time_zone)::date), 'YYYY-MM-DD') as d from properties where id = $1", [b.property_id])).rows[0]!.d;
  const folioId = (await tx.query<{ id: string }>("insert into folios (outlet_bill_id, number, bill_to_company_id, created_by) values ($1, 1, $2, $3) returning id", [b.id, billTo?.companyId ?? null, userId])).rows[0]!.id;
  for (const l of lines) {
    const s = (await tx.query<{ tax_code_id: string; revenue_account: string }>("select tax_code_id, revenue_account from services where id = $1", [l.service_id])).rows[0]!;
    const description = l.modifiers.length ? `${l.description} (${l.modifiers.map((m) => m.name).join(", ")})` : l.description;
    const id = (await tx.query<{ id: string }>(
      `insert into charges (folio_id, reservation_id, property_id, service_id, description, service_date, quantity, unit_price, amount, tax_code_id, tax_rate, revenue_account, category, origin, posted_by)
       values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'extras', 'outlet', $12) returning id`,
      [folioId, b.property_id, l.service_id, description.slice(0, 200), date, l.quantity, l.unit_price, l.amount, s.tax_code_id, await rateOn(tx, s.tax_code_id, date), s.revenue_account, userId],
    )).rows[0]!.id;
    await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'post', $3)", [id, userId, JSON.stringify({ folioId, outletBillId: b.id })]);
  }
  return { folioId, total: billTotal(lines.map((l) => ({ amount: Number(l.amount) }))) };
}

/**
 * The Outlet Sale paid in cash: into the Cash Book of the user's open Shift
 * on the outlet's Cash Register, with a Receipt (signed in Germany and
 * Austria like any payment); an optional customer name.
 */
export async function payOutletBillCash(pool: Pool, schema: string, billId: string, input: { customerName: string }, viewer: Viewer): Promise<{ paymentId: string; receiptToken: string; total: number }> {
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
    const b = await openBillIn(tx, billId, viewer, "outlet_cash");
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
 * five tries) and ones another device took over a minute ago without
 * answering. Taken jobs are not handed out twice meanwhile.
 */
export async function takePrintJobs(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<PrintJob[]> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    if (!can(viewer.actor, "serve_outlet", o.propertyId) && !can(viewer.actor, "outlet_cash", o.propertyId)) throw new Error("Not allowed at this outlet");
    const rows = (await tx.query<{ id: string; printer_id: string; name: string; address: string; ticket: PrintTicket; attempts: number }>(
      `update print_jobs j set status = 'printing', claimed_at = clock_timestamp(), attempts = j.attempts + 1
       from outlet_printers p
       where p.id = j.printer_id and j.id in (
         select id from print_jobs where outlet_id = $1
           and (status = 'pending' or (status = 'failed' and attempts < 5) or (status = 'printing' and claimed_at < clock_timestamp() - interval '1 minute'))
         order by created_at limit 20 for update skip locked)
       returning j.id, j.printer_id, p.name, p.address, j.ticket, j.attempts`,
      [o.id],
    )).rows;
    return rows.map((r) => ({ id: r.id, printerId: r.printer_id, printerName: r.name, address: r.address, text: ticketText(r.ticket), ticket: r.ticket, attempts: r.attempts }));
  });
}

/** The device's answer for a job: printed, or failed with the printer's error (tried again). */
export async function reportPrintJob(pool: Pool, schema: string, jobId: string, result: { ok: boolean; error?: string | undefined }, viewer: Viewer): Promise<void> {
  if (!isUuid(jobId)) throw new Error("Print job not found");
  await withTenant(pool, schema, async (tx) => {
    const j = (await tx.query<{ outlet_id: string; property_id: string }>("select j.outlet_id, o.property_id from print_jobs j join outlets o on o.id = j.outlet_id where j.id = $1", [jobId])).rows[0];
    if (!j) throw new Error("Print job not found");
    if (!can(viewer.actor, "serve_outlet", j.property_id) && !can(viewer.actor, "outlet_cash", j.property_id)) throw new Error("Not allowed at this outlet");
    await tx.query(result.ok ? "update print_jobs set status = 'printed', printed_at = clock_timestamp(), error = null where id = $1" : "update print_jobs set status = 'failed', error = $2 where id = $1", result.ok ? [jobId] : [jobId, (result.error ?? "").slice(0, 300)]);
  });
}

/** Jobs that failed five times: shown to staff to print again by hand. */
export async function failedPrintJobs(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<PrintJob[]> {
  return withTenant(pool, schema, async (tx) => {
    const o = await outletIn(tx, outletId);
    if (!can(viewer.actor, "serve_outlet", o.propertyId) && !can(viewer.actor, "outlet_cash", o.propertyId)) throw new Error("Not allowed at this outlet");
    const rows = (await tx.query<{ id: string; printer_id: string; name: string; address: string; ticket: PrintTicket; attempts: number }>(
      "select j.id, j.printer_id, p.name, p.address, j.ticket, j.attempts from print_jobs j join outlet_printers p on p.id = j.printer_id where j.outlet_id = $1 and j.status = 'failed' and j.attempts >= 5 order by j.created_at desc limit 20",
      [o.id],
    )).rows;
    return rows.map((r) => ({ id: r.id, printerId: r.printer_id, printerName: r.name, address: r.address, text: ticketText(r.ticket), ticket: r.ticket, attempts: r.attempts }));
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
