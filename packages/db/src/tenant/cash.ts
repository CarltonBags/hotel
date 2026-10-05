import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { can, cashBookBalance, closeCount, countTotal, movementSign, paidOutNeedsApproval, roundMoney, type CashCount, type CashMovementKind } from "@hoteloftware/domain";
import { useApproval } from "./approvals";
import { isUuid } from "./catalogue-common";
import type { Viewer } from "./room-state";
import { receiptFiscalIn, recordFiscalIn, type ReceiptFiscal } from "./fiscal";
import { withTenant } from "./with-tenant";

/**
 * The cash desk (ticket 50, ADR 0013): a property switches it on and keeps
 * Cash Registers. A user opens a Shift with a counted float and closes it
 * with a blind count; the difference is booked, above the tolerance with a
 * reason. Every movement goes into the register's Cash Book, which is never
 * changed afterwards. Each desk payment gets a Receipt.
 */

export interface CashSettings {
  enabled: boolean;
  tolerance: number;
  paidOutLimit: number;
  differenceAccount: string;
  currency: string;
}

async function settingsOf(tx: PoolClient, propertyId: string): Promise<CashSettings> {
  const p = (await tx.query<{ cash_desk: boolean; cash_tolerance: string; paid_out_limit: string; cash_difference_account: string; currency: string }>(
    "select cash_desk, cash_tolerance, paid_out_limit, cash_difference_account, currency from properties where id = $1",
    [propertyId],
  )).rows[0];
  if (!p) throw new Error("Property not found");
  return { enabled: p.cash_desk, tolerance: Number(p.cash_tolerance), paidOutLimit: Number(p.paid_out_limit), differenceAccount: p.cash_difference_account, currency: p.currency.trim() };
}

export async function cashSettings(pool: Pool, schema: string, propertyId: string): Promise<CashSettings> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, (tx) => settingsOf(tx, propertyId));
}

/** The property's cash desk: on or off, the count tolerance, the Paid-out limit and the cash-difference account. */
export async function setCashDesk(pool: Pool, schema: string, propertyId: string, input: Omit<CashSettings, "currency">): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  if (!(input.tolerance >= 0) || !(input.paidOutLimit >= 0)) throw new Error("Tolerance and Paid-out limit are zero or more");
  if (input.enabled && !input.differenceAccount.trim()) throw new Error("Give the cash-difference account the differences are booked to");
  await withTenant(pool, schema, async (tx) => {
    if (!input.enabled) {
      const open = await tx.query("select 1 from cash_shifts where property_id = $1 and closed_at is null limit 1", [propertyId]);
      if (open.rowCount) throw new Error("Close every open Shift before switching the cash desk off");
    }
    await tx.query("update properties set cash_desk = $2, cash_tolerance = $3, paid_out_limit = $4, cash_difference_account = $5 where id = $1", [
      propertyId,
      input.enabled,
      roundMoney(input.tolerance),
      roundMoney(input.paidOutLimit),
      input.differenceAccount.trim().slice(0, 20),
    ]);
  });
}

/** The desk's Receipt printer (Austria requires one, ticket 52): a name or network address. */
export async function setReceiptPrinter(pool: Pool, schema: string, propertyId: string, printer: string): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  await withTenant(pool, schema, (tx) => tx.query("update properties set receipt_printer = $2 where id = $1", [propertyId, printer.trim().slice(0, 120)]));
}

export async function receiptPrinterOf(pool: Pool, schema: string, propertyId: string): Promise<string> {
  if (!isUuid(propertyId)) return "";
  return withTenant(pool, schema, async (tx) => (await tx.query<{ p: string }>("select receipt_printer as p from properties where id = $1", [propertyId])).rows[0]?.p ?? "");
}

export interface CashRegister {
  id: string;
  name: string;
  active: boolean;
  balance: number;
  openShift: { id: string; userId: string; openedAt: Date } | null;
}

export async function listCashRegisters(pool: Pool, schema: string, propertyId: string): Promise<CashRegister[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string; active: boolean; balance: string; shift_id: string | null; user_id: string | null; opened_at: Date | null }>(
      `select g.id, g.name, g.active, coalesce((select sum(m.amount) from cash_movements m where m.register_id = g.id), 0) as balance, s.id as shift_id, s.user_id, s.opened_at
       from cash_registers g left join cash_shifts s on s.register_id = g.id and s.closed_at is null
       where g.property_id = $1 order by g.active desc, g.name`,
      [propertyId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, balance: Number(r.balance), openShift: r.shift_id ? { id: r.shift_id, userId: r.user_id!, openedAt: r.opened_at! } : null }));
  });
}

export async function createCashRegister(pool: Pool, schema: string, propertyId: string, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new Error("Name the register (up to 60 characters)");
  return withTenant(pool, schema, async (tx) => {
    const exists = await tx.query("select 1 from cash_registers where property_id = $1 and name = $2", [propertyId, clean]);
    if (exists.rowCount) throw new Error(`A register named ${clean} exists already`);
    return (await tx.query<{ id: string }>("insert into cash_registers (property_id, name) values ($1, $2) returning id", [propertyId, clean])).rows[0]!.id;
  });
}

/** Take a register out of use (it keeps its Cash Book) or back. */
export async function setCashRegisterActive(pool: Pool, schema: string, propertyId: string, registerId: string, active: boolean): Promise<void> {
  if (!isUuid(registerId)) throw new Error("Register not found");
  await withTenant(pool, schema, async (tx) => {
    const r = await lockRegister(tx, registerId, propertyId);
    if (!active && r.openShift) throw new Error("Close the register's open Shift first");
    await tx.query("update cash_registers set active = $2 where id = $1", [registerId, active]);
  });
}

interface LockedRegister {
  id: string;
  propertyId: string;
  name: string;
  active: boolean;
  balance: number;
  openShift: { id: string; userId: string; counted: boolean } | null;
}

/** The register, locked: movements of one register are written one after the other. */
async function lockRegister(tx: PoolClient, registerId: string, propertyId?: string): Promise<LockedRegister> {
  const r = (await tx.query<{ id: string; property_id: string; name: string; active: boolean }>("select id, property_id, name, active from cash_registers where id = $1 for update", [registerId])).rows[0];
  if (!r || (propertyId && r.property_id !== propertyId)) throw new Error("Register not found");
  const balance = Number((await tx.query<{ b: string }>("select coalesce(sum(amount), 0) as b from cash_movements where register_id = $1", [r.id])).rows[0]!.b);
  const shift = (await tx.query<{ id: string; user_id: string; counted: boolean }>("select id, user_id, counted_at is not null as counted from cash_shifts where register_id = $1 and closed_at is null", [r.id])).rows[0];
  return { id: r.id, propertyId: r.property_id, name: r.name, active: r.active, balance, openShift: shift ? { id: shift.id, userId: shift.user_id, counted: shift.counted } : null };
}

async function book(
  tx: PoolClient,
  m: { registerId: string; propertyId: string; shiftId: string | null; kind: CashMovementKind; amount: number; userId: string; paymentId?: string; voucherId?: string; counterpart?: string; reason?: string; account?: string; photo?: { bytes: Buffer; type: string } | null; approvedBy?: string | null },
): Promise<void> {
  await tx.query(
    `insert into cash_movements (register_id, property_id, shift_id, kind, amount, payment_id, counterpart_register_id, reason, account, receipt_photo, receipt_photo_type, approved_by, by_user, voucher_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [m.registerId, m.propertyId, m.shiftId, m.kind, roundMoney(m.amount), m.paymentId ?? null, m.counterpart ?? null, m.reason ?? "", m.account ?? "", m.photo?.bytes ?? null, m.photo?.type ?? null, m.approvedBy ?? null, m.userId, m.voucherId ?? null],
  );
}

export interface OpenShift {
  id: string;
  registerId: string;
  registerName: string;
  openedAt: Date;
  openingFloat: number;
  /** Once the close count is entered (it then waits for a reason): what was counted and expected. */
  count: { counted: number; expected: number; difference: number } | null;
}

/** The user's open Shift at the property, if any. */
export async function myOpenShift(pool: Pool, schema: string, propertyId: string, userId: string): Promise<OpenShift | null> {
  if (!isUuid(propertyId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const s = (await tx.query<{ id: string; register_id: string; name: string; opened_at: Date; opening_float: string; counted: string | null; expected: string | null; difference: string | null }>(
      `select s.id, s.register_id, g.name, s.opened_at, s.opening_float, s.counted, s.expected, s.difference
       from cash_shifts s join cash_registers g on g.id = s.register_id where s.property_id = $1 and s.user_id = $2 and s.closed_at is null`,
      [propertyId, userId],
    )).rows[0];
    if (!s) return null;
    // the expected amount only once the count is entered: the count is blind
    const count = s.counted === null ? null : { counted: Number(s.counted), expected: Number(s.expected), difference: Number(s.difference) };
    return { id: s.id, registerId: s.register_id, registerName: s.name, openedAt: s.opened_at, openingFloat: Number(s.opening_float), count };
  });
}

/**
 * Open a Shift on a register with the counted float. When the count differs
 * from what the Cash Book says is in the register, the difference is booked
 * (the first Shift of a new register books the float itself).
 */
/** The opening count differs from the Cash Book by more than the tolerance: a reason is needed to open. */
export class OpeningDifference extends Error {
  constructor(readonly difference: number) {
    super(`The count differs from the Cash Book by ${difference.toFixed(2)}; give the reason to open the Shift`);
    this.name = "OpeningDifference";
  }
}

export async function openShift(pool: Pool, schema: string, input: { registerId: string; count: CashCount; reason?: string | null }, viewer: Viewer): Promise<{ shiftId: string; difference: number }> {
  if (!isUuid(input.registerId)) throw new Error("Register not found");
  return withTenant(pool, schema, async (tx) => {
    const r = await lockRegister(tx, input.registerId);
    // an outlet's register is opened by its staff (ticket 60), the desk's by the desk
    const atOutlet = (await tx.query("select 1 from outlets where cash_register_id = $1", [r.id])).rows.length > 0;
    if (!can(viewer.actor, atOutlet ? "outlet_cash" : "handle_cash", r.propertyId)) throw new Error("Not allowed to open a Shift");
    const settings = await settingsOf(tx, r.propertyId);
    if (!settings.enabled) throw new Error("The cash desk is off at this property");
    if (!r.active) throw new Error("This register is not in use");
    if (r.openShift) throw new Error(`${r.name} has an open Shift`);
    const mine = await tx.query("select 1 from cash_shifts where property_id = $1 and user_id = $2 and closed_at is null", [r.propertyId, viewer.userId]);
    if (mine.rowCount) throw new Error("You have an open Shift on another register; close it first");
    const float = countTotal(settings.currency, input.count);
    const first = !(await tx.query("select 1 from cash_movements where register_id = $1 limit 1", [r.id])).rowCount;
    // like the close count, a difference above the tolerance needs a reason (the caller tells the Property Manager)
    const difference = first ? 0 : roundMoney(float - r.balance);
    const reason = String(input.reason ?? "").trim().slice(0, 300);
    if (closeCount({ expected: r.balance, counted: float, tolerance: settings.tolerance }).needsReason && !first && !reason) throw new OpeningDifference(difference);
    const { rows } = await tx.query<{ id: string }>("insert into cash_shifts (register_id, property_id, user_id, opening_count, opening_float) values ($1, $2, $3, $4, $5) returning id", [
      r.id,
      r.propertyId,
      viewer.userId,
      JSON.stringify(input.count),
      float,
    ]);
    const shiftId = rows[0]!.id;
    if (first) await book(tx, { registerId: r.id, propertyId: r.propertyId, shiftId, kind: "float", amount: float, userId: viewer.userId, reason: "Opening float" });
    else if (difference !== 0)
      await book(tx, { registerId: r.id, propertyId: r.propertyId, shiftId, kind: "difference", amount: difference, userId: viewer.userId, reason: reason || "Opening count", account: settings.differenceAccount });
    return { shiftId, difference };
  });
}

/**
 * The user's open Shift, locked after its register (the order every cash
 * writer takes): its count and close are decided one at a time.
 */
async function lockedShift(tx: PoolClient, shiftId: string, userId: string) {
  const at = (await tx.query<{ register_id: string }>("select register_id from cash_shifts where id = $1", [shiftId])).rows[0];
  if (!at) throw new Error("Shift not found");
  const register = await lockRegister(tx, at.register_id);
  const s = (await tx.query<{ id: string; register_id: string; property_id: string; user_id: string; counted_at: Date | null; closed_at: Date | null; difference: string | null }>(
    "select id, register_id, property_id, user_id, counted_at, closed_at, difference from cash_shifts where id = $1 for update",
    [shiftId],
  )).rows[0]!;
  if (s.user_id !== userId) throw new Error("Shift not found");
  if (s.closed_at) throw new Error("The Shift is closed");
  return { ...s, register };
}

export interface CloseResult {
  expected: number;
  counted: number;
  difference: number;
  needsReason: boolean;
  closed: boolean;
}

async function closeShiftIn(tx: PoolClient, shift: { id: string; register_id: string; property_id: string }, difference: number, reason: string | null, viewer: Viewer, account: string): Promise<void> {
  if (difference !== 0) await book(tx, { registerId: shift.register_id, propertyId: shift.property_id, shiftId: shift.id, kind: "difference", amount: difference, userId: viewer.userId, reason: reason ?? "Close count", account });
  await tx.query("update cash_shifts set closed_at = clock_timestamp(), reason = $2 where id = $1", [shift.id, reason]);
}

/**
 * The blind close count: entered once, then the expected amount and the
 * difference are shown. Within the tolerance the Shift closes at once and
 * the difference is booked; above it the Shift waits for a reason.
 */
export async function submitCloseCount(pool: Pool, schema: string, input: { shiftId: string; count: CashCount }, viewer: Viewer): Promise<CloseResult> {
  if (!isUuid(input.shiftId)) throw new Error("Shift not found");
  return withTenant(pool, schema, async (tx) => {
    const s = await lockedShift(tx, input.shiftId, viewer.userId);
    if (s.counted_at) throw new Error("The count is entered already; give the reason for the difference");
    const r = s.register;
    const settings = await settingsOf(tx, s.property_id);
    const counted = countTotal(settings.currency, input.count);
    const verdict = closeCount({ expected: r.balance, counted, tolerance: settings.tolerance });
    await tx.query("update cash_shifts set counted_at = clock_timestamp(), close_count = $2, counted = $3, expected = $4, difference = $5 where id = $1", [
      s.id,
      JSON.stringify(input.count),
      counted,
      r.balance,
      verdict.difference,
    ]);
    if (!verdict.needsReason) await closeShiftIn(tx, s, verdict.difference, null, viewer, settings.differenceAccount);
    return { expected: r.balance, counted, difference: verdict.difference, needsReason: verdict.needsReason, closed: !verdict.needsReason };
  });
}

/** Close a counted Shift whose difference is above the tolerance, with the reason. The caller tells the Property Manager. */
export async function closeShiftWithReason(pool: Pool, schema: string, input: { shiftId: string; reason: string }, viewer: Viewer): Promise<{ difference: number; propertyId: string; registerName: string }> {
  if (!isUuid(input.shiftId)) throw new Error("Shift not found");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("Say why the count differs");
  return withTenant(pool, schema, async (tx) => {
    const s = await lockedShift(tx, input.shiftId, viewer.userId);
    if (!s.counted_at) throw new Error("Count the register first");
    const r = s.register;
    const settings = await settingsOf(tx, s.property_id);
    const difference = Number(s.difference);
    await closeShiftIn(tx, s, difference, reason, viewer, settings.differenceAccount);
    return { difference, propertyId: s.property_id, registerName: r.name };
  });
}

/** A photo of a paper receipt, as a data URL from the browser. */
function decodePhoto(photo: string | null | undefined): { bytes: Buffer; type: string } | null {
  if (!photo) return null;
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(photo);
  if (!m || photo.length > 2_000_000) throw new Error("The receipt photo must be a JPEG or PNG under 1.5 MB");
  return { bytes: Buffer.from(m[2]!, "base64"), type: m[1]! };
}

export type CashMovementInput =
  | { kind: "paid_out"; registerId: string; amount: number; reason: string; account: string; photo?: string | null }
  | { kind: "tip_out"; registerId: string; amount: number; reason: string }
  | { kind: "deposit" | "change_in"; registerId: string; amount: number; reason: string }
  | { kind: "transfer"; registerId: string; toRegisterId: string; amount: number; reason: string };

/**
 * A movement other than a guest payment. Paid-outs and tips paid out come
 * from the user's own open Shift on the register; a Paid-out above the
 * property limit needs a Property Manager's Approval. Bank deposits, change
 * money and transfers between registers are for the Property Manager and
 * Accounting.
 */
export async function recordCashMovement(pool: Pool, schema: string, input: CashMovementInput, viewer: Viewer & { approverId?: string | null }): Promise<void> {
  if (!isUuid(input.registerId)) throw new Error("Register not found");
  const amount = roundMoney(Number(input.amount));
  if (!(amount > 0) || amount > 1_000_000) throw new Error("The amount must be more than zero");
  const reason = String(input.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new Error("Give a reason");
  await withTenant(pool, schema, async (tx) => {
    // two registers are locked in a fixed order
    const ids = input.kind === "transfer" ? [input.registerId, input.toRegisterId].sort() : [input.registerId];
    if (input.kind === "transfer" && (!isUuid(input.toRegisterId) || input.toRegisterId === input.registerId)) throw new Error("Choose another register to transfer to");
    const locked = new Map<string, LockedRegister>();
    for (const id of ids) locked.set(id, await lockRegister(tx, id));
    const r = locked.get(input.registerId)!;
    const settings = await settingsOf(tx, r.propertyId);
    if (!settings.enabled) throw new Error("The cash desk is off at this property");
    // once a Shift's close count is entered, no cash moves until it is closed
    for (const x of locked.values()) if (x.openShift?.counted) throw new Error(`${x.name} is counted for closing; close the Shift first`);
    const base = { registerId: r.id, propertyId: r.propertyId, userId: viewer.userId, reason };
    if (input.kind === "paid_out" || input.kind === "tip_out") {
      if (!can(viewer.actor, input.kind === "paid_out" ? "paid_out" : "handle_cash", r.propertyId)) throw new Error("Not allowed");
      if (r.openShift?.userId !== viewer.userId) throw new Error(`Open your Shift on ${r.name} first`);
      // the desk does not learn the register's balance before its blind close count
      if (amount > r.balance) throw new Error(`There is not that much cash in ${r.name}`);
      let approvedBy: string | null = null;
      let account = "";
      let photo = null;
      if (input.kind === "paid_out") {
        account = String(input.account ?? "").trim().slice(0, 20);
        if (!account) throw new Error("Give the expense account");
        photo = decodePhoto(input.photo);
        if (!photo) throw new Error("Take a photo of the receipt");
        if (paidOutNeedsApproval(amount, settings.paidOutLimit, can(viewer.actor, "paid_out_without_limit", r.propertyId)))
          approvedBy = await useApproval(
            tx,
            {
              kind: "paid_out_over_limit",
              propertyId: r.propertyId,
              key: `${r.id}:${amount.toFixed(2)}:${reason}`,
              summary: `Paid-out of ${amount.toFixed(2)} ${settings.currency} from ${r.name} for "${reason}" (above the limit of ${settings.paidOutLimit.toFixed(2)})`,
              recordId: null,
            },
            viewer,
          );
      }
      await book(tx, { ...base, shiftId: r.openShift.id, kind: input.kind, amount: movementSign(input.kind) * amount, account, photo, approvedBy });
      return;
    }
    if (!can(viewer.actor, "manage_cash", r.propertyId)) throw new Error("Not allowed");
    if (input.kind === "transfer") {
      const to = locked.get(input.toRegisterId)!;
      if (to.propertyId !== r.propertyId) throw new Error("Register not found");
      if (amount > r.balance) throw new Error(`Only ${r.balance.toFixed(2)} ${settings.currency} is in ${r.name}`);
      await book(tx, { ...base, shiftId: r.openShift?.id ?? null, kind: "transfer_out", amount: -amount, counterpart: to.id });
      await book(tx, { ...base, registerId: to.id, shiftId: to.openShift?.id ?? null, kind: "transfer_in", amount, counterpart: r.id });
      return;
    }
    if (input.kind === "deposit" && amount > r.balance) throw new Error(`Only ${r.balance.toFixed(2)} ${settings.currency} is in ${r.name}`);
    await book(tx, { ...base, shiftId: r.openShift?.id ?? null, kind: input.kind, amount: movementSign(input.kind) * amount });
  });
}

/**
 * A guest's cash payment or refund, in the payment's transaction: into the
 * Cash Book of the register of the user's open Shift. Without an open Shift
 * there is no cash at the desk.
 */
export async function bookCashPaymentIn(tx: PoolClient, payment: { id: string; propertyId: string; amount: number }, userId: string): Promise<string> {
  return bookCashIn(tx, { propertyId: payment.propertyId, amount: payment.amount, paymentId: payment.id, kind: payment.amount > 0 ? "payment" : "refund" }, userId);
}

/** A Voucher sold for cash (ticket 53): into the Cash Book of the user's open Shift, booked to the Legal Entity's liability account. */
export async function bookVoucherSaleIn(tx: PoolClient, voucher: { id: string; propertyId: string; amount: number; account: string }, userId: string): Promise<string> {
  return bookCashIn(tx, { propertyId: voucher.propertyId, amount: voucher.amount, voucherId: voucher.id, kind: "voucher_sale", account: voucher.account, reason: "Wertgutschein" }, userId);
}

async function bookCashIn(tx: PoolClient, m: { propertyId: string; amount: number; kind: CashMovementKind; paymentId?: string; voucherId?: string; account?: string; reason?: string }, userId: string): Promise<string> {
  const payment = m;
  const settings = await settingsOf(tx, payment.propertyId);
  if (!settings.enabled) throw new Error("The cash desk is off at this property");
  const shift = (await tx.query<{ id: string; register_id: string }>("select id, register_id from cash_shifts where property_id = $1 and user_id = $2 and closed_at is null", [payment.propertyId, userId])).rows[0];
  if (!shift) throw new Error("Open your Shift on a Cash Register to take or give back cash");
  const r = await lockRegister(tx, shift.register_id);
  // decided under the register's lock: the Shift may have been counted or closed meanwhile
  if (r.openShift?.id !== shift.id) throw new Error("Open your Shift on a Cash Register to take or give back cash");
  if (r.openShift.counted) throw new Error("Your Shift is counted for closing; close it and open a new one");
  if (payment.amount < 0 && -payment.amount > r.balance) throw new Error(`There is not that much cash in ${r.name}`);
  const { kind, amount, paymentId, voucherId, account, reason } = m;
  await book(tx, { registerId: r.id, propertyId: m.propertyId, shiftId: shift.id, kind, amount, userId, ...(paymentId ? { paymentId } : {}), ...(voucherId ? { voucherId } : {}), ...(account ? { account } : {}), ...(reason ? { reason } : {}) });
  return r.id;
}

/** A Receipt for a desk payment, numbered without gaps per property, in the payment's transaction. */
export async function issueReceiptIn(tx: PoolClient, payment: { id: string; propertyId: string }, registerId: string | null, userId: string): Promise<void> {
  await issueIn(tx, { paymentId: payment.id, propertyId: payment.propertyId }, registerId, userId);
}

/** A Receipt for a Voucher sold (ticket 53), in the sale's transaction. */
export async function issueVoucherReceiptIn(tx: PoolClient, voucher: { id: string; propertyId: string }, registerId: string | null, userId: string): Promise<string> {
  return issueIn(tx, { voucherId: voucher.id, propertyId: voucher.propertyId }, registerId, userId);
}

async function issueIn(tx: PoolClient, subject: { paymentId?: string; voucherId?: string; propertyId: string }, registerId: string | null, userId: string): Promise<string> {
  const payment = subject;
  // one Receipt per payment or sale; a number is taken only for a Receipt that is written
  const had = (await tx.query<{ id: string }>(subject.paymentId ? "select id from receipts where payment_id = $1" : "select id from receipts where voucher_id = $1", [subject.paymentId ?? subject.voucherId])).rows[0];
  if (had) return had.id;
  await tx.query("insert into receipt_numbers (property_id) values ($1) on conflict do nothing", [payment.propertyId]);
  const n = (await tx.query<{ last: number }>("update receipt_numbers set last = last + 1 where property_id = $1 returning last", [payment.propertyId])).rows[0]!.last;
  const receipt = (await tx.query<{ id: string }>("insert into receipts (property_id, number, payment_id, voucher_id, register_id, token, issued_by) values ($1, $2, $3, $4, $5, $6, $7) returning id", [
    payment.propertyId,
    n,
    subject.paymentId ?? null,
    subject.voucherId ?? null,
    registerId,
    randomBytes(18).toString("base64url"),
    userId,
  ])).rows[0]!;
  // Germany: what the TSE is to sign, on the Business Date of the Receipt (ticket 51); signed right after the payment
  await recordFiscalIn(tx, receipt.id);
  return receipt.id;
}

export interface CashBookRow {
  id: string;
  at: Date;
  kind: CashMovementKind;
  amount: number;
  /** Running balance; null for the desk before its close count (the count is blind). */
  balance: number | null;
  reason: string;
  account: string;
  byUser: string;
  approvedBy: string | null;
  shiftId: string | null;
  paymentId: string | null;
  confirmationNumber: string | null;
  hasPhoto: boolean;
}

/**
 * A register's Cash Book with the running balance. The Property Manager and
 * Accounting see every register; the desk sees its own open Shift's part.
 */
export async function cashBook(pool: Pool, schema: string, registerId: string, viewer: Viewer, options: { limit?: number } = {}): Promise<{ registerId: string; name: string; propertyId: string; balance: number | null; rows: CashBookRow[]; ownShiftOnly: boolean }> {
  if (!isUuid(registerId)) throw new Error("Register not found");
  return withTenant(pool, schema, async (tx) => {
    const g = (await tx.query<{ id: string; name: string; property_id: string }>("select id, name, property_id from cash_registers where id = $1", [registerId])).rows[0];
    if (!g) throw new Error("Register not found");
    // an Outlet Manager sees the Cash Books of own outlets' registers (ticket 60)
    const all =
      can(viewer.actor, "manage_cash", g.property_id) ||
      (can(viewer.actor, "manage_own_outlets", g.property_id) && (await tx.query("select 1 from outlets o join outlet_managers m on m.outlet_id = o.id where o.cash_register_id = $1 and m.user_id = $2", [g.id, viewer.userId])).rows.length > 0);
    const own = !all ? (await tx.query<{ id: string; counted: boolean }>("select id, counted_at is not null as counted from cash_shifts where register_id = $1 and user_id = $2 and closed_at is null", [g.id, viewer.userId])).rows[0] : undefined;
    if (!all && !own) throw new Error("Not allowed to see this Cash Book");
    const { rows } = await tx.query<{ id: string; at: Date; kind: CashMovementKind; amount: string; reason: string; account: string; by_user: string; approved_by: string | null; shift_id: string | null; payment_id: string | null; confirmation_number: string | null; has_photo: boolean }>(
      `select m.id, m.at, m.kind, m.amount, m.reason, m.account, m.by_user, m.approved_by, m.shift_id, m.payment_id, b.confirmation_number, m.receipt_photo is not null as has_photo
       from cash_movements m left join payments p on p.id = m.payment_id left join reservations r on r.id = p.reservation_id left join bookings b on b.id = r.booking_id
       where m.register_id = $1 order by m.at, m.id`,
      [g.id],
    );
    const running = cashBookBalance(rows.map((r) => ({ kind: r.kind, amount: Number(r.amount) })));
    const allRows = rows.map((r, i) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      amount: Number(r.amount),
      balance: running.balances[i]!,
      reason: r.reason,
      account: r.account,
      byUser: r.by_user,
      approvedBy: r.approved_by,
      shiftId: r.shift_id,
      paymentId: r.payment_id,
      confirmationNumber: r.confirmation_number,
      hasPhoto: r.has_photo,
    }));
    if (own) {
      // the desk sees its Shift's movements; balances only once its count is entered
      const mine = allRows.filter((r) => r.shiftId === own.id).map((r) => (own.counted ? r : { ...r, balance: null }));
      return { registerId: g.id, name: g.name, propertyId: g.property_id, balance: own.counted ? running.balance : null, rows: mine, ownShiftOnly: true };
    }
    return { registerId: g.id, name: g.name, propertyId: g.property_id, balance: running.balance, rows: allRows.slice(-(options.limit ?? 500)), ownShiftOnly: false };
  });
}

/** The photo of a Paid-out's paper receipt, for whoever may see that Cash Book. */
export async function cashMovementPhoto(pool: Pool, schema: string, movementId: string, viewer: Viewer): Promise<{ bytes: Buffer; type: string } | null> {
  if (!isUuid(movementId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const m = (await tx.query<{ property_id: string; shift_id: string | null; receipt_photo: Buffer | null; receipt_photo_type: string | null }>(
      "select property_id, shift_id, receipt_photo, receipt_photo_type from cash_movements where id = $1",
      [movementId],
    )).rows[0];
    if (!m?.receipt_photo || !m.receipt_photo_type) return null;
    if (!can(viewer.actor, "manage_cash", m.property_id)) {
      const own = m.shift_id ? (await tx.query("select 1 from cash_shifts where id = $1 and user_id = $2 and closed_at is null", [m.shift_id, viewer.userId])).rowCount : 0;
      if (!own) return null;
    }
    return { bytes: m.receipt_photo, type: m.receipt_photo_type };
  });
}

export interface OpenShiftInfo {
  registerName: string;
  userId: string;
  openedAt: Date;
}

/** Shifts still open at the property (the Night Audit warns about them). */
export async function openShiftsIn(tx: PoolClient, propertyId: string): Promise<OpenShiftInfo[]> {
  const { rows } = await tx.query<{ name: string; user_id: string; opened_at: Date }>(
    "select g.name, s.user_id, s.opened_at from cash_shifts s join cash_registers g on g.id = s.register_id where s.property_id = $1 and s.closed_at is null order by g.name",
    [propertyId],
  );
  return rows.map((r) => ({ registerName: r.name, userId: r.user_id, openedAt: r.opened_at }));
}

export interface ReceiptView {
  id: string;
  number: number;
  issuedAt: Date;
  propertyName: string;
  legalEntity: { name: string; addressLine1: string; postalCode: string; city: string; country: string; vatId: string | null };
  amount: number;
  currency: string;
  tender: string;
  cardBrand: string | null;
  cardLast4: string | null;
  refund: boolean;
  /** Null for a Voucher sold. */
  confirmationNumber: string | null;
  /** The stay paid for: the service the Receipt names (null for a Voucher sold). */
  stay: { arrival: string; departure: string } | null;
  /** A Voucher sold (ticket 53): its code's last group. */
  voucherSale: { codeEnd: string } | null;
  /** An Outlet Sale (ticket 60): the outlet, the bill and its items (type and quantity, KassenSichV). */
  outletSale: { outlet: string; bill: number; lines: { description: string; quantity: number; amount: number }[] } | null;
  /** Initial and surname: the Receipt may be opened by anyone holding its code. */
  guestName: string;
  token: string;
  timeZone: string;
  /** Germany: the TSE's signature or the outage notice (ticket 51); null where nothing is signed. */
  fiscal: ReceiptFiscal | null;
}

// a Receipt is of a payment (on a stay) or of a Voucher sold (ticket 53)
const RECEIPT_SELECT = `select rc.id, rc.number, rc.issued_at, rc.token, pr.name as property_name, pr.time_zone, le.name as le_name, le.address_line1, le.postal_code, le.city, le.country, le.vat_id,
    coalesce(p.amount, v.amount) as amount, coalesce(p.currency, v.currency) as currency, coalesce(p.tender, v.tender) as tender, p.card_brand, p.card_last4, p.refund_of is not null as refund,
    b.confirmation_number, coalesce(g.first_name, split_part(v.buyer_name, ' ', 1)) as first_name,
    coalesce(g.last_name, nullif(regexp_replace(v.buyer_name, '^[^ ]+ *', ''), ''), v.buyer_name) as last_name, v.code as voucher_code,
    to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
    p.folio_id, ob.number as outlet_bill, o.name as outlet_name, ob.customer_name
  from receipts rc join properties pr on pr.id = rc.property_id join legal_entities le on le.id = pr.legal_entity_id
  left join payments p on p.id = rc.payment_id left join vouchers v on v.id = rc.voucher_id
  left join reservations r on r.id = p.reservation_id left join bookings b on b.id = r.booking_id left join guests g on g.id = r.primary_guest_id
  left join folios f on f.id = p.folio_id left join outlet_bills ob on ob.id = f.outlet_bill_id left join outlets o on o.id = ob.outlet_id`;

/** An Outlet Sale's items as on its folio. */
async function outletLinesIn(tx: PoolClient, folioId: string): Promise<{ description: string; quantity: number; amount: number }[]> {
  return (await tx.query<{ description: string; quantity: string; amount: string }>("select description, quantity, amount from charges where folio_id = $1 and voided_at is null order by posted_at, id", [folioId])).rows.map((c) => ({ description: c.description, quantity: Number(c.quantity), amount: Number(c.amount) }));
}

function toReceipt(r: Record<string, unknown>, fiscal: ReceiptFiscal | null = null, outletLines: { description: string; quantity: number; amount: number }[] = []): ReceiptView {
  return {
    id: r.id as string,
    number: r.number as number,
    issuedAt: r.issued_at as Date,
    token: r.token as string,
    propertyName: r.property_name as string,
    legalEntity: { name: r.le_name as string, addressLine1: (r.address_line1 as string) ?? "", postalCode: (r.postal_code as string) ?? "", city: (r.city as string) ?? "", country: r.country as string, vatId: (r.vat_id as string | null) ?? null },
    amount: Number(r.amount),
    currency: String(r.currency).trim(),
    tender: r.tender as string,
    cardBrand: (r.card_brand as string | null) ?? null,
    cardLast4: (r.card_last4 as string | null) ?? null,
    refund: r.refund as boolean,
    confirmationNumber: (r.confirmation_number as string | null) ?? null,
    stay: r.arrival ? { arrival: r.arrival as string, departure: r.departure as string } : null,
    voucherSale: r.voucher_code ? { codeEnd: String(r.voucher_code).slice(-4) } : null,
    outletSale: r.outlet_bill ? { outlet: r.outlet_name as string, bill: r.outlet_bill as number, lines: outletLines } : null,
    // an Outlet Sale names its customer only when given
    guestName: r.outlet_bill ? String(r.customer_name ?? "") : `${String(r.first_name ?? "").slice(0, 1)}${r.first_name ? ". " : ""}${r.last_name as string}`.trim(),
    timeZone: r.time_zone as string,
    fiscal,
  };
}

/** A Receipt opened from its code: anyone holding the code may read it. */
export async function receiptByToken(pool: Pool, schema: string, token: string): Promise<ReceiptView | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query(`${RECEIPT_SELECT} where rc.token = $1`, [token])).rows[0];
    return r ? toReceipt(r, await receiptFiscalIn(tx, r.id), r.outlet_bill ? await outletLinesIn(tx, r.folio_id) : []) : null;
  });
}

/** Every Receipt as issued, in number order per property (the exit export, ticket 89). */
export async function allReceiptsIn(tx: PoolClient): Promise<ReceiptView[]> {
  const rows = (await tx.query(`${RECEIPT_SELECT} order by pr.name, rc.number`)).rows;
  return Promise.all(rows.map(async (r) => toReceipt(r, await receiptFiscalIn(tx, r.id), r.outlet_bill ? await outletLinesIn(tx, r.folio_id) : [])));
}

/** The Receipts of a reservation's payments, by payment. */
export async function receiptsOfReservation(pool: Pool, schema: string, reservationId: string): Promise<Record<string, { number: number; token: string }>> {
  if (!isUuid(reservationId)) return {};
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ payment_id: string; number: number; token: string }>(
      "select rc.payment_id, rc.number, rc.token from receipts rc join payments p on p.id = rc.payment_id where p.reservation_id = $1",
      [reservationId],
    );
    return Object.fromEntries(rows.map((r) => [r.payment_id, { number: r.number, token: r.token }]));
  });
}
