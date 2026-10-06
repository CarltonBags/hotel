import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { can, roomChargeCheck, roundMoney, taxCodeForRate, tillChargeGroups, type TillPosting, type TillTotal } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { correctIn, postRoomChargeIn } from "./folios";
import { roomChargeFactsIn } from "./outlets";
import type { Viewer } from "./room-state";
import { rateOn } from "./tax-rate";
import { withTenant } from "./with-tenant";

/**
 * Room charges from external tills (ticket 65): our published room charge
 * interface and Lightspeed's room charge contract. A till looks up the
 * Checked-in guests it may charge, posts a bill (once, however often it
 * sends it) as one Charge per Tax Code with the items as detail and the tip
 * apart, and takes a bill back whole: a Correction of each of its Charges
 * (ADR 0015). What is refused is kept and listed for staff to reconcile:
 * tills do not send a failed posting again.
 */

export interface TillConnection {
  id: string;
  propertyId: string;
  /** "fias": a FIAS till, served by the Site Bridge's FIAS plugin, which calls our interface. */
  kind: "api" | "lightspeed" | "fias";
  name: string;
  keyHint: string;
  businessReference: string;
  revenueAccount: string;
  tipAccount: string;
  /** The Tax Code per till rate where a rate fits more than one. */
  taxCodes: Record<string, string>;
  active: boolean;
}

/** Why a posting was refused; the till shows the text (Lightspeed: up to 50 characters). */
export type TillRefusalCode = "invalid" | "not_found" | "not_checked_in" | "blocked" | "not_covered" | "over_limit" | "unknown_tax_rate" | "bill_not_found" | "already_corrected" | "invoiced" | "settled_at_desk";

const REFUSAL_TEXT: Record<TillRefusalCode, string> = {
  invalid: "The posting is incomplete",
  not_found: "Reservation not found",
  not_checked_in: "The guest is not checked in",
  blocked: "Room charge blocked: guest pays",
  not_covered: "No guarantee for room charge",
  over_limit: "Over the spending limit",
  unknown_tax_rate: "Tax rate not set up at the hotel",
  bill_not_found: "The bill to take back was not found",
  already_corrected: "The bill is already taken back",
  invoiced: "Invoiced already: ask the desk",
  settled_at_desk: "Settled at the desk already",
};

export class TillRefusal extends Error {
  constructor(readonly code: TillRefusalCode) {
    super(REFUSAL_TEXT[code]);
  }
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const newKey = () => `hs_till_${randomBytes(24).toString("hex")}`;
const SELECT = "select id, property_id, kind, name, key_hint, business_reference, revenue_account, tip_account, tax_codes, active from till_connections";
const toConnection = (r: { id: string; property_id: string; kind: TillConnection["kind"]; name: string; key_hint: string; business_reference: string; revenue_account: string; tip_account: string; tax_codes: Record<string, string>; active: boolean }): TillConnection => ({
  id: r.id,
  propertyId: r.property_id,
  kind: r.kind,
  name: r.name,
  keyHint: r.key_hint,
  businessReference: r.business_reference,
  revenueAccount: r.revenue_account,
  tipAccount: r.tip_account,
  taxCodes: r.tax_codes,
  active: r.active,
});

function needManage(viewer: Viewer, propertyId: string): void {
  if (!can(viewer.actor, "manage_outlets", propertyId)) throw new Error("Only the Property Manager connects tills");
}

// ── setup ──

export interface TillConnectionInput {
  kind: "api" | "lightspeed" | "fias";
  name: string;
  businessReference: string;
  revenueAccount: string;
  tipAccount: string;
  taxCodes: Record<string, string>;
}

async function checkedInput(tx: PoolClient, propertyId: string, input: Omit<TillConnectionInput, "kind">): Promise<Omit<TillConnectionInput, "kind">> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new Error("Name the till (up to 60 characters)");
  const account = (a: string, what: string) => {
    const v = a.trim();
    if (!/^[0-9A-Za-z.-]{1,20}$/.test(v)) throw new Error(`Enter the ${what} account`);
    return v;
  };
  const taxCodes: Record<string, string> = {};
  for (const [rate, id] of Object.entries(input.taxCodes)) {
    if (!id) continue;
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(rate) || !isUuid(id)) throw new Error("Choose a Tax Code per rate");
    const ok = (await tx.query("select 1 from tax_codes t join properties p on p.legal_entity_id = t.legal_entity_id where t.id = $1 and p.id = $2", [id, propertyId])).rows.length;
    if (!ok) throw new Error("Tax Code not found for this property");
    taxCodes[String(Number(rate))] = id;
  }
  return { name, businessReference: input.businessReference.trim().slice(0, 100), revenueAccount: account(input.revenueAccount, "revenue"), tipAccount: account(input.tipAccount, "tip"), taxCodes };
}

/** A till connected: its key is shown this once and kept only as a hash. */
export async function createTillConnection(pool: Pool, schema: string, propertyId: string, input: TillConnectionInput, viewer: Viewer): Promise<{ id: string; key: string }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  needManage(viewer, propertyId);
  if (input.kind !== "api" && input.kind !== "lightspeed" && input.kind !== "fias") throw new Error("Choose how the till connects");
  if (input.kind === "lightspeed" && !input.businessReference.trim()) throw new Error("Enter Lightspeed's business reference of the venue");
  const key = newKey();
  return withTenant(pool, schema, async (tx) => {
    const v = await checkedInput(tx, propertyId, input);
    const id = (await tx.query<{ id: string }>(
      `insert into till_connections (property_id, kind, name, key_hash, key_hint, business_reference, revenue_account, tip_account, tax_codes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [propertyId, input.kind, v.name, hash(key), key.slice(-4), v.businessReference, v.revenueAccount, v.tipAccount, JSON.stringify(v.taxCodes), viewer.userId],
    ).catch((err: { code?: string }) => {
      if (err.code === "23505") throw new Error("A till of that name is connected already");
      throw err;
    })).rows[0]!.id;
    return { id, key };
  });
}

export async function updateTillConnection(pool: Pool, schema: string, id: string, input: Omit<TillConnectionInput, "kind"> & { active: boolean }, viewer: Viewer): Promise<void> {
  if (!isUuid(id)) throw new Error("Till not found");
  await withTenant(pool, schema, async (tx) => {
    const c = (await tx.query<{ property_id: string }>("select property_id from till_connections where id = $1 for update", [id])).rows[0];
    if (!c) throw new Error("Till not found");
    needManage(viewer, c.property_id);
    const v = await checkedInput(tx, c.property_id, input);
    await tx.query("update till_connections set name = $2, business_reference = $3, revenue_account = $4, tip_account = $5, tax_codes = $6, active = $7 where id = $1", [id, v.name, v.businessReference, v.revenueAccount, v.tipAccount, JSON.stringify(v.taxCodes), input.active]);
  });
}

/** A new key (the old one stops working at once), shown this once. */
export async function rotateTillKey(pool: Pool, schema: string, id: string, viewer: Viewer): Promise<string> {
  if (!isUuid(id)) throw new Error("Till not found");
  const key = newKey();
  await withTenant(pool, schema, async (tx) => {
    const c = (await tx.query<{ property_id: string }>("select property_id from till_connections where id = $1 for update", [id])).rows[0];
    if (!c) throw new Error("Till not found");
    needManage(viewer, c.property_id);
    await tx.query("update till_connections set key_hash = $2, key_hint = $3 where id = $1", [id, hash(key), key.slice(-4)]);
  });
  return key;
}

export async function tillConnectionsOf(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<TillConnection[]> {
  if (!isUuid(propertyId)) return [];
  needManage(viewer, propertyId);
  return withTenant(pool, schema, async (tx) => (await tx.query(`${SELECT} where property_id = $1 order by name`, [propertyId])).rows.map(toConnection));
}

/** The active till a key belongs to; null for a wrong or revoked key. */
export async function tillByKey(pool: Pool, schema: string, key: string): Promise<TillConnection | null> {
  if (!/^hs_till_[0-9a-f]{48}$/.test(key)) return null;
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query(`${SELECT} where key_hash = $1 and active`, [hash(key)])).rows[0];
    return r ? toConnection(r) : null;
  });
}

// ── lookup ──

export interface TillGuest {
  reservationId: string;
  room: string | null;
  name: string;
  firstName: string;
  /** What is left of tonight's Spending Limit (tips do not count). */
  remaining: number;
}

/** The Checked-in guests the till may charge, by surname or room; empty term: all of them. */
export async function tillGuests(pool: Pool, schema: string, till: TillConnection, term: string): Promise<TillGuest[]> {
  const q = term.trim().slice(0, 40);
  return withTenant(pool, schema, async (tx) => {
    const rows = (await tx.query<{ id: string; first_name: string }>(
      `select r.id, g.first_name from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
       where r.property_id = $1 and r.status = 'checked_in'
         and ($2 = '' or g.last_name ilike $3 || '%' or exists (select 1 from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= p.business_date and a.to_date > p.business_date and m.number = $2))
       order by g.last_name limit 50`,
      [till.propertyId, q, q.replace(/[\\%_]/g, "")],
    )).rows;
    const out: TillGuest[] = [];
    for (const r of rows) {
      const f = await roomChargeFactsIn(tx, till.propertyId, r.id);
      const c = roomChargeCheck({ ...f, amount: 0 });
      // nothing left of tonight's limit: the till takes payment
      if (c.allowed && c.remaining > 0) out.push({ reservationId: r.id, room: f.room, name: f.lastName, firstName: r.first_name, remaining: c.remaining });
    }
    return out;
  });
}

// ── posting ──

/** A posting as the till sends it: items, or totals per tax rate without items. */
export type TillPostingInput = TillPosting & { totals?: TillTotal[] | undefined };

export interface TillPosted {
  postingId: string;
  chargeIds: string[];
  duplicate: boolean;
}

async function postIn(tx: PoolClient, till: TillConnection, p: TillPostingInput): Promise<TillPosted> {
  const existing = (await tx.query<{ id: string; status: string; reconciled: boolean }>("select id, status, reconciled_at is not null as reconciled from till_postings where connection_id = $1 and external_id = $2 for update", [till.id, p.externalId])).rows[0];
  // staff settled a refused bill by hand: sending it again would charge it twice
  if (existing?.reconciled) throw new TillRefusal("settled_at_desk");
  if (existing?.status === "posted") {
    const ids = (await tx.query<{ id: string }>("select id from charges where till_posting_id = $1 order by posted_at, id", [existing.id])).rows.map((r) => r.id);
    return { postingId: existing.id, chargeIds: ids, duplicate: true };
  }
  // a Correction takes back a bill this till posted; its stay is that bill's
  const bill = p.corrects
    ? (await tx.query<{ id: string; reservation_id: string }>("select id, reservation_id from till_postings where connection_id = $1 and external_id = $2 and kind = 'bill' and status = 'posted' for update", [till.id, p.corrects])).rows[0]
    : undefined;
  if (p.corrects && (!bill || (p.reservationId && bill.reservation_id !== p.reservationId))) throw new TillRefusal("bill_not_found");
  const reservationId = bill?.reservation_id ?? p.reservationId;
  if (!isUuid(reservationId)) throw new TillRefusal("not_found");
  // the stay locked: two bills at once (two tills, or a till and our own outlet) never both pass the limit
  if (!(await tx.query("select 1 from reservations where id = $1 and property_id = $2 for update", [reservationId, till.propertyId])).rows.length) throw new TillRefusal("not_found");
  const facts = await roomChargeFactsIn(tx, till.propertyId, reservationId);
  const by = `till:${till.id}`;
  const label = `${till.name} ${p.receiptNumber}`.trim();
  const record = async (kind: "bill" | "correction", billId: string | null, total: number, tip: number) =>
    (await tx.query<{ id: string }>(
      `insert into till_postings (connection_id, property_id, external_id, kind, reservation_id, receipt_number, fiscal_id, original_id, total, tip, status, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'posted', $11)
       on conflict (connection_id, external_id) do update set kind = excluded.kind, reservation_id = excluded.reservation_id, receipt_number = excluded.receipt_number, fiscal_id = excluded.fiscal_id,
         original_id = excluded.original_id, total = excluded.total, tip = excluded.tip, status = 'posted', error = null, payload = excluded.payload, received_at = clock_timestamp()
       returning id`,
      [till.id, till.propertyId, p.externalId, kind, reservationId, p.receiptNumber.slice(0, 60), p.fiscalId.slice(0, 120), billId, total, tip, JSON.stringify(p)],
    )).rows[0]!.id;

  if (bill) {
    if ((await tx.query("select 1 from till_postings where original_id = $1 and status = 'posted'", [bill.id])).rows.length) throw new TillRefusal("already_corrected");
    if (facts.status !== "checked_in") throw new TillRefusal("not_checked_in");
    // the bill's Charges still standing: neither voided nor corrected at the desk meanwhile
    const lines = (await tx.query<{ id: string; amount: string; tip: boolean; invoiced: boolean }>(
      `select c.id, c.amount, c.tip, c.invoice_id is not null as invoiced from charges c
       where c.till_posting_id = $1 and c.voided_at is null and not exists (select 1 from charges x where x.corrects = c.id) order by c.posted_at, c.id`,
      [bill.id],
    )).rows;
    if (!lines.length) throw new TillRefusal("already_corrected");
    if (lines.some((l) => l.invoiced)) throw new TillRefusal("invoiced");
    const amount = (tip: boolean) => roundMoney(-lines.filter((l) => l.tip === tip).reduce((s, l) => s + Number(l.amount), 0));
    const id = await record("correction", bill.id, amount(false), amount(true));
    const chargeIds: string[] = [];
    for (const l of lines) chargeIds.push(await correctIn(tx, l.id, `Taken back by ${label}`, by, { tillPostingId: id }));
    return { postingId: id, chargeIds, duplicate: false };
  }

  let groups;
  try {
    groups = tillChargeGroups({ items: p.items, totals: p.totals });
  } catch {
    throw new TillRefusal("invalid");
  }
  const tip = roundMoney(Number(p.tip) || 0);
  // a bill charges; taking one back is a Correction of it, never a negative bill
  if (tip < 0 || groups.some((g) => g.amount <= 0)) throw new TillRefusal("invalid");
  const total = roundMoney(groups.reduce((s, g) => s + g.amount, 0));
  // the same rules as our own point of sale; the tip does not count against the limit
  const check = roomChargeCheck({ ...facts, amount: total });
  if (!check.allowed) throw new TillRefusal(check.refusal ?? "not_checked_in");
  if (check.overLimit) throw new TillRefusal("over_limit");
  const day = (await tx.query<{ d: string }>("select to_char(coalesce(business_date, (now() at time zone time_zone)::date), 'YYYY-MM-DD') as d from properties where id = $1", [till.propertyId])).rows[0]!.d;
  // one query at a time on the transaction's client
  const codes: { id: string; rate: number }[] = [];
  for (const c of (await tx.query<{ id: string }>("select t.id from tax_codes t join properties p on p.legal_entity_id = t.legal_entity_id where p.id = $1", [till.propertyId])).rows) {
    codes.push({ id: c.id, rate: await rateOn(tx, c.id, day).catch(() => -1) });
  }
  const codeFor = (rate: number) => {
    const id = taxCodeForRate(rate, codes, till.taxCodes);
    if (!id) throw new TillRefusal("unknown_tax_rate");
    return id;
  };
  const charges: { description: string; taxCodeId: string; revenueAccount: string; amount: number; detail: unknown; tip?: boolean }[] = groups.map((g) => ({ description: `${label} · ${g.taxRate} %`, taxCodeId: codeFor(g.taxRate), revenueAccount: till.revenueAccount, amount: g.amount, detail: g.items.length ? g.items : null }));
  // a tip passes through: a 0 % line on the tip account
  if (tip) charges.push({ description: `${label} · Tip`, taxCodeId: codeFor(0), revenueAccount: till.tipAccount, amount: tip, detail: null, tip: true });
  const id = await record("bill", null, total, tip);
  const chargeIds = await postRoomChargeIn(tx, reservationId, { tillPostingId: id }, charges, by);
  return { postingId: id, chargeIds, duplicate: false };
}

/**
 * A till's posting: a bill to the room, or the reversal of one. The same
 * posting again returns what the first did. A refusal is kept (with what
 * the till sent) for staff to reconcile, and thrown as a TillRefusal.
 */
export async function postTillCharge(pool: Pool, schema: string, till: TillConnection, p: TillPostingInput): Promise<TillPosted> {
  const externalId = String(p.externalId ?? "").trim().slice(0, 120);
  if (!externalId) throw new TillRefusal("invalid");
  const posting = { ...p, externalId, receiptNumber: String(p.receiptNumber ?? ""), fiscalId: String(p.fiscalId ?? ""), reservationId: String(p.reservationId ?? "") };
  try {
    return await withTenant(pool, schema, async (tx) => {
      // one posting of a bill at a time: a till sending it twice at once waits for the first
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`till:${till.id}:${externalId}`]);
      return postIn(tx, till, posting);
    });
  } catch (err) {
    if (!(err instanceof TillRefusal)) throw err;
    await recordTillRefusal(pool, schema, till, { ...posting, kind: posting.corrects ? "correction" : "bill" }, err.message, posting);
    throw err;
  }
}

/** A posting refused, kept with what the till sent, for staff to reconcile (also one we could not read as a posting at all). */
export async function recordTillRefusal(
  pool: Pool,
  schema: string,
  till: TillConnection,
  p: { externalId: string; kind: "bill" | "correction"; reservationId: string; receiptNumber: string; fiscalId: string },
  error: string,
  payload: unknown,
): Promise<void> {
  // a refusal without the till's id is listed too, under one of ours
  const externalId = p.externalId.trim().slice(0, 120) || `unidentified-${randomBytes(8).toString("hex")}`;
  await withTenant(pool, schema, (tx) =>
    tx.query(
      `insert into till_postings (connection_id, property_id, external_id, kind, reservation_id, receipt_number, fiscal_id, status, error, payload)
       values ($1, $2, $3, $4, (select id from reservations where id::text = $5 and property_id = $2), $6, $7, 'rejected', $8, $9)
       on conflict (connection_id, external_id) do update set error = excluded.error, payload = excluded.payload, received_at = clock_timestamp() where till_postings.status = 'rejected'`,
      [till.id, till.propertyId, externalId, p.kind, p.reservationId, p.receiptNumber.slice(0, 60), p.fiscalId.slice(0, 120), error.slice(0, 200), JSON.stringify(payload)],
    ),
  );
}

// ── reconciling ──

export interface TillPostingRow {
  id: string;
  till: string;
  kind: "bill" | "correction";
  receivedAt: string;
  receiptNumber: string;
  reservationId: string | null;
  guest: string | null;
  room: string | null;
  total: number;
  tip: number;
  status: "posted" | "rejected";
  error: string | null;
  reconciledAt: string | null;
  reconcileNote: string | null;
}

/** The property's till postings, newest last; open: the refused ones nobody has reconciled yet. Who posts Charges sees them. */
export async function tillPostings(pool: Pool, schema: string, propertyId: string, filter: { open?: boolean }, viewer: Viewer): Promise<TillPostingRow[]> {
  if (!isUuid(propertyId)) return [];
  if (!can(viewer.actor, "post_charges", propertyId)) throw new Error("Not allowed");
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; till: string; kind: TillPostingRow["kind"]; received_at: Date; receipt_number: string; reservation_id: string | null; guest: string | null; room: string | null; total: string; tip: string; status: TillPostingRow["status"]; error: string | null; reconciled_at: Date | null; reconcile_note: string | null }>(
      `select tp.id, c.name as till, tp.kind, tp.received_at, tp.receipt_number, tp.reservation_id, g.last_name as guest,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = tp.reservation_id order by a.to_date desc limit 1) as room,
         tp.total, tp.tip, tp.status, tp.error, tp.reconciled_at, tp.reconcile_note
       from till_postings tp join till_connections c on c.id = tp.connection_id
         left join reservations r on r.id = tp.reservation_id left join guests g on g.id = r.primary_guest_id
       where tp.property_id = $1 and (not $2 or (tp.status = 'rejected' and tp.reconciled_at is null))
       order by tp.received_at desc limit 200`,
      [propertyId, !!filter.open],
    )).rows
      .reverse()
      .map((r) => ({
        id: r.id,
        till: r.till,
        kind: r.kind,
        receivedAt: r.received_at.toISOString(),
        receiptNumber: r.receipt_number,
        reservationId: r.reservation_id,
        guest: r.guest,
        room: r.room,
        total: Number(r.total),
        tip: Number(r.tip),
        status: r.status,
        error: r.error,
        reconciledAt: r.reconciled_at?.toISOString() ?? null,
        reconcileNote: r.reconcile_note,
      })),
  );
}

/** A refused posting dealt with (posted by hand at the desk, or not needed), with a note. */
export async function reconcileTillPosting(pool: Pool, schema: string, postingId: string, note: string, viewer: Viewer): Promise<void> {
  if (!isUuid(postingId)) throw new Error("Posting not found");
  const text = note.trim().slice(0, 300);
  if (text.length < 3) throw new Error("Say how it was settled");
  await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ property_id: string; status: string; reconciled_at: Date | null }>("select property_id, status, reconciled_at from till_postings where id = $1 for update", [postingId])).rows[0];
    if (!p) throw new Error("Posting not found");
    if (!can(viewer.actor, "post_charges", p.property_id)) throw new Error("Not allowed");
    if (p.status !== "rejected" || p.reconciled_at) throw new Error("Only an open refused posting is reconciled");
    await tx.query("update till_postings set reconciled_at = clock_timestamp(), reconciled_by = $2, reconcile_note = $3 where id = $1", [postingId, viewer.userId, text]);
  });
}
