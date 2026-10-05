import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { FiscalUnavailable, adminPinFor, seal, type AtFiscalProvider, type FiscalProvider, type SignedTx } from "@hoteloftware/fiscal";
import { tenantKey, type FileStore } from "@hoteloftware/storage";
import {
  AT_NOT_SIGNED_NOTICE,
  AT_OUTAGE_NOTICE,
  FISCAL_OUTAGE_NOTICE,
  FISCAL_SCOPES,
  dsfinvkClosing,
  fiscalAmount,
  fiscalPayment,
  fiscalScopeCovers,
  fiscalSerial,
  fiscalVat,
  receiptVatAmounts,
  refundVatAmounts,
  type ClosingTransaction,
  type FiscalBusinessCase,
  type FiscalScope,
  type VatAmount,
} from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { inTestMode } from "./go-live";
import { stayComposition } from "./invoices";
import { signAtReceipt } from "./fiscal-at";
import { withTenant } from "./with-tenant";

/**
 * The fiscal module for Germany through fiskaly (ticket 51, ADR 0013). A
 * German property with the cash desk on sets up its TSE once; every Cash
 * Register is a client with a serial we assign and never change (Receipts
 * without a register, from the card terminal, have the desk's client).
 * Every Receipt in scope is signed, idempotently by its own id, with a short
 * timeout; when the TSE cannot sign, the desk goes on, the Receipt carries
 * the notice, the outage is logged from start to end and the managers hear
 * of it. Each Business Date is closed per client for DSFinV-K, and the signed
 * data is archived outside the provider every month.
 */

export interface FiscalDeps {
  provider: FiscalProvider;
  /** Austria's provider (ticket 52); absent where only Germany is signed. */
  at?: AtFiscalProvider;
  /** The platform's secret for the admin PIN and the sealed PUK: needed to set up a TSE and register clients, not to sign. */
  secret: string | null;
}

/** A claim older than this is taken over (the signer died midway); well beyond a signature's 5 seconds. */
const STALE_CLAIM_SECONDS = 90;
/** Who the fiscal module's own writes are by. */
export const FISCAL_USER = "fiscal-module";
const SOFTWARE = { brand: "Hoteloftware", version: "1.0" };

export interface FiscalUnitView {
  provider: string;
  tssSerial: string;
  publicKey: string;
  signatureAlgorithm: string;
  timestampFormat: string;
  scope: FiscalScope;
  inUseSince: Date;
}

export interface FiscalClientView {
  id: string;
  serial: string;
  registerName: string | null;
  registeredAt: Date | null;
}

export interface FiscalOutageView {
  id: string;
  clientSerial: string;
  registerName: string | null;
  startedAt: Date;
  endedAt: Date | null;
  error: string;
}

export interface FiscalArchiveView {
  id: string;
  kind: "tss" | "dsfinvk";
  periodFrom: string;
  periodTo: string;
  state: "pending" | "completed" | "failed";
  bytes: number | null;
  error: string | null;
  createdAt: Date;
}

export interface FiscalStatus {
  /** Germany only; elsewhere nothing is signed here. */
  applies: boolean;
  unit: FiscalUnitView | null;
  clients: FiscalClientView[];
  outages: FiscalOutageView[];
  closings: { clientSerial: string; businessDate: string; exportNumber: number; state: string; error: string | null }[];
  archives: FiscalArchiveView[];
}

export async function unitIn(tx: PoolClient, propertyId: string): Promise<(FiscalUnitView & { tssId: string }) | null> {
  const u = (await tx.query<{ provider: string; tss_id: string; tss_serial: string; public_key: string; signature_algorithm: string; timestamp_format: string; scope: FiscalScope; in_use_since: Date }>(
    "select provider, tss_id, tss_serial, public_key, signature_algorithm, timestamp_format, scope, in_use_since from fiscal_units where property_id = $1",
    [propertyId],
  )).rows[0];
  return u ? { provider: u.provider, tssId: u.tss_id, tssSerial: u.tss_serial, publicKey: u.public_key, signatureAlgorithm: u.signature_algorithm, timestampFormat: u.timestamp_format, scope: u.scope, inUseSince: u.in_use_since } : null;
}

/**
 * Set up the property's TSE (Property Manager): created and initialised at
 * the provider, its admin PIN derived, its PUK sealed, its clients
 * registered. Once per property: a second click waits for the first. Not in
 * Test Mode (a TSE is a real one).
 */
export async function setUpFiscal(pool: Pool, schema: string, deps: FiscalDeps, propertyId: string, userId: string): Promise<FiscalUnitView> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const secret = deps.secret;
  if (!secret) throw new Error("The fiscal module is not configured (FISCAL_SECRET)");
  const unit = await withTenant(pool, schema, async (tx) => {
    // one set-up at a time per property, held across the provider's calls (rare, and nothing else waits on it)
    await tx.query("select pg_advisory_xact_lock(hashtext('fiscal-setup:' || $1))", [propertyId]);
    const had = await unitIn(tx, propertyId);
    if (had) return had;
    const p = (await tx.query<{ country: string; cash: boolean }>("select country, cash_desk as cash from properties where id = $1", [propertyId])).rows[0];
    if (!p) throw new Error("Property not found");
    if (p.country !== "DE") throw new Error("The TSE is for properties in Germany");
    if (!p.cash) throw new Error("Switch the cash desk on first (Settings → Cash desk)");
    if (await inTestMode(tx)) throw new Error("Set up the TSE after go-live: in Test Mode nothing is signed");
    const tssId = randomUUID();
    const created = await deps.provider.createTss(tssId, adminPinFor(secret, tssId));
    await tx.query(
      `insert into fiscal_units (property_id, provider, tss_id, tss_serial, public_key, signature_algorithm, timestamp_format, puk_sealed, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [propertyId, deps.provider.name, tssId, created.serialNumber, created.publicKey, created.signatureAlgorithm, created.timestampFormat, seal(secret, created.adminPuk), userId],
    );
    return (await unitIn(tx, propertyId))!;
  });
  await registerFiscalClients(pool, schema, deps, propertyId);
  return unit;
}

/**
 * Every active Cash Register (and the desk) as a client of the TSE, made
 * and registered at the provider where not yet: at set-up, after a register
 * is added, and by the worker. Registering needs the admin PIN, so it never
 * runs inside a signature.
 */
export async function registerFiscalClients(pool: Pool, schema: string, deps: FiscalDeps, propertyId: string): Promise<{ registered: number; failed: string[] }> {
  const todo = await withTenant(pool, schema, async (tx) => {
    const unit = await unitIn(tx, propertyId);
    if (!unit) return null;
    const registers = (await tx.query<{ id: string }>("select id from cash_registers where property_id = $1 and active", [propertyId])).rows;
    for (const r of [...registers.map((x) => x.id), null]) await clientIn(tx, propertyId, r);
    const open = (await tx.query<{ id: string; serial: string }>("select id, serial from fiscal_clients where property_id = $1 and registered_at is null", [propertyId])).rows;
    return { unit, open };
  });
  const out = { registered: 0, failed: [] as string[] };
  if (!todo || !todo.open.length) return out;
  if (!deps.secret) return { registered: 0, failed: todo.open.map((c) => `${c.serial}: FISCAL_SECRET is not set`) };
  for (const c of todo.open) {
    try {
      await deps.provider.registerClient(todo.unit.tssId, c.id, c.serial, adminPinFor(deps.secret, todo.unit.tssId));
      await withTenant(pool, schema, (tx) => tx.query("update fiscal_clients set registered_at = clock_timestamp() where id = $1 and registered_at is null", [c.id]));
      out.registered++;
    } catch (err) {
      out.failed.push(`${c.serial}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return out;
}

/** What is signed: every Receipt, or cash and vouchers only (the switch for after gate 3). */
export async function setFiscalScope(pool: Pool, schema: string, propertyId: string, scope: FiscalScope): Promise<void> {
  if (!(FISCAL_SCOPES as readonly string[]).includes(scope)) throw new Error("Unknown scope");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update fiscal_units set scope = $2 where property_id = $1", [propertyId, scope])).rowCount);
  if (!n) throw new Error("Set up the TSE first");
}

/** The client of a Cash Register, or the desk's client for Receipts without one; made with its serial on first use. */
export async function clientIn(tx: PoolClient, propertyId: string, registerId: string | null): Promise<{ id: string; serial: string; registeredAt: Date | null; dsfinvkRegisteredAt: Date | null }> {
  const find = () =>
    tx.query<{ id: string; serial: string; registered_at: Date | null; dsfinvk_registered_at: Date | null }>(
      `select id, serial, registered_at, dsfinvk_registered_at from fiscal_clients where property_id = $1 and ${registerId ? "register_id = $2" : "register_id is null"}`,
      registerId ? [propertyId, registerId] : [propertyId],
    );
  let c = (await find()).rows[0];
  if (!c) {
    const id = randomUUID();
    await tx.query(`insert into fiscal_clients (id, property_id, register_id, serial) values ($1, $2, $3, $4) on conflict do nothing`, [id, propertyId, registerId, fiscalSerial(id)]);
    c = (await find()).rows[0]!;
  }
  return { id: c.id, serial: c.serial, registeredAt: c.registered_at, dsfinvkRegisteredAt: c.dsfinvk_registered_at };
}

/**
 * What a Receipt is to be signed with, written in the payment's transaction
 * together with the Receipt: in Germany, once the TSE is in use, outside
 * Test Mode, for a tender in scope. Its Business Date is the one it was
 * issued on; a refund carries the VAT of the payment it gives back.
 */
export async function recordFiscalIn(tx: PoolClient, receiptId: string): Promise<void> {
  const v = (await tx.query<{ property_id: string; register_id: string | null; amount: string; currency: string; tender: string; test: boolean; country: string; business_date: string }>(
    `select rc.property_id, rc.register_id, v.amount, trim(v.currency) as currency, v.tender, v.test, pr.country,
            to_char(coalesce(pr.business_date, (now() at time zone pr.time_zone)::date), 'YYYY-MM-DD') as business_date
     from receipts rc join vouchers v on v.id = rc.voucher_id join properties pr on pr.id = rc.property_id where rc.id = $1`,
    [receiptId],
  )).rows[0];
  if (v) return recordVoucherSaleIn(tx, receiptId, v);
  // a payment on a stay, or on an Outlet Sale's bill (ticket 60: no reservation, always a sale)
  const r = (await tx.query<{ property_id: string; register_id: string | null; amount: string; currency: string; tender: string; refund_of: string | null; folio_id: string; reservation_id: string | null; status: string | null; test: boolean; country: string; business_date: string }>(
    `select rc.property_id, rc.register_id, p.amount, trim(p.currency) as currency, p.tender, p.refund_of, p.folio_id, p.reservation_id, r.status, coalesce(r.test, false) as test, pr.country,
            to_char(coalesce(pr.business_date, (now() at time zone pr.time_zone)::date), 'YYYY-MM-DD') as business_date
     from receipts rc join payments p on p.id = rc.payment_id left join reservations r on r.id = p.reservation_id join properties pr on pr.id = rc.property_id
     where rc.id = $1`,
    [receiptId],
  )).rows[0];
  if (!r || (r.country !== "DE" && r.country !== "AT") || r.test || (await inTestMode(tx))) return;
  // Austria signs every on-site payment, cards included, also one taken before its signature unit is set up (signed once it is);
  // Germany as its scope says, once its TSE is in use
  if (r.country === "DE" && !((u) => !!u && fiscalScopeCovers(u.scope, r.tender))(await unitIn(tx, r.property_id))) return;
  const amount = Number(r.amount);
  let amounts: VatAmount[];
  let businessCase: FiscalBusinessCase;
  const original = r.refund_of
    ? (await tx.query<{ amounts: VatAmount[]; business_case: FiscalBusinessCase }>("select f.amounts, f.business_case from fiscal_transactions f join receipts rc on rc.id = f.receipt_id where rc.payment_id = $1", [r.refund_of])).rows[0]
    : undefined;
  if (original) {
    amounts = refundVatAmounts(amount, original.amounts);
    businessCase = original.business_case;
  } else {
    // what the money pays for: the folio's Charges, or before check-in the stay itself (as its Deposit Invoice)
    const charges = (await tx.query<{ rate: string; gross: string }>("select tax_rate as rate, sum(amount) as gross from charges where folio_id = $1 and voided_at is null group by tax_rate", [r.folio_id])).rows.map((c) => ({ rate: Number(c.rate), gross: Number(c.gross) }));
    amounts = receiptVatAmounts(amount, charges.length || !r.reservation_id ? charges : await stayComposition(tx, r.reservation_id));
    businessCase = r.status === "confirmed" ? "Anzahlungseinstellung" : "Umsatz";
  }
  const client = await clientIn(tx, r.property_id, r.register_id);
  await tx.query(
    `insert into fiscal_transactions (receipt_id, property_id, client_id, business_date, business_case, tender, currency, amount, amounts, receipt_type)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (receipt_id) do nothing`,
    // Austria: corrections only by cancellation receipts, so a refund is one
    [receiptId, r.property_id, client.id, r.business_date, businessCase, r.tender, r.currency, amount, JSON.stringify(amounts), r.country === "AT" && r.refund_of ? "cancellation" : "normal"],
  );
}

/**
 * A Voucher sold (ticket 53): not revenue but a multi-purpose voucher bought,
 * so no VAT (it arises when it is redeemed); signed in Germany (the narrower
 * scope covers vouchers too) and in Austria.
 */
async function recordVoucherSaleIn(tx: PoolClient, receiptId: string, v: { property_id: string; register_id: string | null; amount: string; currency: string; tender: string; test: boolean; country: string; business_date: string }): Promise<void> {
  if ((v.country !== "DE" && v.country !== "AT") || v.test || (await inTestMode(tx))) return;
  if (v.country === "DE" && !(await unitIn(tx, v.property_id))) return;
  const client = await clientIn(tx, v.property_id, v.register_id);
  const amount = Number(v.amount);
  await tx.query(
    `insert into fiscal_transactions (receipt_id, property_id, client_id, business_date, business_case, tender, currency, amount, amounts)
     values ($1, $2, $3, $4, 'MehrzweckgutscheinKauf', $5, $6, $7, $8) on conflict (receipt_id) do nothing`,
    [receiptId, v.property_id, client.id, v.business_date, v.tender, v.currency, amount, JSON.stringify([{ rate: 0, amount }])],
  );
}

export type FiscalSignResult =
  | { state: "none" }
  | { state: "signing" }
  | { state: "signed"; propertyId: string }
  | { state: "failed"; propertyId: string; error: string; outageStarted: boolean }
  /** Austria: the provider will not sign it; the desk is told when it happens (`newly`) and corrects it. */
  | { state: "refused"; propertyId: string; newly: boolean; error?: string };

/**
 * Sign one Receipt right after its payment (the desk's action, the worker
 * for any left over): one signer at a time holds the claim and only that
 * signer writes the outcome. A failed Receipt is never signed later, except
 * that a TSE found to have signed it after all is followed. Within the
 * provider's 5 seconds; a client not yet registered waits for the worker.
 */
export async function signReceipt(pool: Pool, schema: string, deps: FiscalDeps, receiptId: string): Promise<FiscalSignResult> {
  if (!isUuid(receiptId)) return { state: "none" };
  const country = await withTenant(pool, schema, async (tx) => (await tx.query<{ country: string }>("select p.country from fiscal_transactions f join properties p on p.id = f.property_id where f.receipt_id = $1", [receiptId])).rows[0]?.country);
  if (!country) return { state: "none" };
  if (country === "AT") return signAtReceipt(pool, schema, deps, receiptId);
  const claim = randomUUID();
  const held = await withTenant(pool, schema, async (tx) => {
    const f = (await tx.query<{ state: string; stale: boolean; attempts: number; property_id: string; client_id: string; amounts: VatAmount[]; tender: string; currency: string; amount: string }>(
      `select state, coalesce(claimed_at < now() - make_interval(secs => ${STALE_CLAIM_SECONDS}), true) as stale, attempts, property_id, client_id, amounts, tender, trim(currency) as currency, amount
       from fiscal_transactions where receipt_id = $1 for update`,
      [receiptId],
    )).rows[0];
    if (!f) return { kind: "none" as const };
    if (f.state === "signed" || f.state === "failed") return { kind: "done" as const, signed: f.state === "signed", propertyId: f.property_id };
    if (f.state === "signing" && !f.stale) return { kind: "busy" as const };
    const client = (await tx.query<{ serial: string; registered: boolean }>("select serial, registered_at is not null as registered from fiscal_clients where id = $1", [f.client_id])).rows[0]!;
    if (!client.registered) return { kind: "busy" as const };
    const unit = (await unitIn(tx, f.property_id))!;
    await tx.query("update fiscal_transactions set state = 'signing', claim = $2, claimed_at = clock_timestamp(), attempts = attempts + 1 where receipt_id = $1", [receiptId, claim]);
    return { kind: "claimed" as const, row: f, unit, retry: f.attempts > 0 };
  });
  if (held.kind === "none") return { state: "none" };
  if (held.kind === "busy") return { state: "signing" };
  if (held.kind === "done") return held.signed ? { state: "signed", propertyId: held.propertyId } : { state: "failed", propertyId: held.propertyId, error: FISCAL_OUTAGE_NOTICE, outageStarted: false };
  const { row, unit } = held;
  let signed: SignedTx | null = null;
  let error = "";
  try {
    const pay = fiscalPayment(row.tender);
    signed = await deps.provider.sign({
      tssId: unit.tssId,
      clientId: row.client_id,
      txId: receiptId,
      retry: held.retry,
      amountsPerVatRate: row.amounts.map((a) => ({ vatRate: fiscalVat(a.rate).tse, amount: fiscalAmount(a.amount) })),
      amountsPerPaymentType: [{ paymentType: pay.tse, amount: fiscalAmount(Number(row.amount)), currency: row.currency }],
    });
  } catch (err) {
    error = (err instanceof FiscalUnavailable || err instanceof Error ? err.message : "").slice(0, 200) || "TSE not available";
  }
  return withTenant(pool, schema, async (tx) => {
    const propertyId = row.property_id;
    if (signed) {
      const values = [receiptId, signed.number, signed.timeStart, signed.timeEnd, signed.signature, signed.signatureCounter, signed.algorithm, signed.publicKey, signed.tssSerial, signed.clientSerial, signed.timestampFormat, signed.qrCodeData, claim];
      const set = `state = 'signed', claim = null, number = $2, time_start = $3, time_end = $4, signature = $5, signature_counter = $6, algorithm = $7, public_key = $8,
        tss_serial = $9, client_serial = $10, timestamp_format = $11, qr_code_data = $12, error = null, finished_at = clock_timestamp()`;
      // ours to write; or another signer marked it failed meanwhile while the TSE did sign it: the TSE's word stands
      const n = (await tx.query(`update fiscal_transactions set ${set} where receipt_id = $1 and (claim = $13 or state = 'failed')`, values)).rowCount;
      if (!n) return { state: "signing" };
      // the TSE answers again: every open outage of the property ends
      await tx.query("update fiscal_outages set ended_at = clock_timestamp() where property_id = $1 and ended_at is null", [propertyId]);
      return { state: "signed", propertyId };
    }
    const n = (await tx.query("update fiscal_transactions set state = 'failed', claim = null, error = $2, finished_at = clock_timestamp() where receipt_id = $1 and claim = $3", [receiptId, error, claim])).rowCount;
    // another signer took it over: its outcome stands
    if (!n) return { state: "signing" };
    const started = (await tx.query("insert into fiscal_outages (property_id, client_id, error) values ($1, $2, $3) on conflict (client_id) where ended_at is null do nothing returning id", [propertyId, row.client_id, error])).rowCount;
    return { state: "failed", propertyId, error, outageStarted: !!started };
  });
}

/** The Receipts of a payment still to sign (the desk signs right after taking it). */
export async function receiptsOfPaymentToSign(pool: Pool, schema: string, paymentId: string): Promise<string[]> {
  if (!isUuid(paymentId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string }>("select f.receipt_id as id from fiscal_transactions f join receipts rc on rc.id = f.receipt_id where rc.payment_id = $1 and f.state in ('open', 'signing')", [paymentId])).rows.map((r) => r.id),
  );
}

/** Receipts not signed yet (the desk's attempt did not happen, or the signer died midway): signed by the worker. */
export async function receiptsToSign(pool: Pool, schema: string, limit = 50): Promise<string[]> {
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string }>(
      `select receipt_id as id from fiscal_transactions
       -- one tried before waits a minute per attempt (at most half an hour), so receipts that keep failing never crowd out new ones
       where (state = 'open' and (attempts = 0 or claimed_at < now() - least(attempts, 30) * interval '1 minute'))
          or (state = 'signing' and claimed_at < now() - make_interval(secs => ${STALE_CLAIM_SECONDS}))
       order by attempts, created_at limit $1`,
      [limit],
    )).rows.map((r) => r.id),
  );
}

/** Properties whose TSE is in use (the worker's per-tenant work is skipped without one). */
export async function fiscalProperties(pool: Pool, schema: string): Promise<string[]> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string }>("select property_id from fiscal_units")).rows.map((r) => r.property_id));
}

/** What a Receipt prints of its signature: the TSE's data with the QR code, or the outage notice. */
export type ReceiptFiscal =
  | { state: "at_signed"; receiptNumber: string; timeSignature: Date; registerSerial: string; qrCodeData: string; unitFailed: boolean; cancellation: boolean; amounts: VatAmount[] }
  | { state: "at_unsigned"; notice: string; registerSerial: string | null; cancellation: boolean; amounts: VatAmount[] }
  | { state: "signed"; number: number; timeStart: Date; timeEnd: Date; signature: string; signatureCounter: number; algorithm: string; publicKey: string; tssSerial: string; clientSerial: string; timestampFormat: string; qrCodeData: string; amounts: VatAmount[]; businessCase: FiscalBusinessCase }
  | { state: "failed"; notice: string; clientSerial: string; amounts: VatAmount[]; businessCase: FiscalBusinessCase }
  | { state: "signing"; amounts: VatAmount[]; businessCase: FiscalBusinessCase };

export async function receiptFiscalIn(tx: PoolClient, receiptId: string): Promise<ReceiptFiscal | null> {
  const f = (await tx.query<{ state: string; number: string | null; time_start: Date | null; time_end: Date | null; signature: string | null; signature_counter: string | null; algorithm: string | null; public_key: string | null; tss_serial: string | null; client_serial: string | null; serial: string; timestamp_format: string | null; qr_code_data: string | null; amounts: VatAmount[]; business_case: FiscalBusinessCase; country: string; receipt_number: string | null; unit_failed: boolean; receipt_type: string; provider_serial: string | null; attempts: number }>(
    "select f.*, c.serial, c.provider_serial, p.country from fiscal_transactions f join fiscal_clients c on c.id = f.client_id join properties p on p.id = f.property_id where f.receipt_id = $1",
    [receiptId],
  )).rows[0];
  if (!f) return null;
  if (f.country === "AT") {
    if (f.state === "signed") return { state: "at_signed", receiptNumber: f.receipt_number!, timeSignature: f.time_start!, registerSerial: f.client_serial ?? f.provider_serial ?? "", qrCodeData: f.qr_code_data!, unitFailed: f.unit_failed, cancellation: f.receipt_type === "cancellation", amounts: f.amounts };
    // refused by the provider: the desk corrects it; tried and not reached: the guest's Receipt says so and is signed once the provider answers
    if (f.state === "failed") return { state: "at_unsigned", notice: AT_NOT_SIGNED_NOTICE, registerSerial: f.provider_serial, cancellation: f.receipt_type === "cancellation", amounts: f.amounts };
    if (f.attempts > 0 && f.state === "open") return { state: "at_unsigned", notice: AT_OUTAGE_NOTICE, registerSerial: f.provider_serial, cancellation: f.receipt_type === "cancellation", amounts: f.amounts };
    return { state: "signing", amounts: f.amounts, businessCase: f.business_case };
  }
  if (f.state === "open" || f.state === "signing") return { state: "signing", amounts: f.amounts, businessCase: f.business_case };
  if (f.state === "failed") return { state: "failed", notice: FISCAL_OUTAGE_NOTICE, clientSerial: f.serial, amounts: f.amounts, businessCase: f.business_case };
  return {
    state: "signed",
    number: Number(f.number),
    timeStart: f.time_start!,
    timeEnd: f.time_end!,
    signature: f.signature!,
    signatureCounter: Number(f.signature_counter),
    algorithm: f.algorithm!,
    publicKey: f.public_key!,
    tssSerial: f.tss_serial!,
    clientSerial: f.client_serial!,
    timestampFormat: f.timestamp_format!,
    qrCodeData: f.qr_code_data!,
    amounts: f.amounts,
    businessCase: f.business_case,
  };
}

/**
 * Close a client's Business Date for DSFinV-K (Kassenabschluss): the
 * register made known first, then the day's Receipts with their TSE data or
 * outage, numbered on from the client's last closing. Asked again until the
 * provider has it.
 */
export async function closeFiscalDay(pool: Pool, schema: string, deps: FiscalDeps, propertyId: string, businessDate: string): Promise<{ completed: number; failed: string[] }> {
  const work = await withTenant(pool, schema, async (tx) => {
    const unit = await unitIn(tx, propertyId);
    if (!unit) return null;
    const clients = (await tx.query<{ id: string; serial: string; name: string | null; dsfinvk_registered_at: Date | null; currency: string }>(
      `select c.id, c.serial, g.name, c.dsfinvk_registered_at, trim(p.currency) as currency from fiscal_clients c join properties p on p.id = c.property_id left join cash_registers g on g.id = c.register_id
       where c.property_id = $1 and exists (select 1 from fiscal_transactions f where f.client_id = c.id and f.business_date = $2)
         -- a Receipt of the day still being signed: the day waits for it
         and not exists (select 1 from fiscal_transactions f where f.client_id = c.id and f.business_date = $2 and f.state in ('open', 'signing'))
         and not exists (select 1 from fiscal_closings z where z.client_id = c.id and z.business_date = $2 and z.state = 'completed')`,
      [propertyId, businessDate],
    )).rows;
    return { unit, clients };
  });
  if (!work) return { completed: 0, failed: [] };
  const out = { completed: 0, failed: [] as string[] };
  for (const c of work.clients) {
    try {
      if (!c.dsfinvk_registered_at) {
        await deps.provider.registerCashRegister(c.id, work.unit.tssId, { brand: SOFTWARE.brand, model: c.name ?? "Rezeption", software: SOFTWARE, currency: c.currency });
        await withTenant(pool, schema, (tx) => tx.query("update fiscal_clients set dsfinvk_registered_at = clock_timestamp() where id = $1 and dsfinvk_registered_at is null", [c.id]));
      }
      const { closingId, rowId, payload } = await withTenant(pool, schema, async (tx) => {
        await tx.query("select 1 from fiscal_clients where id = $1 for update", [c.id]);
        let z = (await tx.query<{ id: string; export_number: number; attempt_id: string; state: string }>("select id, export_number, attempt_id, state from fiscal_closings where client_id = $1 and business_date = $2", [c.id, businessDate])).rows[0];
        if (!z) {
          z = (await tx.query<{ id: string; export_number: number; attempt_id: string; state: string }>(
            "insert into fiscal_closings (property_id, client_id, business_date, export_number) values ($1, $2, $3, (select coalesce(max(export_number), 0) + 1 from fiscal_closings where client_id = $2)) returning id, export_number, attempt_id, state",
            [propertyId, c.id, businessDate],
          )).rows[0]!;
        } else if (z.state === "failed") {
          // the provider refused the last attempt: sent anew, under a new id
          z = (await tx.query<{ id: string; export_number: number; attempt_id: string; state: string }>("update fiscal_closings set state = 'pending', error = null, attempt_id = gen_random_uuid() where id = $1 returning id, export_number, attempt_id, state", [z.id])).rows[0]!;
        }
        const txs = (await tx.query<{ receipt_id: string; export_id: string; number: string | null; error: string | null; time_start: Date | null; time_end: Date | null; claimed_at: Date; business_case: FiscalBusinessCase; tender: string; currency: string; amounts: { rate: number | null; amount: number }[] }>(
          "select receipt_id, export_id, number, error, time_start, time_end, coalesce(claimed_at, created_at) as claimed_at, business_case, tender, currency, amounts from fiscal_transactions where client_id = $1 and business_date = $2 order by export_id",
          [c.id, businessDate],
        )).rows;
        const transactions: ClosingTransaction[] = txs.map((t) => ({
          exportId: Number(t.export_id),
          number: t.number === null ? null : Number(t.number),
          // a Receipt the TSE never signed has no TSE transaction to name
          tssTxId: t.number === null ? null : t.receipt_id,
          error: t.error,
          timeStart: t.time_start ?? t.claimed_at,
          timeEnd: t.time_end ?? t.claimed_at,
          businessCase: t.business_case,
          paymentType: fiscalPayment(t.tender).dsfinvk,
          currency: t.currency.trim(),
          amounts: t.amounts,
        }));
        return { closingId: z.attempt_id, rowId: z.id, payload: dsfinvkClosing({ clientId: c.id, exportNumber: z.export_number, businessDate, createdAt: new Date(), currency: c.currency, transactions }) };
      });
      const s = await deps.provider.closing(closingId, payload);
      await withTenant(pool, schema, (tx) =>
        tx.query("update fiscal_closings set state = $2, error = $3, finished_at = case when $2 = 'pending' then null else clock_timestamp() end where id = $1", [rowId, s.state === "completed" ? "completed" : s.state === "failed" ? "failed" : "pending", s.state === "failed" ? s.error : null]),
      );
      if (s.state === "completed") out.completed++;
      else if (s.state === "failed") out.failed.push(`${c.serial}: ${s.error}`);
    } catch (err) {
      out.failed.push(`${c.serial}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return out;
}

/** Business Dates with Receipts not yet closed for DSFinV-K, before the open one. */
export async function fiscalDaysToClose(pool: Pool, schema: string): Promise<{ propertyId: string; businessDate: string }[]> {
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ property_id: string; d: string }>(
      `select distinct f.property_id, to_char(f.business_date, 'YYYY-MM-DD') as d from fiscal_transactions f join properties p on p.id = f.property_id
       where p.country = 'DE' and f.state in ('signed', 'failed') and f.business_date < coalesce(p.business_date, (now() at time zone p.time_zone)::date)
         and not exists (select 1 from fiscal_transactions o where o.client_id = f.client_id and o.business_date = f.business_date and o.state in ('open', 'signing'))
         -- done, or refused within the hour (asked again later, not every minute)
         and not exists (select 1 from fiscal_closings z where z.client_id = f.client_id and z.business_date = f.business_date
                         and (z.state = 'completed' or (z.state = 'failed' and z.finished_at > now() - interval '1 hour')))
       order by 2 limit 50`,
    )).rows.map((r) => ({ propertyId: r.property_id, businessDate: r.d })),
  );
}

/**
 * Archive the TSE's signed data of a period outside the provider, or fetch
 * a DSFinV-K export: asked of the provider until done, then kept in the
 * tenant's file store.
 */
export async function fiscalArchive(
  pool: Pool,
  schema: string,
  deps: FiscalDeps & { store: FileStore; tenantId: string },
  input: { propertyId: string; kind: "tss" | "dsfinvk"; from: string; to: string },
  userId: string,
): Promise<FiscalArchiveView> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) throw new Error("Choose a period");
  const a = await withTenant(pool, schema, async (tx) => {
    const unit = await unitIn(tx, input.propertyId);
    if (!unit) throw new Error("Set up the TSE first");
    await tx.query("insert into fiscal_archives (property_id, kind, period_from, period_to, requested_by) values ($1, $2, $3, $4, $5) on conflict do nothing", [input.propertyId, input.kind, input.from, input.to, userId]);
    let row = (await tx.query<{ id: string; state: string; attempt_id: string }>("select id, state, attempt_id from fiscal_archives where property_id = $1 and kind = $2 and period_from = $3 and period_to = $4 for update", [input.propertyId, input.kind, input.from, input.to])).rows[0]!;
    // a failed one is asked again, under a new id at the provider
    if (row.state === "failed") row = (await tx.query<{ id: string; state: string; attempt_id: string }>("update fiscal_archives set state = 'pending', error = null, attempt_id = gen_random_uuid() where id = $1 returning id, state, attempt_id", [row.id])).rows[0]!;
    // the period in the property's own time: a German month starts at local midnight
    const span = (await tx.query<{ f: Date; t: Date }>("select ($1::date)::timestamp at time zone p.time_zone as f, ($2::date + 1)::timestamp at time zone p.time_zone as t from properties p where p.id = $3", [input.from, input.to, input.propertyId])).rows[0]!;
    return { id: row.id, attemptId: row.attempt_id, state: row.state, tssId: unit.tssId, from: span.f, to: new Date(span.t.getTime() - 1000) };
  });
  if (a.state !== "completed") {
    try {
      const s =
        input.kind === "tss"
          ? await deps.provider.tssExport(a.tssId, a.attemptId, a.from, a.to)
          : await deps.provider.dsfinvkExport(a.attemptId, input.from, input.to);
      if (s.state === "completed" && s.file) {
        const key = tenantKey(deps.tenantId, "fiscal_archive", a.id);
        await deps.store.put(key, s.file, "application/x-tar");
        await withTenant(pool, schema, (tx) => tx.query("update fiscal_archives set state = 'completed', file_key = $2, bytes = $3, finished_at = clock_timestamp() where id = $1", [a.id, key, s.file!.length]));
      } else if (s.state === "failed") {
        await withTenant(pool, schema, (tx) => tx.query("update fiscal_archives set state = 'failed', error = $2, finished_at = clock_timestamp() where id = $1", [a.id, s.error]));
      }
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update fiscal_archives set state = 'failed', error = $2, finished_at = clock_timestamp() where id = $1", [a.id, err instanceof Error ? err.message.slice(0, 300) : "error"]));
    }
  }
  return withTenant(pool, schema, async (tx) => archiveRow(tx, a.id));
}

async function archiveRow(tx: PoolClient, id: string): Promise<FiscalArchiveView> {
  const r = (await tx.query<{ id: string; kind: "tss" | "dsfinvk"; period_from: string; period_to: string; state: FiscalArchiveView["state"]; bytes: number | null; error: string | null; created_at: Date }>(
    "select id, kind, to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to, state, bytes, error, created_at from fiscal_archives where id = $1",
    [id],
  )).rows[0]!;
  return { id: r.id, kind: r.kind, periodFrom: r.period_from, periodTo: r.period_to, state: r.state, bytes: r.bytes, error: r.error, createdAt: r.created_at };
}

/** An archived file for download (the property's, for the caller's rights check). */
export async function fiscalArchiveFile(pool: Pool, schema: string, store: FileStore, id: string): Promise<{ propertyId: string; kind: string; periodFrom: string; periodTo: string; bytes: Uint8Array } | null> {
  if (!isUuid(id)) return null;
  const r = await withTenant(pool, schema, async (tx) => (await tx.query<{ property_id: string; kind: string; period_from: string; period_to: string; file_key: string | null }>("select property_id, kind, to_char(period_from, 'YYYY-MM-DD') as period_from, to_char(period_to, 'YYYY-MM-DD') as period_to, file_key from fiscal_archives where id = $1 and state = 'completed'", [id])).rows[0]);
  if (!r?.file_key) return null;
  const bytes = await store.get(r.file_key);
  return bytes ? { propertyId: r.property_id, kind: r.kind, periodFrom: r.period_from, periodTo: r.period_to, bytes } : null;
}

/** Months not archived yet, from the TSE's first month to last month: the TSE's signed data and the DSFinV-K export (a refused one again after a day). */
export async function fiscalMonthsToArchive(pool: Pool, schema: string, today: string): Promise<{ propertyId: string; kind: "tss" | "dsfinvk"; from: string; to: string }[]> {
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ property_id: string; kind: "tss" | "dsfinvk"; f: string; t: string }>(
      `select u.property_id, k.kind, to_char(m, 'YYYY-MM-DD') as f, to_char(m + interval '1 month' - interval '1 day', 'YYYY-MM-DD') as t
       from fiscal_units u cross join (values ('tss'), ('dsfinvk')) k(kind)
       cross join lateral generate_series(date_trunc('month', u.in_use_since)::date, date_trunc('month', $1::date)::date - interval '1 month', interval '1 month') m
       where not exists (select 1 from fiscal_archives a where a.property_id = u.property_id and a.kind = k.kind and a.period_from = m::date
                         and (a.state = 'completed' or (a.state = 'failed' and a.finished_at > now() - interval '20 hours')))
       order by 3, 2 limit 24`,
      [today],
    )).rows.map((r) => ({ propertyId: r.property_id, kind: r.kind, from: r.f, to: r.t })),
  );
}

/** The settings page: the TSE, its clients, outages, closings and archives. */
export async function fiscalStatus(pool: Pool, schema: string, propertyId: string): Promise<FiscalStatus> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    const country = (await tx.query<{ country: string }>("select country from properties where id = $1", [propertyId])).rows[0]?.country;
    const unit = await unitIn(tx, propertyId);
    const clients = (await tx.query<{ id: string; serial: string; name: string | null; registered_at: Date | null }>(
      "select c.id, c.serial, g.name, c.registered_at from fiscal_clients c left join cash_registers g on g.id = c.register_id where c.property_id = $1 order by g.name nulls first",
      [propertyId],
    )).rows;
    const outages = (await tx.query<{ id: string; serial: string; name: string | null; started_at: Date; ended_at: Date | null; error: string }>(
      "select o.id, c.serial, g.name, o.started_at, o.ended_at, o.error from fiscal_outages o join fiscal_clients c on c.id = o.client_id left join cash_registers g on g.id = c.register_id where o.property_id = $1 order by o.started_at desc limit 50",
      [propertyId],
    )).rows;
    const closings = (await tx.query<{ serial: string; d: string; export_number: number; state: string; error: string | null }>(
      "select c.serial, to_char(z.business_date, 'YYYY-MM-DD') as d, z.export_number, z.state, z.error from fiscal_closings z join fiscal_clients c on c.id = z.client_id where z.property_id = $1 order by z.business_date desc, c.serial limit 60",
      [propertyId],
    )).rows;
    const archives = (await tx.query<{ id: string }>("select id from fiscal_archives where property_id = $1 order by created_at desc limit 40", [propertyId])).rows;
    return {
      applies: country === "DE",
      unit: unit ? { provider: unit.provider, tssSerial: unit.tssSerial, publicKey: unit.publicKey, signatureAlgorithm: unit.signatureAlgorithm, timestampFormat: unit.timestampFormat, scope: unit.scope, inUseSince: unit.inUseSince } : null,
      clients: clients.map((c) => ({ id: c.id, serial: c.serial, registerName: c.name, registeredAt: c.registered_at })),
      outages: outages.map((o) => ({ id: o.id, clientSerial: o.serial, registerName: o.name, startedAt: o.started_at, endedAt: o.ended_at, error: o.error })),
      closings: closings.map((z) => ({ clientSerial: z.serial, businessDate: z.d, exportNumber: z.export_number, state: z.state, error: z.error })),
      archives: await Promise.all(archives.map((a) => archiveRow(tx, a.id))),
    };
  });
}

/**
 * What the tax office is told of the property's electronic record-keeping
 * system (§ 146a (4) AO): the taxpayer and establishment, every client with
 * its serial and start of use, and the TSE.
 */
export async function fiscalRegistration(pool: Pool, schema: string, propertyId: string): Promise<{
  taxpayer: { name: string; taxNumber: string; vatId: string | null; address: string };
  establishment: { name: string; address: string };
  tse: { provider: string; serial: string; inUseSince: Date } | null;
  systems: { serial: string; name: string; software: string; inUseSince: Date | null }[];
}> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    // the property has no address of its own: the establishment is at the Legal Entity's
    const p = (await tx.query<{ name: string; le_name: string; tax_number: string; vat_id: string | null; le_address: string }>(
      `select p.name, le.name as le_name, coalesce(le.tax_number, '') as tax_number, le.vat_id,
              concat_ws(', ', nullif(le.address_line1, ''), nullif(le.address_line2, ''), trim(le.postal_code || ' ' || le.city)) as le_address
       from properties p join legal_entities le on le.id = p.legal_entity_id where p.id = $1`,
      [propertyId],
    )).rows[0];
    if (!p) throw new Error("Property not found");
    const unit = await unitIn(tx, propertyId);
    const clients = (await tx.query<{ serial: string; name: string | null; registered_at: Date | null }>(
      "select c.serial, g.name, c.registered_at from fiscal_clients c left join cash_registers g on g.id = c.register_id where c.property_id = $1 order by g.name nulls first",
      [propertyId],
    )).rows;
    return {
      taxpayer: { name: p.le_name, taxNumber: p.tax_number, vatId: p.vat_id, address: p.le_address },
      establishment: { name: p.name, address: p.le_address },
      tse: unit ? { provider: unit.provider, serial: unit.tssSerial, inUseSince: unit.inUseSince } : null,
      systems: clients.map((c) => ({ serial: c.serial, name: c.name ?? "Rezeption (Kartenterminal)", software: `${SOFTWARE.brand} ${SOFTWARE.version} (Cloud)`, inUseSince: c.registered_at })),
    };
  });
}
