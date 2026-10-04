import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { can, cashBookBalance, closeCount, countTotal, movementSign, paidOutNeedsApproval, roundMoney, type CashCount, type CashMovementKind } from "@hoteloftware/domain";
import { useApproval } from "./approvals";
import { isUuid } from "./catalogue-common";
import type { Viewer } from "./room-state";
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
  openShift: { id: string; userId: string } | null;
}

/** The register, locked: movements of one register are written one after the other. */
async function lockRegister(tx: PoolClient, registerId: string, propertyId?: string): Promise<LockedRegister> {
  const r = (await tx.query<{ id: string; property_id: string; name: string; active: boolean }>("select id, property_id, name, active from cash_registers where id = $1 for update", [registerId])).rows[0];
  if (!r || (propertyId && r.property_id !== propertyId)) throw new Error("Register not found");
  const balance = Number((await tx.query<{ b: string }>("select coalesce(sum(amount), 0) as b from cash_movements where register_id = $1", [r.id])).rows[0]!.b);
  const shift = (await tx.query<{ id: string; user_id: string }>("select id, user_id from cash_shifts where register_id = $1 and closed_at is null", [r.id])).rows[0];
  return { id: r.id, propertyId: r.property_id, name: r.name, active: r.active, balance, openShift: shift ? { id: shift.id, userId: shift.user_id } : null };
}

async function book(
  tx: PoolClient,
  m: { registerId: string; propertyId: string; shiftId: string | null; kind: CashMovementKind; amount: number; userId: string; paymentId?: string; counterpart?: string; reason?: string; account?: string; photo?: { bytes: Buffer; type: string } | null; approvedBy?: string | null },
): Promise<void> {
  await tx.query(
    `insert into cash_movements (register_id, property_id, shift_id, kind, amount, payment_id, counterpart_register_id, reason, account, receipt_photo, receipt_photo_type, approved_by, by_user)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [m.registerId, m.propertyId, m.shiftId, m.kind, roundMoney(m.amount), m.paymentId ?? null, m.counterpart ?? null, m.reason ?? "", m.account ?? "", m.photo?.bytes ?? null, m.photo?.type ?? null, m.approvedBy ?? null, m.userId],
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
export async function openShift(pool: Pool, schema: string, input: { registerId: string; count: CashCount }, viewer: Viewer): Promise<string> {
  if (!isUuid(input.registerId)) throw new Error("Register not found");
  return withTenant(pool, schema, async (tx) => {
    const r = await lockRegister(tx, input.registerId);
    if (!can(viewer.actor, "handle_cash", r.propertyId)) throw new Error("Not allowed to open a Shift");
    const settings = await settingsOf(tx, r.propertyId);
    if (!settings.enabled) throw new Error("The cash desk is off at this property");
    if (!r.active) throw new Error("This register is not in use");
    if (r.openShift) throw new Error(`${r.name} has an open Shift`);
    const mine = await tx.query("select 1 from cash_shifts where property_id = $1 and user_id = $2 and closed_at is null", [r.propertyId, viewer.userId]);
    if (mine.rowCount) throw new Error("You have an open Shift on another register; close it first");
    const float = countTotal(settings.currency, input.count);
    const { rows } = await tx.query<{ id: string }>("insert into cash_shifts (register_id, property_id, user_id, opening_count, opening_float) values ($1, $2, $3, $4, $5) returning id", [
      r.id,
      r.propertyId,
      viewer.userId,
      JSON.stringify(input.count),
      float,
    ]);
    const shiftId = rows[0]!.id;
    const first = !(await tx.query("select 1 from cash_movements where register_id = $1 limit 1", [r.id])).rowCount;
    if (first) await book(tx, { registerId: r.id, propertyId: r.propertyId, shiftId, kind: "float", amount: float, userId: viewer.userId, reason: "Opening float" });
    else if (roundMoney(float - r.balance) !== 0)
      await book(tx, { registerId: r.id, propertyId: r.propertyId, shiftId, kind: "difference", amount: float - r.balance, userId: viewer.userId, reason: "Opening count", account: settings.differenceAccount });
    return shiftId;
  });
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
    const s = (await tx.query<{ id: string; register_id: string; property_id: string; user_id: string; counted_at: Date | null; closed_at: Date | null }>(
      "select id, register_id, property_id, user_id, counted_at, closed_at from cash_shifts where id = $1",
      [input.shiftId],
    )).rows[0];
    if (!s || s.user_id !== viewer.userId) throw new Error("Shift not found");
    if (s.closed_at) throw new Error("The Shift is closed");
    if (s.counted_at) throw new Error("The count is entered already; give the reason for the difference");
    const r = await lockRegister(tx, s.register_id);
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
    const s = (await tx.query<{ id: string; register_id: string; property_id: string; user_id: string; counted_at: Date | null; closed_at: Date | null; difference: string | null }>(
      "select id, register_id, property_id, user_id, counted_at, closed_at, difference from cash_shifts where id = $1 for update",
      [input.shiftId],
    )).rows[0];
    if (!s || s.user_id !== viewer.userId) throw new Error("Shift not found");
    if (s.closed_at) throw new Error("The Shift is closed");
    if (!s.counted_at) throw new Error("Count the register first");
    const r = await lockRegister(tx, s.register_id);
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
    const base = { registerId: r.id, propertyId: r.propertyId, userId: viewer.userId, reason };
    if (input.kind === "paid_out" || input.kind === "tip_out") {
      if (!can(viewer.actor, input.kind === "paid_out" ? "paid_out" : "handle_cash", r.propertyId)) throw new Error("Not allowed");
      if (r.openShift?.userId !== viewer.userId) throw new Error(`Open your Shift on ${r.name} first`);
      if (amount > r.balance) throw new Error(`Only ${r.balance.toFixed(2)} ${settings.currency} is in ${r.name}`);
      let approvedBy: string | null = null;
      let account = "";
      let photo = null;
      if (input.kind === "paid_out") {
        account = String(input.account ?? "").trim().slice(0, 20);
        if (!account) throw new Error("Give the expense account");
        photo = decodePhoto(input.photo);
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
  const settings = await settingsOf(tx, payment.propertyId);
  if (!settings.enabled) throw new Error("The cash desk is off at this property");
  const shift = (await tx.query<{ id: string; register_id: string; counted_at: Date | null }>(
    "select id, register_id, counted_at from cash_shifts where property_id = $1 and user_id = $2 and closed_at is null",
    [payment.propertyId, userId],
  )).rows[0];
  if (!shift) throw new Error("Open your Shift on a Cash Register to take or give back cash");
  if (shift.counted_at) throw new Error("Your Shift is counted for closing; open a new one");
  const r = await lockRegister(tx, shift.register_id);
  if (payment.amount < 0 && -payment.amount > r.balance) throw new Error(`Only ${r.balance.toFixed(2)} ${settings.currency} is in ${r.name}`);
  await book(tx, { registerId: r.id, propertyId: payment.propertyId, shiftId: shift.id, kind: payment.amount > 0 ? "payment" : "refund", amount: payment.amount, userId, paymentId: payment.id });
  return r.id;
}

/** A Receipt for a desk payment, numbered without gaps per property, in the payment's transaction. */
export async function issueReceiptIn(tx: PoolClient, payment: { id: string; propertyId: string }, registerId: string | null, userId: string): Promise<void> {
  await tx.query("insert into receipt_numbers (property_id) values ($1) on conflict do nothing", [payment.propertyId]);
  const n = (await tx.query<{ last: number }>("update receipt_numbers set last = last + 1 where property_id = $1 returning last", [payment.propertyId])).rows[0]!.last;
  await tx.query("insert into receipts (property_id, number, payment_id, register_id, token, issued_by) values ($1, $2, $3, $4, $5, $6) on conflict (payment_id) do nothing", [
    payment.propertyId,
    n,
    payment.id,
    registerId,
    randomBytes(18).toString("base64url"),
    userId,
  ]);
}

export interface CashBookRow {
  id: string;
  at: Date;
  kind: CashMovementKind;
  amount: number;
  balance: number;
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
export async function cashBook(pool: Pool, schema: string, registerId: string, viewer: Viewer, options: { limit?: number } = {}): Promise<{ registerId: string; name: string; propertyId: string; balance: number; rows: CashBookRow[]; ownShiftOnly: boolean }> {
  if (!isUuid(registerId)) throw new Error("Register not found");
  return withTenant(pool, schema, async (tx) => {
    const g = (await tx.query<{ id: string; name: string; property_id: string }>("select id, name, property_id from cash_registers where id = $1", [registerId])).rows[0];
    if (!g) throw new Error("Register not found");
    const all = can(viewer.actor, "manage_cash", g.property_id);
    const own = !all ? (await tx.query<{ id: string }>("select id from cash_shifts where register_id = $1 and user_id = $2 and closed_at is null", [g.id, viewer.userId])).rows[0] : undefined;
    if (!all && !own) throw new Error("Not allowed to see this Cash Book");
    const { rows } = await tx.query<{ id: string; at: Date; kind: CashMovementKind; amount: string; reason: string; account: string; by_user: string; approved_by: string | null; shift_id: string | null; payment_id: string | null; confirmation_number: string | null; has_photo: boolean }>(
      `select m.id, m.at, m.kind, m.amount, m.reason, m.account, m.by_user, m.approved_by, m.shift_id, m.payment_id, b.confirmation_number, m.receipt_photo is not null as has_photo
       from cash_movements m left join payments p on p.id = m.payment_id left join reservations r on r.id = p.reservation_id left join bookings b on b.id = r.booking_id
       where m.register_id = $1 order by m.at, m.id`,
      [g.id],
    );
    const book = cashBookBalance(rows.map((r) => ({ kind: r.kind, amount: Number(r.amount) })));
    const all_rows = rows.map((r, i) => ({
      id: r.id,
      at: r.at,
      kind: r.kind,
      amount: Number(r.amount),
      balance: book.balances[i]!,
      reason: r.reason,
      account: r.account,
      byUser: r.by_user,
      approvedBy: r.approved_by,
      shiftId: r.shift_id,
      paymentId: r.payment_id,
      confirmationNumber: r.confirmation_number,
      hasPhoto: r.has_photo,
    }));
    const shown = own ? all_rows.filter((r) => r.shiftId === own.id) : all_rows.slice(-(options.limit ?? 500));
    return { registerId: g.id, name: g.name, propertyId: g.property_id, balance: book.balance, rows: shown, ownShiftOnly: !all };
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
  confirmationNumber: string;
  guestName: string;
  token: string;
}

const RECEIPT_SELECT = `select rc.number, rc.issued_at, rc.token, pr.name as property_name, le.name as le_name, le.address_line1, le.postal_code, le.city, le.country, le.vat_id,
    p.amount, p.currency, p.tender, p.card_brand, p.card_last4, p.refund_of is not null as refund, b.confirmation_number, g.first_name, g.last_name
  from receipts rc join payments p on p.id = rc.payment_id join properties pr on pr.id = rc.property_id join legal_entities le on le.id = pr.legal_entity_id
  join reservations r on r.id = p.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id`;

function toReceipt(r: Record<string, unknown>): ReceiptView {
  return {
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
    confirmationNumber: r.confirmation_number as string,
    guestName: `${r.first_name as string} ${r.last_name as string}`.trim(),
  };
}

/** A Receipt opened from its code: anyone holding the code may read it. */
export async function receiptByToken(pool: Pool, schema: string, token: string): Promise<ReceiptView | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query(`${RECEIPT_SELECT} where rc.token = $1`, [token])).rows[0];
    return r ? toReceipt(r) : null;
  });
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
